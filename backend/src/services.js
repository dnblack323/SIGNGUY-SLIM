import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { documentTotals, formatCents, lineTotalCents, paymentStatus } from "./money.js";
import { hashPassword, hashToken, newSessionToken, sessionExpiry, verifyPassword } from "./security.js";
import { renderPdf } from "./pdf.js";

const ROLES = ["owner", "admin", "manager", "staff"];
const WRITE_ROLES = new Set(ROLES);
const ADMIN_ROLES = new Set(["owner", "admin"]);
const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const PRODUCTION_STAGES = ["not_started", "ready", "in_progress", "waiting", "complete"];
const ACTIVE_REOPEN_STAGE = "in_progress";
const DEFAULT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
]);
const PREVIEW_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "text/plain"]);
const BLOCKED_EXTENSION_RE = /\.(html?|svg|js|mjs|cjs|exe|bat|cmd|ps1|sh|scr|com|dll|jar)$/i;

const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(2),
});

const quickItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  quantity_decimal: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/).refine((value) => value !== "0" && value !== "0.0" && value !== "0.00" && value !== "0.000" && value !== "0.0000", "quantity_must_be_positive"),
  unit_price_cents: z.number().int().nonnegative().safe(),
  taxable: z.boolean(),
  production_required: z.boolean(),
  due_date: z.string().nullable().optional(),
  assigned_user_id: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
});

const workspaceItemSchema = quickItemSchema.extend({
  production_stage: z.enum(PRODUCTION_STAGES).default("not_started"),
  completed: z.boolean().default(false),
});

const orderWorkspaceSchema = z.object({
  expected_updated_at: z.string().optional(),
  document_date: z.string().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "on_hold", "complete", "cancelled"]).optional(),
  discount_cents: z.number().int().nonnegative().optional(),
  internal_notes: z.string().nullable().optional(),
  items: z.array(workspaceItemSchema).min(1).optional(),
});

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function portable(type) {
  return `sgp_v1_${type}_${randomUUID()}`;
}

function bool(value) {
  return value ? 1 : 0;
}

function inflateBool(row, fields) {
  for (const field of fields) row[field] = Boolean(row[field]);
  return row;
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function error(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

function storageRoot() {
  return resolve(process.env.SIGNGUY_SLIM_ATTACHMENT_ROOT || join(process.cwd(), "data", "attachments"));
}

function uploadLimitBytes() {
  const parsed = Number(process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES || DEFAULT_UPLOAD_LIMIT_BYTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_LIMIT_BYTES;
}

function safeFilename(name) {
  const leaf = basename(String(name || "attachment").replace(/\\/g, "/"));
  const cleaned = leaf.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+$/, "attachment");
  return cleaned.slice(0, 180) || "attachment";
}

function assertInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}\\`) && !resolved.startsWith(`${resolvedRoot}/`)) {
    throw error("attachment_path_invalid", 400);
  }
  return resolved;
}

function contentDisposition(filename, disposition = "attachment") {
  const safe = safeFilename(filename).replace(/"/g, "'");
  return `${disposition}; filename="${safe}"`;
}

function mapTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    slug: row.slug,
    company_name: row.company_name,
    logo_reference: row.logo_reference,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      country: row.country,
    },
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    sales_tax_rate_basis_points: row.sales_tax_rate_basis_points,
    locale: row.locale,
    currency: row.currency,
    shop_timezone: row.shop_timezone,
  };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    display_name: row.display_name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
  };
}

function mapCustomer(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      customer_number: row.customer_number,
      contact_name: row.contact_name,
      business_name: row.business_name,
      email: row.email,
      phone: row.phone,
      billing_address: {
        line1: row.billing_line1,
        line2: row.billing_line2,
        city: row.billing_city,
        state: row.billing_state,
        postal_code: row.billing_postal_code,
        country: row.billing_country,
      },
      active: row.active,
      tax_exempt: row.tax_exempt,
      tax_exemption_note: row.tax_exemption_note,
      internal_notes: row.internal_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    ["active", "tax_exempt"],
  );
}

function mapItem(row, ownerKey) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      [ownerKey]: row[ownerKey],
      source_estimate_item_id: row.source_estimate_item_id,
      position: row.position,
      description: row.description,
      quantity_decimal: row.quantity_decimal,
      unit_price_cents: row.unit_price_cents,
      line_total_cents: row.line_total_cents,
      taxable: row.taxable,
      production_required: row.production_required,
      production_stage: row.production_stage,
      completed: row.completed,
      due_date: row.due_date,
      assigned_user_id: row.assigned_user_id,
      internal_note: row.internal_note,
    },
    ["taxable", "production_required", "completed"],
  );
}

function productionProgress(items) {
  const productionItems = items.filter((item) => item.production_required);
  const completed = productionItems.filter((item) => item.completed).length;
  const total = productionItems.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : null,
  };
}

function mapEstimate(row, items = []) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      estimate_number: row.estimate_number,
      document_date: row.document_date,
      expires_at: row.expires_at,
      follow_up_at: row.follow_up_at,
      status: row.status,
      customer_tax_exempt_snapshot: row.customer_tax_exempt_snapshot,
      tax_rate_basis_points_snapshot: row.tax_rate_basis_points_snapshot,
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      internal_notes: row.internal_notes,
      converted_order_id: row.converted_order_id,
      items,
    },
    ["customer_tax_exempt_snapshot"],
  );
}

function mapOrder(row, items = []) {
  if (!row) return null;
  const order = inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      source_estimate_id: row.source_estimate_id,
      order_number: row.order_number,
      document_date: row.document_date,
      due_date: row.due_date,
      status: row.status,
      customer_tax_exempt_snapshot: row.customer_tax_exempt_snapshot,
      tax_rate_basis_points_snapshot: row.tax_rate_basis_points_snapshot,
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      internal_notes: row.internal_notes,
      items,
    },
    ["customer_tax_exempt_snapshot"],
  );
  order.production_progress = productionProgress(items);
  return order;
}

function mapInvoice(row) {
  if (!row) return null;
  return inflateBool(
    {
      id: row.id,
      portable_id: row.portable_id,
      tenant_id: row.tenant_id,
      order_id: row.order_id,
      customer_id: row.customer_id,
      invoice_number: row.invoice_number,
      document_date: row.document_date,
      due_date: row.due_date,
      document_status: row.document_status,
      payment_status: row.payment_status,
      customer_tax_exempt_snapshot: row.customer_tax_exempt_snapshot,
      tax_rate_basis_points_snapshot: row.tax_rate_basis_points_snapshot,
      subtotal_cents: row.subtotal_cents,
      discount_cents: row.discount_cents,
      tax_cents: row.tax_cents,
      total_cents: row.total_cents,
      amount_paid_cents: row.amount_paid_cents,
      balance_due_cents: row.balance_due_cents,
      historical_amount_paid_note: row.historical_amount_paid_note,
    },
    ["customer_tax_exempt_snapshot"],
  );
}

function mapAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    order_id: row.order_id,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
    previewable: PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type),
  };
}

export class SlimService {
  constructor(db) {
    this.db = db;
    this.inTransaction = false;
  }

  attachmentPath(storageKey) {
    const root = storageRoot();
    const fullPath = assertInside(root, join(root, storageKey));
    const realParent = dirname(fullPath);
    mkdirSync(realParent, { recursive: true });
    if (existsSync(realParent) && lstatSync(realParent).isSymbolicLink()) throw error("attachment_path_invalid", 400);
    return fullPath;
  }

  transaction(work) {
    if (this.inTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  nextNumber(tenantId, sequenceName, prefix) {
    this.db
      .prepare("INSERT OR IGNORE INTO tenant_sequences (tenant_id, sequence_name, next_value) VALUES (?, ?, 1)")
      .run(tenantId, sequenceName);
    const row = this.db
      .prepare("SELECT next_value FROM tenant_sequences WHERE tenant_id = ? AND sequence_name = ?")
      .get(tenantId, sequenceName);
    this.db
      .prepare("UPDATE tenant_sequences SET next_value = next_value + 1 WHERE tenant_id = ? AND sequence_name = ?")
      .run(tenantId, sequenceName);
    return `${prefix}-${String(row.next_value).padStart(5, "0")}`;
  }

  audit(actor, action, entityType, entityId, entityPortableId, summary, diff = null) {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (id, portable_id, tenant_id, actor_user_id, action, entity_type, entity_id, entity_portable_id, summary, diff_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        portable("audit_event"),
        actor.tenant_id,
        actor.id,
        action,
        entityType,
        entityId,
        entityPortableId,
        summary,
        diff ? JSON.stringify(diff) : null,
        now(),
      );
  }

  requireRole(actor, allowed) {
    if (!actor || !allowed.has(actor.role) || !actor.active) throw error("permission_denied", 403);
  }

  async registerTenant(payload) {
    const input = z
      .object({
        tenant_name: z.string().min(1),
        tenant_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        owner_email: z.string().email(),
        owner_name: z.string().min(1),
        owner_password: z.string().min(8).max(128),
        sales_tax_rate_basis_points: z.number().int().min(0).max(10000).default(0),
        locale: z.string().min(2).default("en-US"),
        currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
        shop_timezone: z.string().min(1).default("America/New_York"),
      })
      .parse(payload);
    const tenantId = randomUUID();
    const userId = randomUUID();
    const created = now();
    const passwordHash = await hashPassword(input.owner_password);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO tenants
           (id, portable_id, slug, company_name, sales_tax_rate_basis_points, locale, currency, shop_timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tenantId,
          portable("tenant"),
          input.tenant_slug,
          input.tenant_name,
          input.sales_tax_rate_basis_points,
          input.locale,
          input.currency,
          input.shop_timezone,
          created,
          created,
        );
      this.db
        .prepare(
          `INSERT INTO users (id, portable_id, tenant_id, display_name, email, password_hash, role, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'owner', 1, ?, ?)`,
        )
        .run(userId, portable("user"), tenantId, input.owner_name, input.owner_email.toLowerCase(), passwordHash, created, created);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      if (String(err.message).includes("UNIQUE")) throw error("tenant_or_user_exists", 409);
      throw err;
    }
    const actor = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
    this.audit(actor, "tenant.create", "tenant", tenantId, this.tenant(tenantId).portable_id, `Tenant ${input.tenant_name} created`);
    return this.issueSession(actor);
  }

  async login(payload) {
    const input = z
      .object({ tenant_slug: z.string().min(1), email: z.string().email(), password: z.string().min(1) })
      .parse(payload);
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE slug = ?").get(input.tenant_slug);
    const generic = error("invalid_shop_email_or_password", 401);
    if (!tenant) throw generic;
    const user = this.db
      .prepare("SELECT * FROM users WHERE tenant_id = ? AND email = ?")
      .get(tenant.id, input.email.toLowerCase());
    if (!user || !user.active || !(await verifyPassword(input.password, user.password_hash))) throw generic;
    return this.issueSession(mapUser(user));
  }

  issueSession(user) {
    const token = newSessionToken();
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO sessions (id, tenant_id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, user.tenant_id, user.id, hashToken(token), now(), sessionExpiry());
    return { access_token: token, token_type: "bearer", user, tenant: this.tenant(user.tenant_id) };
  }

  actorForToken(token) {
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashToken(token || ""), now());
    if (!row || !row.active) throw error("unauthorized", 401);
    return mapUser(row);
  }

  logout(token) {
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(now(), hashToken(token || ""));
    return true;
  }

  tenant(tenantId) {
    const row = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!row) throw error("tenant_not_found", 404);
    return mapTenant(row);
  }

  settings(actor) {
    return { tenant: this.tenant(actor.tenant_id), users: this.users(actor) };
  }

  updateSettings(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z
      .object({
        company_name: z.string().min(1).optional(),
        logo_reference: z.string().nullable().optional(),
        address: addressSchema.optional(),
        contact_email: z.string().email().nullable().optional(),
        contact_phone: z.string().nullable().optional(),
        sales_tax_rate_basis_points: z.number().int().min(0).max(10000).optional(),
        locale: z.string().min(2).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        shop_timezone: z.string().min(1).optional(),
      })
      .parse(payload);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "address") {
        for (const [addressKey, addressValue] of Object.entries(value)) {
          const column =
            addressKey === "line1"
              ? "address_line1"
              : addressKey === "line2"
                ? "address_line2"
                : addressKey;
          fields.push(`${column} = ?`);
          values.push(addressValue ?? null);
        }
      } else {
        fields.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), actor.tenant_id);
    this.db.prepare(`UPDATE tenants SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    this.audit(actor, "settings.update", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Company settings updated", input);
    return this.settings(actor);
  }

  users(actor) {
    return this.db.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY display_name").all(actor.tenant_id).map(mapUser);
  }

  async addUser(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z
      .object({
        display_name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        role: z.enum(ROLES),
        active: z.boolean().default(true),
      })
      .parse(payload);
    if (input.role === "owner" && actor.role !== "owner") throw error("owner_role_requires_owner", 403);
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO users (id, portable_id, tenant_id, display_name, email, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, portable("user"), actor.tenant_id, input.display_name, input.email.toLowerCase(), await hashPassword(input.password), input.role, bool(input.active), timestamp, timestamp);
    const user = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
    this.audit(actor, "user.create", "user", user.id, user.portable_id, `User ${user.display_name} created`, { role: user.role });
    return user;
  }

  updateUser(actor, id, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!existing) throw error("user_not_found", 404);
    if (existing.role === "owner" && actor.role !== "owner") throw error("owner_role_locked", 403);
    const input = z
      .object({
        display_name: z.string().min(1).optional(),
        role: z.enum(ROLES).optional(),
        active: z.boolean().optional(),
      })
      .parse(payload);
    if (input.role === "owner" && actor.role !== "owner") throw error("owner_role_requires_owner", 403);
    const nextRole = input.role ?? existing.role;
    const nextActive = input.active ?? Boolean(existing.active);
    if (existing.role === "owner" && (!nextActive || nextRole !== "owner") && this.activeOwnerCount(actor.tenant_id) <= 1) {
      throw error("last_active_owner_required", 403);
    }
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === "boolean" ? bool(value) : value);
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    if (input.active === false) {
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND tenant_id = ? AND revoked_at IS NULL").run(now(), id, actor.tenant_id);
    }
    const user = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
    this.audit(actor, "user.update", "user", user.id, user.portable_id, `User ${user.display_name} updated`, input);
    return user;
  }

  activeOwnerCount(tenantId) {
    return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND role = 'owner' AND active = 1").get(tenantId).count;
  }

  createCustomer(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        contact_name: z.string().min(1),
        business_name: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        billing_address: addressSchema,
        active: z.boolean().default(true),
        tax_exempt: z.boolean().default(false),
        tax_exemption_note: z.string().nullable().optional(),
        internal_notes: z.string().nullable().optional(),
      })
      .parse(payload);
    const id = randomUUID();
    const pid = portable("customer");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "customer", "C");
    this.db
      .prepare(
        `INSERT INTO customers
         (id, portable_id, tenant_id, customer_number, contact_name, business_name, email, phone,
          billing_line1, billing_line2, billing_city, billing_state, billing_postal_code, billing_country,
          active, tax_exempt, tax_exemption_note, internal_notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pid,
        actor.tenant_id,
        number,
        input.contact_name,
        input.business_name ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.billing_address.line1,
        input.billing_address.line2 ?? null,
        input.billing_address.city,
        input.billing_address.state,
        input.billing_address.postal_code,
        input.billing_address.country,
        bool(input.active),
        bool(input.tax_exempt),
        input.tax_exemption_note ?? null,
        input.internal_notes ?? null,
        timestamp,
        timestamp,
      );
    this.audit(actor, "customer.create", "customer", id, pid, `Customer ${input.contact_name} created`, {
      customer_number: number,
      tax_exempt: input.tax_exempt,
    });
    return this.customer(actor, id);
  }

  listCustomers(actor, filters = {}) {
    const params = [actor.tenant_id];
    let where = "tenant_id = ?";
    if (filters.status === "active") where += " AND active = 1";
    if (filters.status === "inactive") where += " AND active = 0";
    if (filters.search) {
      where += " AND (contact_name LIKE ? OR business_name LIKE ? OR email LIKE ? OR phone LIKE ?)";
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }
    return this.db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY customer_number DESC`).all(...params).map(mapCustomer);
  }

  customer(actor, id) {
    const row = this.db.prepare("SELECT * FROM customers WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("customer_not_found", 404);
    const customer = mapCustomer(row);
    customer.related_estimates = this.db
      .prepare("SELECT id, estimate_number, status, total_cents FROM estimates WHERE customer_id = ? AND tenant_id = ? ORDER BY estimate_number DESC")
      .all(id, actor.tenant_id);
    customer.related_orders = this.db
      .prepare("SELECT id, order_number, status, total_cents FROM orders WHERE customer_id = ? AND tenant_id = ? ORDER BY order_number DESC")
      .all(id, actor.tenant_id);
    return customer;
  }

  updateCustomer(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    this.customer(actor, id);
    const input = z
      .object({
        contact_name: z.string().min(1).optional(),
        business_name: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        billing_address: addressSchema.optional(),
        active: z.boolean().optional(),
        tax_exempt: z.boolean().optional(),
        tax_exemption_note: z.string().nullable().optional(),
        internal_notes: z.string().nullable().optional(),
      })
      .parse(payload);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "billing_address") {
        fields.push("billing_line1 = ?", "billing_line2 = ?", "billing_city = ?", "billing_state = ?", "billing_postal_code = ?", "billing_country = ?");
        values.push(value.line1, value.line2 ?? null, value.city, value.state, value.postal_code, value.country);
      } else {
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? bool(value) : value ?? null);
      }
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE customers SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    const updated = this.customer(actor, id);
    this.audit(actor, "customer.update", "customer", id, updated.portable_id, "Customer updated", input);
    return updated;
  }

  validateSameTenantUser(actor, userId) {
    if (!userId) return null;
    const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(userId, actor.tenant_id);
    if (!user) throw error("assigned_user_not_same_tenant", 400);
    return userId;
  }

  prepareItems(actor, items) {
    return z.array(quickItemSchema).min(1).parse(items).map((item, position) => ({
      ...item,
      position,
      assigned_user_id: this.validateSameTenantUser(actor, item.assigned_user_id ?? null),
      line_total_cents: lineTotalCents(item.quantity_decimal, item.unit_price_cents),
    }));
  }

  prepareWorkspaceItems(actor, items) {
    return z.array(workspaceItemSchema).min(1).parse(items).map((item, position) => {
      const nextStage = item.completed ? "complete" : item.production_stage === "complete" ? "complete" : item.production_stage;
      return {
        ...item,
        position,
        production_stage: nextStage,
        completed: item.completed || nextStage === "complete",
        assigned_user_id: this.validateSameTenantUser(actor, item.assigned_user_id ?? null),
        line_total_cents: lineTotalCents(item.quantity_decimal, item.unit_price_cents),
      };
    });
  }

  insertOrderItems(actor, orderId, items, timestamp = now()) {
    for (const item of items) {
      this.db
        .prepare(
          `INSERT INTO order_items
           (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, description, quantity_decimal,
            unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
            assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(item.id || randomUUID(), item.portable_id || portable("order_item"), actor.tenant_id, orderId, item.source_estimate_item_id ?? null, item.position, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.production_stage || "not_started", bool(item.completed), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    }
  }

  assertInvoicedFinancialLock(existing, nextItems, nextDiscount) {
    if (nextDiscount !== undefined && nextDiscount !== existing.discount_cents) throw error("invoiced_order_financial_lock", 409);
    const currentIds = existing.items.map((item) => item.id);
    const nextIds = nextItems.map((item) => item.id).filter(Boolean);
    if (currentIds.length !== nextIds.length || currentIds.some((id, index) => nextIds[index] !== id)) throw error("invoiced_order_financial_lock", 409);
    const currentById = new Map(existing.items.map((item) => [item.id, item]));
    for (const next of nextItems) {
      const current = currentById.get(next.id);
      if (
        !current ||
        current.description !== next.description ||
        current.quantity_decimal !== next.quantity_decimal ||
        current.unit_price_cents !== next.unit_price_cents ||
        Boolean(current.taxable) !== Boolean(next.taxable)
      ) throw error("invoiced_order_financial_lock", 409);
    }
  }

  customerSnapshot(actor, customerId) {
    const customer = this.customer(actor, customerId);
    const tenant = this.tenant(actor.tenant_id);
    return { customer, tenant, tax_exempt: customer.tax_exempt, tax_rate: tenant.sales_tax_rate_basis_points };
  }

  createEstimate(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        customer_id: z.string().min(1),
        document_date: z.string().default(today),
        expires_at: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
        status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).default("draft"),
        discount_cents: z.number().int().nonnegative().default(0),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1),
      })
      .parse(payload);
    const items = this.prepareItems(actor, input.items);
    const snapshot = this.customerSnapshot(actor, input.customer_id);
    const totals = documentTotals(items, input.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
    return this.transaction(() => {
      const id = randomUUID();
      const pid = portable("estimate");
      const timestamp = now();
      const number = this.nextNumber(actor.tenant_id, "estimate", "E");
      this.db
        .prepare(
          `INSERT INTO estimates
           (id, portable_id, tenant_id, customer_id, estimate_number, document_date, expires_at, follow_up_at, status,
            customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
            internal_notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, input.customer_id, number, input.document_date, input.expires_at ?? null, input.follow_up_at ?? null, input.status, bool(snapshot.tax_exempt), snapshot.tax_rate, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, input.internal_notes ?? null, timestamp, timestamp);
      this.insertEstimateItems(actor, id, items, timestamp);
      this.audit(actor, "estimate.create", "estimate", id, pid, `Estimate ${number} created`, totals);
      return this.estimate(actor, id);
    });
  }

  insertEstimateItems(actor, estimateId, items, timestamp = now()) {
    for (const item of items) {
      this.db
        .prepare(
          `INSERT INTO estimate_items
           (id, portable_id, tenant_id, estimate_id, position, description, quantity_decimal, unit_price_cents, line_total_cents,
            taxable, production_required, due_date, assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(item.id || randomUUID(), portable("estimate_item"), actor.tenant_id, estimateId, item.position, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    }
  }

  estimate(actor, id) {
    const row = this.db.prepare("SELECT * FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("estimate_not_found", 404);
    const items = this.db
      .prepare("SELECT * FROM estimate_items WHERE estimate_id = ? AND tenant_id = ? ORDER BY position")
      .all(id, actor.tenant_id)
      .map((item) => mapItem(item, "estimate_id"));
    return mapEstimate(row, items);
  }

  listEstimates(actor) {
    return this.db.prepare("SELECT * FROM estimates WHERE tenant_id = ? ORDER BY estimate_number DESC").all(actor.tenant_id).map((row) => mapEstimate(row));
  }

  updateEstimate(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.estimate(actor, id);
    if (existing.converted_order_id) throw error("converted_estimate_locked", 409);
    const input = z
      .object({
        document_date: z.string().optional(),
        expires_at: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
        status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).optional(),
        discount_cents: z.number().int().nonnegative().optional(),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1).optional(),
      })
      .parse(payload);
    if (!Object.keys(input).length) throw error("no_updates");
    const fields = [];
    const values = [];
    return this.transaction(() => {
      if (input.items || input.discount_cents !== undefined) {
        const snapshot = { tax_exempt: existing.customer_tax_exempt_snapshot, tax_rate: existing.tax_rate_basis_points_snapshot };
        const items = input.items ? this.prepareItems(actor, input.items) : existing.items;
        const totals = documentTotals(items, input.discount_cents ?? existing.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
        Object.assign(input, totals);
        if (input.items) {
          this.db.prepare("DELETE FROM estimate_items WHERE estimate_id = ? AND tenant_id = ?").run(id, actor.tenant_id);
          this.insertEstimateItems(actor, id, items);
        }
      }
      for (const [key, value] of Object.entries(input)) {
        if (key === "items") continue;
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? bool(value) : value ?? null);
      }
      fields.push("updated_at = ?");
      values.push(now(), id, actor.tenant_id);
      this.db.prepare(`UPDATE estimates SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
      const updated = this.estimate(actor, id);
      this.audit(actor, "estimate.update", "estimate", id, updated.portable_id, "Estimate updated", input);
      return updated;
    });
  }

  duplicateEstimate(actor, id) {
    const source = this.estimate(actor, id);
    return this.createEstimate(actor, {
      customer_id: source.customer_id,
      document_date: today(),
      expires_at: source.expires_at,
      follow_up_at: source.follow_up_at,
      status: "draft",
      discount_cents: source.discount_cents,
      internal_notes: source.internal_notes,
      items: source.items.map(({ description, quantity_decimal, unit_price_cents, taxable, production_required, due_date, assigned_user_id, internal_note }) => ({
        description,
        quantity_decimal,
        unit_price_cents,
        taxable,
        production_required,
        due_date,
        assigned_user_id,
        internal_note,
      })),
    });
  }

  convertEstimate(actor, id) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT converted_order_id FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("estimate_not_found", 404);
      if (existing.converted_order_id) {
        const order = this.order(actor, existing.converted_order_id);
        return { order, already_converted: true };
      }
      const estimate = this.estimate(actor, id);
      const order = this.createOrderInternal(actor, {
        customer_id: estimate.customer_id,
        source_estimate_id: id,
        document_date: today(),
        due_date: null,
        status: "active",
        discount_cents: estimate.discount_cents,
        internal_notes: estimate.internal_notes,
        snapshot: {
          customer_tax_exempt_snapshot: estimate.customer_tax_exempt_snapshot,
          tax_rate_basis_points_snapshot: estimate.tax_rate_basis_points_snapshot,
        },
        items: estimate.items.map((item) => ({
          ...item,
          source_estimate_item_id: item.id,
        })),
      });
      this.db.prepare("UPDATE estimates SET status = 'accepted', converted_order_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(order.id, now(), id, actor.tenant_id);
      this.audit(actor, "estimate.convert", "estimate", id, estimate.portable_id, `Estimate ${estimate.estimate_number} converted to ${order.order_number}`, { order_id: order.id });
      return { order, already_converted: false };
    });
  }

  createOrder(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        customer_id: z.string().min(1),
        document_date: z.string().default(today),
        due_date: z.string().nullable().optional(),
        status: z.enum(["draft", "active", "on_hold", "complete", "cancelled"]).default("draft"),
        discount_cents: z.number().int().nonnegative().default(0),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1),
      })
      .parse(payload);
    this.customer(actor, input.customer_id);
    const items = this.prepareItems(actor, input.items);
    return this.transaction(() => this.createOrderInternal(actor, { ...input, items }));
  }

  createOrderInternal(actor, payload) {
    const snapshot = payload.snapshot ?? this.customerSnapshot(actor, payload.customer_id);
    const taxExempt = snapshot.customer_tax_exempt_snapshot ?? snapshot.tax_exempt;
    const taxRate = snapshot.tax_rate_basis_points_snapshot ?? snapshot.tax_rate;
    const totals = documentTotals(payload.items, payload.discount_cents ?? 0, taxRate, taxExempt);
    const id = randomUUID();
    const pid = portable("order");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "order", "O");
    this.db
      .prepare(
        `INSERT INTO orders
         (id, portable_id, tenant_id, customer_id, source_estimate_id, order_number, document_date, due_date, status,
          customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
          internal_notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, pid, actor.tenant_id, payload.customer_id, payload.source_estimate_id ?? null, number, payload.document_date ?? today(), payload.due_date ?? null, payload.status ?? "draft", bool(taxExempt), taxRate, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, payload.internal_notes ?? null, timestamp, timestamp);
    payload.items.forEach((item, position) => {
      this.db
        .prepare(
          `INSERT INTO order_items
           (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, description, quantity_decimal,
            unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
            assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), portable("order_item"), actor.tenant_id, id, item.source_estimate_item_id ?? null, position, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    });
    this.audit(actor, "order.create", "order", id, pid, `Order ${number} created`, totals);
    return this.order(actor, id);
  }

  listOrders(actor) {
    return this.db.prepare("SELECT * FROM orders WHERE tenant_id = ? ORDER BY order_number DESC").all(actor.tenant_id).map((row) => {
      const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(row.id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
      return mapOrder(row, items);
    });
  }

  order(actor, id) {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("order_not_found", 404);
    const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
    const order = mapOrder(row, items);
    order.invoice = this.db.prepare("SELECT id, invoice_number, document_status, payment_status FROM invoices WHERE order_id = ? AND tenant_id = ?").get(id, actor.tenant_id) ?? null;
    return order;
  }

  orderWorkspace(actor, id) {
    const order = this.order(actor, id);
    return {
      order,
      customer: this.customer(actor, order.customer_id),
      users: this.users(actor).filter((user) => user.active),
      attachments: this.listOrderAttachments(actor, id),
    };
  }

  updateOrderWorkspace(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.order(actor, id);
    const input = orderWorkspaceSchema.parse(payload);
    if (input.expected_updated_at && input.expected_updated_at !== existing.updated_at) throw error("order_conflict", 409);
    if (!Object.keys(input).filter((key) => key !== "expected_updated_at").length) throw error("no_updates");
    const nextItems = input.items ? this.prepareWorkspaceItems(actor, input.items) : existing.items;
    if (existing.invoice && input.items) this.assertInvoicedFinancialLock(existing, nextItems, input.discount_cents);
    if (existing.invoice && input.discount_cents !== undefined && input.discount_cents !== existing.discount_cents) throw error("invoiced_order_financial_lock", 409);
    const totals = input.items || input.discount_cents !== undefined
      ? documentTotals(nextItems, input.discount_cents ?? existing.discount_cents, existing.tax_rate_basis_points_snapshot, existing.customer_tax_exempt_snapshot)
      : null;
    return this.transaction(() => {
      const timestamp = now();
      const fields = [];
      const values = [];
      for (const key of ["document_date", "due_date", "status", "internal_notes"]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
          fields.push(`${key} = ?`);
          values.push(input[key] ?? null);
        }
      }
      if (totals) {
        fields.push("subtotal_cents = ?", "discount_cents = ?", "tax_cents = ?", "total_cents = ?");
        values.push(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents);
      }
      fields.push("updated_at = ?");
      values.push(timestamp, id, actor.tenant_id);
      this.db.prepare(`UPDATE orders SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
      if (input.items) {
        this.db.prepare("DELETE FROM order_items WHERE order_id = ? AND tenant_id = ?").run(id, actor.tenant_id);
        this.insertOrderItems(actor, id, nextItems, timestamp);
      }
      const updated = this.order(actor, id);
      this.audit(actor, "order.workspace_update", "order", id, updated.portable_id, `Order ${updated.order_number} workspace saved`, { fields: Object.keys(input).filter((key) => key !== "expected_updated_at") });
      return this.orderWorkspace(actor, id);
    });
  }

  productionBoard(actor, filters = {}) {
    const users = new Map(this.users(actor).map((user) => [user.id, user]));
    const rows = this.db
      .prepare(
        `SELECT oi.*, o.order_number, o.status AS order_status, c.contact_name, c.business_name
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ? AND oi.production_required = 1
         ORDER BY COALESCE(oi.due_date, o.due_date, '9999-12-31'), o.order_number, oi.position`,
      )
      .all(actor.tenant_id)
      .map((row) => {
        const item = mapItem(row, "order_id");
        return {
          ...item,
          order_number: row.order_number,
          order_status: row.order_status,
          customer_name: row.business_name || row.contact_name,
          assigned_user: row.assigned_user_id ? users.get(row.assigned_user_id) || null : null,
          late: Boolean(item.due_date && item.due_date < today() && item.production_stage !== "complete"),
          production_progress: this.order(actor, row.order_id).production_progress,
        };
      })
      .filter((row) => !filters.stage || filters.stage === "all" || row.production_stage === filters.stage)
      .filter((row) => !filters.assigned_user_id || filters.assigned_user_id === "all" || row.assigned_user_id === filters.assigned_user_id)
      .filter((row) => filters.due_state !== "late" || row.late)
      .filter((row) => filters.due_state !== "unassigned" || !row.assigned_user_id);
    return { stages: PRODUCTION_STAGES, items: rows, users: [...users.values()].filter((user) => user.active) };
  }

  setProductionStage(actor, itemId, stage) {
    this.requireRole(actor, WRITE_ROLES);
    if (!PRODUCTION_STAGES.includes(stage)) throw error("invalid_production_stage", 400);
    const row = this.db.prepare("SELECT * FROM order_items WHERE id = ? AND tenant_id = ?").get(itemId, actor.tenant_id);
    if (!row) throw error("order_item_not_found", 404);
    const from = row.production_stage;
    const completed = stage === "complete";
    this.db.prepare("UPDATE order_items SET production_stage = ?, completed = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(stage, bool(completed), now(), itemId, actor.tenant_id);
    const order = this.order(actor, row.order_id);
    this.audit(actor, "production.stage_move", "order_item", itemId, row.portable_id, `Item moved from ${from} to ${stage}`, { from, to: stage, order_id: row.order_id });
    return { item: this.order(actor, row.order_id).items.find((item) => item.id === itemId), order_progress: order.production_progress };
  }

  setItemCompletion(actor, itemId, completed) {
    this.requireRole(actor, WRITE_ROLES);
    const row = this.db.prepare("SELECT * FROM order_items WHERE id = ? AND tenant_id = ?").get(itemId, actor.tenant_id);
    if (!row) throw error("order_item_not_found", 404);
    const stage = completed ? "complete" : ACTIVE_REOPEN_STAGE;
    this.db.prepare("UPDATE order_items SET completed = ?, production_stage = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(bool(completed), stage, now(), itemId, actor.tenant_id);
    const action = completed ? "production.complete" : "production.reopen";
    this.audit(actor, action, "order_item", itemId, row.portable_id, completed ? "Production item completed" : "Production item reopened", { order_id: row.order_id, stage });
    return { item: this.order(actor, row.order_id).items.find((item) => item.id === itemId), order_progress: this.order(actor, row.order_id).production_progress };
  }

  validateAttachmentInput(filename, mimeType, buffer) {
    const original = safeFilename(filename);
    const size = buffer?.length || 0;
    if (!size) throw error("attachment_empty", 400);
    if (size > uploadLimitBytes()) throw error("attachment_too_large", 413);
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) throw error("attachment_type_not_allowed", 400);
    if (BLOCKED_EXTENSION_RE.test(original)) throw error("attachment_type_not_allowed", 400);
    return original;
  }

  listOrderAttachments(actor, orderId) {
    this.order(actor, orderId);
    return this.db
      .prepare("SELECT * FROM order_attachments WHERE tenant_id = ? AND order_id = ? AND deleted_at IS NULL ORDER BY created_at DESC")
      .all(actor.tenant_id, orderId)
      .map(mapAttachment);
  }

  uploadOrderAttachment(actor, orderId, file) {
    this.requireRole(actor, WRITE_ROLES);
    const order = this.order(actor, orderId);
    const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
    const mimeType = file?.mime_type || file?.mimeType || "application/octet-stream";
    const original = this.validateAttachmentInput(file?.filename, mimeType, buffer);
    const id = randomUUID();
    const pid = portable("order_attachment");
    const timestamp = now();
    const extension = original.includes(".") ? original.slice(original.lastIndexOf(".")).toLowerCase() : "";
    const storageKey = join(actor.tenant_id, orderId, `${randomUUID()}${extension}`).replace(/\\/g, "/");
    const finalPath = this.attachmentPath(storageKey);
    const tmpPath = `${finalPath}.tmp-${randomUUID()}`;
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    try {
      writeFileSync(tmpPath, buffer, { flag: "wx" });
      renameSync(tmpPath, finalPath);
      this.db
        .prepare(
          `INSERT INTO order_attachments
           (id, portable_id, tenant_id, order_id, original_filename, storage_key, mime_type, byte_size, sha256, created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, orderId, original, storageKey, mimeType, buffer.length, sha256, actor.id, timestamp);
      this.audit(actor, "attachment.upload", "order", orderId, order.portable_id, `Attachment ${original} uploaded`, { attachment_id: id, sha256 });
      return mapAttachment(this.db.prepare("SELECT * FROM order_attachments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
    } catch (err) {
      try {
        if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
        if (existsSync(finalPath) && !this.db.prepare("SELECT id FROM order_attachments WHERE storage_key = ?").get(storageKey)) rmSync(finalPath, { force: true });
      } catch {
        // Best-effort cleanup; the original failure remains authoritative.
      }
      throw err;
    }
  }

  attachmentRecord(actor, orderId, attachmentId, { includeDeleted = false } = {}) {
    this.order(actor, orderId);
    const row = this.db
      .prepare(`SELECT * FROM order_attachments WHERE id = ? AND order_id = ? AND tenant_id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`)
      .get(attachmentId, orderId, actor.tenant_id);
    if (!row) throw error("attachment_not_found", 404);
    return row;
  }

  attachmentDownload(actor, orderId, attachmentId, { preview = false } = {}) {
    const row = this.attachmentRecord(actor, orderId, attachmentId);
    if (preview && !PREVIEW_ATTACHMENT_MIME_TYPES.has(row.mime_type)) throw error("attachment_preview_not_allowed", 400);
    const fullPath = this.attachmentPath(row.storage_key);
    if (!existsSync(fullPath)) throw error("attachment_file_missing", 404);
    const stat = lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw error("attachment_file_missing", 404);
    const disposition = preview ? "inline" : "attachment";
    const order = this.order(actor, orderId);
    this.audit(actor, preview ? "attachment.preview" : "attachment.download", "order", orderId, order.portable_id, `${preview ? "Previewed" : "Downloaded"} ${row.original_filename}`, { attachment_id: attachmentId });
    return {
      stream: createReadStream(fullPath),
      byte_size: row.byte_size,
      mime_type: row.mime_type,
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": contentDisposition(row.original_filename, disposition),
        "X-Content-Type-Options": "nosniff",
      },
    };
  }

  deleteOrderAttachment(actor, orderId, attachmentId) {
    this.requireRole(actor, WRITE_ROLES);
    const row = this.attachmentRecord(actor, orderId, attachmentId);
    const deletedAt = now();
    this.db.prepare("UPDATE order_attachments SET deleted_at = ? WHERE id = ? AND tenant_id = ?").run(deletedAt, attachmentId, actor.tenant_id);
    const order = this.order(actor, orderId);
    this.audit(actor, "attachment.delete", "order", orderId, order.portable_id, `Attachment ${row.original_filename} deleted`, { attachment_id: attachmentId });
    return { ok: true, deleted_at: deletedAt };
  }

  updateOrderStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!["draft", "active", "on_hold", "complete", "cancelled"].includes(status)) throw error("invalid_order_status");
    const order = this.order(actor, id);
    this.db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, now(), id, actor.tenant_id);
    this.audit(actor, "order.status", "order", id, order.portable_id, `Order status changed to ${status}`, { from: order.status, to: status });
    return this.order(actor, id);
  }

  createOrOpenInvoice(actor, orderId, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
    if (existing) return { invoice: mapInvoice(existing), already_exists: true };
    return this.transaction(() => {
      const existingInTxn = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
      if (existingInTxn) return { invoice: mapInvoice(existingInTxn), already_exists: true };
      const order = this.order(actor, orderId);
      const id = randomUUID();
      const pid = portable("invoice");
      const timestamp = now();
      const number = this.nextNumber(actor.tenant_id, "invoice", "I");
      try {
        this.db
          .prepare(
            `INSERT INTO invoices
             (id, portable_id, tenant_id, order_id, customer_id, invoice_number, document_date, due_date, document_status, payment_status,
              customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
              amount_paid_cents, balance_due_cents, historical_amount_paid_note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unpaid', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, order.id, order.customer_id, number, payload.document_date ?? today(), payload.due_date ?? order.due_date ?? null, bool(order.customer_tax_exempt_snapshot), order.tax_rate_basis_points_snapshot, order.subtotal_cents, order.discount_cents, order.tax_cents, order.total_cents, order.total_cents, "Payment information is manually recorded.", timestamp, timestamp);
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
          const winner = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
          if (winner) return { invoice: mapInvoice(winner), already_exists: true };
        }
        throw err;
      }
      this.audit(actor, "invoice.create", "invoice", id, pid, `Invoice ${number} created from ${order.order_number}`, { order_id: order.id });
      return { invoice: this.invoice(actor, id), already_exists: false };
    });
  }

  invoice(actor, id) {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("invoice_not_found", 404);
    return mapInvoice(row);
  }

  listInvoices(actor) {
    return this.db.prepare("SELECT * FROM invoices WHERE tenant_id = ? ORDER BY invoice_number DESC").all(actor.tenant_id).map(mapInvoice);
  }

  setInvoiceDocumentStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!["draft", "issued", "void"].includes(status)) throw error("invalid_invoice_document_status");
    const invoice = this.invoice(actor, id);
    if (invoice.document_status === "void") throw error("invoice_void");
    this.db.prepare("UPDATE invoices SET document_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, now(), id, actor.tenant_id);
    this.audit(actor, "invoice.document_status", "invoice", id, invoice.portable_id, `Invoice document status changed to ${status}`, { from: invoice.document_status, to: status });
    return this.invoice(actor, id);
  }

  recordInvoicePayment(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = z.object({ amount_paid_cents: z.number().int().nonnegative(), note: z.string().nullable().optional() }).parse(payload);
    const invoice = this.invoice(actor, id);
    if (invoice.document_status === "void") throw error("invoice_void");
    const status = paymentStatus(invoice.total_cents, input.amount_paid_cents);
    const balance = invoice.total_cents - input.amount_paid_cents;
    this.db
      .prepare(
        "UPDATE invoices SET amount_paid_cents = ?, balance_due_cents = ?, payment_status = ?, historical_amount_paid_note = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      )
      .run(input.amount_paid_cents, balance, status, input.note ?? "Payment information is manually recorded.", now(), id, actor.tenant_id);
    this.audit(actor, "invoice.payment_status", "invoice", id, invoice.portable_id, `Invoice payment manually recorded as ${status}`, { amount_paid_cents: input.amount_paid_cents, balance_due_cents: balance });
    return this.invoice(actor, id);
  }

  auditTrail(actor, entityType, entityId) {
    return this.db
      .prepare("SELECT *, diff_json FROM audit_events WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? ORDER BY occurred_at DESC")
      .all(actor.tenant_id, entityType, entityId)
      .map((row) => ({ ...row, diff: parseJson(row.diff_json), diff_json: undefined }));
  }

  documentPdf(actor, type, id) {
    const tenant = this.tenant(actor.tenant_id);
    const doc = type === "estimate" ? this.estimate(actor, id) : this.invoice(actor, id);
    const customer = this.customer(actor, doc.customer_id);
    const currency = (value) => formatCents(value, tenant.currency, tenant.locale);
    const lines = [
      `Company: ${tenant.company_name}`,
      `Company address: ${tenant.address.line1}${tenant.address.line2 ? `, ${tenant.address.line2}` : ""}, ${tenant.address.city}, ${tenant.address.state} ${tenant.address.postal_code}, ${tenant.address.country}`,
      `Company contact: ${tenant.contact_email || ""} ${tenant.contact_phone || ""}`.trim(),
      `Customer: ${customer.contact_name}${customer.business_name ? ` / ${customer.business_name}` : ""}`,
      `Customer email: ${customer.email || ""} phone: ${customer.phone || ""}`,
      `Billing address: ${customer.billing_address.line1}${customer.billing_address.line2 ? `, ${customer.billing_address.line2}` : ""}, ${customer.billing_address.city}, ${customer.billing_address.state} ${customer.billing_address.postal_code}, ${customer.billing_address.country}`,
      type === "estimate" ? `Estimate ${doc.estimate_number} status ${doc.status}` : `Invoice ${doc.invoice_number} document ${doc.document_status} payment ${doc.payment_status}`,
      `Document date: ${doc.document_date}`,
    ];
    if (type === "estimate") {
      lines.push(`Expiration date: ${doc.expires_at || ""}`);
      lines.push(`Follow-up date: ${doc.follow_up_at || ""}`);
    } else {
      lines.push(`Due date: ${doc.due_date || ""}`);
    }
    const items = type === "estimate" ? doc.items : this.order(actor, doc.order_id).items;
    for (const item of items) {
      lines.push(`${item.description} | Qty ${item.quantity_decimal} | Unit ${currency(item.unit_price_cents)} | Line ${currency(item.line_total_cents)} | ${item.taxable ? "Taxable" : "Non-taxable"}`);
    }
    lines.push(`Subtotal ${currency(doc.subtotal_cents)}`);
    lines.push(`Discount ${currency(doc.discount_cents)}`);
    lines.push(`Tax ${currency(doc.tax_cents)}`);
    lines.push(`Total ${currency(doc.total_cents)}`);
    if (type === "invoice") {
      lines.push(`Amount paid ${currency(doc.amount_paid_cents)}`);
      lines.push(`Balance due ${currency(doc.balance_due_cents)}`);
      lines.push("Payment information is manually recorded.");
    }
    return renderPdf({ title: type === "estimate" ? "Estimate" : "Invoice", lines });
  }
}
