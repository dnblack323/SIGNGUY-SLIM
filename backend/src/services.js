import { hashPassword, hashToken, newSessionToken, sessionExpiry, verifyPassword } from "./security.js";
import { renderPdf } from "./pdf.js";
import { backupHistory, createEncryptedBackup, previewBackup, restoreBackup } from "./backup.js";
import { installEmployeeDomain } from "./domains/employees/index.js";
import { installGeneralDomain } from "./domains/general/index.js";
import { ADMIN_ROLES, ROLES, addressSchema, assertInside, assertNoSymlinkAncestors, bool, dirname, error, existsSync, formatCents, join, lstatSync, mapTenant, mapUser, mkdirSync, now, parseJson, portable, randomUUID, realpathSync, storageRoot, z } from "./domains/shared.js";

export class SlimService {
  constructor(db, options = {}) {
    this.db = db;
    this.inTransaction = false;
    this.emailTransport = options.emailTransport || null;
  }

  attachmentPath(storageKey) {
    const root = storageRoot();
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw error("attachment_path_invalid", 400);
    const realRoot = realpathSync(root);
    assertNoSymlinkAncestors(realRoot, dirname(realRoot));
    const fullPath = assertInside(realRoot, join(realRoot, storageKey));
    const parent = dirname(fullPath);
    mkdirSync(parent, { recursive: true });
    assertNoSymlinkAncestors(parent, realRoot);
    if (existsSync(fullPath) && lstatSync(fullPath).isSymbolicLink()) throw error("attachment_path_invalid", 400);
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

  auditSystem(tenantId, action, entityType, entityId, entityPortableId, summary, diff = null) {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (id, portable_id, tenant_id, actor_user_id, action, entity_type, entity_id, entity_portable_id, summary, diff_json, occurred_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), portable("audit_event"), tenantId, action, entityType, entityId, entityPortableId, summary, diff ? JSON.stringify(diff) : null, now());
  }

  requireRole(actor, allowed) {
    if (!actor || !allowed.has(actor.role) || !actor.active) throw error("permission_denied", 403);
  }

  requireBackupRole(actor) {
    this.requireRole(actor, ADMIN_ROLES);
  }

  createBackup(actor, payload) {
    try {
      return createEncryptedBackup(this, actor, payload);
    } catch (err) {
      if (actor?.tenant_id && actor?.id && actor?.role && ADMIN_ROLES.has(actor.role)) {
        this.audit(actor, "backup.failed", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Slim backup failed", { error: err.message });
      }
      throw err;
    }
  }

  previewBackup(actor, file, payload) {
    try {
      return previewBackup(this, actor, file, payload?.passphrase || "");
    } catch (err) {
      if (actor?.tenant_id && actor?.id && actor?.role && ADMIN_ROLES.has(actor.role)) {
        this.audit(actor, "backup.validation_failed", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Slim backup validation failed", { error: err.message });
      }
      throw err;
    }
  }

  restoreBackup(actor, file, payload) {
    return restoreBackup(this, actor, file, payload);
  }

  backupHistory(actor) {
    return backupHistory(this, actor);
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
      const intakeAddress = this.composeIntakeAddress(input.tenant_slug, randomUUID().replace(/-/g, ""));
      this.db
        .prepare(
          `INSERT INTO tenant_intake_addresses
           (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(randomUUID(), tenantId, intakeAddress.token, intakeAddress.full, userId, created, created);
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
    return { access_token: token, token_type: "bearer", ...this.sessionPayload(user) };
  }

  sessionPayload(user) {
    return { user, tenant: this.tenant(user.tenant_id), capabilities: this.capabilitiesForActor(user) };
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
    return {
      tenant: this.tenant(actor.tenant_id),
      users: this.users(actor),
      email_settings: this.emailSettings(actor),
      intake_address: this.ensureIntakeAddress(actor),
    };
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

  tenantTimezone(actor) {
    return this.tenant(actor.tenant_id).shop_timezone || "America/New_York";
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
      type === "estimate" ? `Quote ${doc.estimate_number} status ${doc.status}` : `Invoice ${doc.invoice_number} document ${doc.document_status} payment ${doc.payment_status}`,
      `Document date: ${doc.document_date}`,
    ];
    if (type === "estimate") {
      lines.push(`Expiration date: ${doc.expires_at || ""}`);
      lines.push(`Follow-up date: ${doc.follow_up_at || ""}`);
    } else {
      lines.push(`Due date: ${doc.due_date || ""}`);
    }
    const items = type === "estimate" ? doc.items : this.order(actor, doc.order_id).items;
    const bundles = doc.bundles || [];
    const bundledItemIds = new Set();
    for (const bundle of bundles) {
      lines.push(`Bundle: ${bundle.title}${bundle.description ? ` - ${bundle.description}` : ""} | Total ${currency(bundle.total_cents)}`);
      for (const item of bundle.items) {
        bundledItemIds.add(item.id);
        if (bundle.show_member_prices) {
          const lineCents = bundle.pricing_mode === "bundle_price" ? item.allocated_cents : item.line_total_cents;
          lines.push(`  ${item.title} | Qty ${item.quantity_decimal} | Line ${currency(lineCents)} | ${item.taxable ? "Taxable" : "Non-taxable"}`);
        } else {
          lines.push(`  ${item.title} | Qty ${item.quantity_decimal}`);
        }
      }
    }
    for (const item of items.filter((entry) => !bundledItemIds.has(entry.id))) {
      lines.push(`${item.title} | Qty ${item.quantity_decimal} | Unit ${currency(item.unit_price_cents)} | Line ${currency(item.line_total_cents)} | ${item.taxable ? "Taxable" : "Non-taxable"}`);
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
    return renderPdf({ title: type === "estimate" ? "Quote" : "Invoice", lines });
  }
}

installGeneralDomain(SlimService);
installEmployeeDomain(SlimService);
