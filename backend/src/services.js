import { randomUUID } from "node:crypto";
import { z } from "zod";
import { documentTotals, lineTotalCents, paymentStatus } from "./money.js";
import { hashPassword, hashToken, newSessionToken, sessionExpiry, verifyPassword } from "./security.js";
import { renderPdf } from "./pdf.js";

const ROLES = ["owner", "admin", "manager", "staff"];
const WRITE_ROLES = new Set(ROLES);
const ADMIN_ROLES = new Set(["owner", "admin"]);
const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);

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
  quantity_decimal: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/),
  unit_price_cents: z.number().int().nonnegative(),
  taxable: z.boolean(),
  production_required: z.boolean(),
  due_date: z.string().nullable().optional(),
  assigned_user_id: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
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
  return inflateBool(
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

export class SlimService {
  constructor(db) {
    this.db = db;
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
    if (!row) throw error("unauthorized", 401);
    return mapUser(row);
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
    if (existing.role === "owner" && id !== actor.id) throw error("owner_role_locked", 403);
    const input = z
      .object({
        display_name: z.string().min(1).optional(),
        role: z.enum(ROLES).optional(),
        active: z.boolean().optional(),
      })
      .parse(payload);
    if (input.role === "owner" && actor.role !== "owner") throw error("owner_role_requires_owner", 403);
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
    const user = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id));
    this.audit(actor, "user.update", "user", user.id, user.portable_id, `User ${user.display_name} updated`, input);
    return user;
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
    const id = randomUUID();
    const pid = portable("estimate");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "estimate", "E");
    this.db.exec("BEGIN IMMEDIATE");
    try {
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
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.audit(actor, "estimate.create", "estimate", id, pid, `Estimate ${number} created`, totals);
    return this.estimate(actor, id);
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
    const fields = [];
    const values = [];
    let totals = null;
    if (input.items) {
      const snapshot = { tax_exempt: existing.customer_tax_exempt_snapshot, tax_rate: existing.tax_rate_basis_points_snapshot };
      const items = this.prepareItems(actor, input.items);
      totals = documentTotals(items, input.discount_cents ?? existing.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
      Object.assign(input, totals);
      this.db.prepare("DELETE FROM estimate_items WHERE estimate_id = ? AND tenant_id = ?").run(id, actor.tenant_id);
      this.insertEstimateItems(actor, id, items);
    }
    for (const [key, value] of Object.entries(input)) {
      if (key === "items") continue;
      fields.push(`${key} = ?`);
      values.push(typeof value === "boolean" ? bool(value) : value ?? null);
    }
    if (fields.length) {
      fields.push("updated_at = ?");
      values.push(now(), id, actor.tenant_id);
      this.db.prepare(`UPDATE estimates SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    }
    const updated = this.estimate(actor, id);
    this.audit(actor, "estimate.update", "estimate", id, updated.portable_id, "Estimate updated", input);
    return updated;
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT converted_order_id FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("estimate_not_found", 404);
      if (existing.converted_order_id) {
        const order = this.order(actor, existing.converted_order_id);
        this.db.exec("COMMIT");
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
      this.db.exec("COMMIT");
      this.audit(actor, "estimate.convert", "estimate", id, estimate.portable_id, `Estimate ${estimate.estimate_number} converted to ${order.order_number}`, { order_id: order.id });
      return { order, already_converted: false };
    } catch (err) {
      this.db.exec("ROLLBACK");
      if (String(err.message).includes("UNIQUE")) {
        const row = this.db.prepare("SELECT converted_order_id FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
        if (row?.converted_order_id) return { order: this.order(actor, row.converted_order_id), already_converted: true };
      }
      throw err;
    }
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
    return this.createOrderInternal(actor, { ...input, items });
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
    return this.db.prepare("SELECT * FROM orders WHERE tenant_id = ? ORDER BY order_number DESC").all(actor.tenant_id).map((row) => mapOrder(row));
  }

  order(actor, id) {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("order_not_found", 404);
    const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
    const order = mapOrder(row, items);
    order.invoice = this.db.prepare("SELECT id, invoice_number, document_status, payment_status FROM invoices WHERE order_id = ? AND tenant_id = ?").get(id, actor.tenant_id) ?? null;
    return order;
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
    const order = this.order(actor, orderId);
    const id = randomUUID();
    const pid = portable("invoice");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "invoice", "I");
    this.db
      .prepare(
        `INSERT INTO invoices
         (id, portable_id, tenant_id, order_id, customer_id, invoice_number, document_date, due_date, document_status, payment_status,
          customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
          amount_paid_cents, balance_due_cents, historical_amount_paid_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unpaid', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(id, pid, actor.tenant_id, order.id, order.customer_id, number, payload.document_date ?? today(), payload.due_date ?? order.due_date ?? null, bool(order.customer_tax_exempt_snapshot), order.tax_rate_basis_points_snapshot, order.subtotal_cents, order.discount_cents, order.tax_cents, order.total_cents, order.total_cents, "Payment information is manually recorded.", timestamp, timestamp);
    this.audit(actor, "invoice.create", "invoice", id, pid, `Invoice ${number} created from ${order.order_number}`, { order_id: order.id });
    return { invoice: this.invoice(actor, id), already_exists: false };
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
    const lines = [
      tenant.company_name,
      `${customer.contact_name}${customer.business_name ? ` / ${customer.business_name}` : ""}`,
      `${customer.billing_address.line1}, ${customer.billing_address.city}, ${customer.billing_address.state} ${customer.billing_address.postal_code}`,
      type === "estimate" ? `Estimate ${doc.estimate_number} ${doc.status}` : `Invoice ${doc.invoice_number} ${doc.document_status} / ${doc.payment_status}`,
      `Date ${doc.document_date}`,
    ];
    const items = type === "estimate" ? doc.items : this.order(actor, doc.order_id).items;
    for (const item of items) {
      lines.push(`${item.description} | Qty ${item.quantity_decimal} | Unit ${item.unit_price_cents} | Line ${item.line_total_cents}`);
    }
    lines.push(`Subtotal ${doc.subtotal_cents}`);
    lines.push(`Discount ${doc.discount_cents}`);
    lines.push(`Tax ${doc.tax_cents}`);
    lines.push(`Total ${doc.total_cents}`);
    if (type === "invoice") {
      lines.push(`Amount paid ${doc.amount_paid_cents}`);
      lines.push(`Balance due ${doc.balance_due_cents}`);
      lines.push("Payment information is manually recorded.");
    }
    return renderPdf({ title: type === "estimate" ? "Estimate" : "Invoice", lines });
  }
}
