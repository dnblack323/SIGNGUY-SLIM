import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  constantTimeEqual,
  csrfTokenForSession,
  hashPassword,
  hashToken,
  newSessionToken,
  platformSessionExpiry,
  sessionExpiry,
  verifyPassword,
} from "./security.js";

const PLATFORM_AUTO_LOGIN_ENABLED = () =>
  process.env.NODE_ENV !== "production" && process.env.SIGNGUY_SLIM_PLATFORM_AUTO_LOGIN === "1";

const PLATFORM_ADMIN_EMAIL = () =>
  String(process.env.SIGNGUY_SLIM_PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase();
const PLATFORM_ADMIN_PASSWORD = () => process.env.SIGNGUY_SLIM_PLATFORM_ADMIN_PASSWORD || "";
const PLATFORM_ADMIN_NAME = () =>
  String(process.env.SIGNGUY_SLIM_PLATFORM_ADMIN_NAME || "Platform Creator").trim();

function error(code, status = 400) {
  const err = new Error(code);
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function mapAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function platformAutoLoginEnabled() {
  return PLATFORM_AUTO_LOGIN_ENABLED();
}

export async function seedPlatformAdminFromEnv(db) {
  const email = PLATFORM_ADMIN_EMAIL();
  const password = PLATFORM_ADMIN_PASSWORD();
  if (!email || !password) return null;
  if (password.length < 8) throw new Error("platform_admin_password_too_short");
  const existing = db.prepare("SELECT * FROM platform_admins WHERE email = ?").get(email);
  const timestamp = nowIso();
  if (!existing) {
    const passwordHash = await hashPassword(password);
    db.prepare(
      `INSERT OR IGNORE INTO platform_admins (id, email, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), email, PLATFORM_ADMIN_NAME(), passwordHash, timestamp, timestamp);
  }
  const current = db.prepare("SELECT * FROM platform_admins WHERE email = ?").get(email);
  // Keep password in sync with env so operator can rotate it via env var.
  const stillValid = await verifyPassword(password, current.password_hash);
  if (!stillValid) {
    const passwordHash = await hashPassword(password);
    db.prepare(
      `UPDATE platform_admins SET password_hash = ?, display_name = ?, updated_at = ? WHERE id = ?`,
    ).run(passwordHash, PLATFORM_ADMIN_NAME(), timestamp, current.id);
  }
  return db.prepare("SELECT * FROM platform_admins WHERE email = ?").get(email);
}

export class PlatformAdminService {
  constructor(db) {
    this.db = db;
  }

  async login({ email, password }) {
    const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse({ email, password });
    const generic = error("invalid_platform_credentials", 401);
    const admin = this.db
      .prepare("SELECT * FROM platform_admins WHERE email = ?")
      .get(input.email.toLowerCase());
    if (!admin) throw generic;
    if (!(await verifyPassword(input.password, admin.password_hash))) throw generic;
    return this.issueSession(admin);
  }

  issueSession(admin) {
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    const id = randomUUID();
    const expiresAt = platformSessionExpiry();
    this.db
      .prepare(
        `INSERT INTO platform_admin_sessions (id, admin_id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, admin.id, tokenHash, nowIso(), expiresAt);
    const session = { id, token_hash: tokenHash, expires_at: expiresAt };
    return { token, expires_at: expiresAt, payload: this.sessionPayload(admin, session) };
  }

  actorForToken(token) {
    const row = this.db
      .prepare(
        `SELECT a.*, s.id AS session_id, s.token_hash AS session_token_hash, s.expires_at AS session_expires_at
         FROM platform_admin_sessions s
         JOIN platform_admins a ON a.id = s.admin_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashToken(token || ""), nowIso());
    if (!row) throw error("unauthorized", 401);
    const admin = mapAdmin(row);
    Object.defineProperty(admin, "auth_session", {
      value: {
        id: row.session_id,
        token_hash: row.session_token_hash,
        expires_at: row.session_expires_at,
      },
      enumerable: false,
    });
    return admin;
  }

  verifyCsrf(admin, csrfToken) {
    const expected = csrfTokenForSession(admin?.auth_session);
    return Boolean(expected && csrfToken && constantTimeEqual(expected, csrfToken));
  }

  logout(token) {
    this.db
      .prepare("UPDATE platform_admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(nowIso(), hashToken(token || ""));
    return true;
  }

  sessionPayload(admin, session = admin?.auth_session) {
    return {
      admin: mapAdmin(admin),
      csrf_token: csrfTokenForSession(session),
      auto_login_enabled: platformAutoLoginEnabled(),
    };
  }

  listTenants() {
    const rows = this.db
      .prepare(
        `SELECT t.*,
                (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
                (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.active = 1) AS active_user_count,
                (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = t.id) AS order_count,
                (SELECT COALESCE(SUM(byte_size), 0) FROM (
                   SELECT byte_size FROM order_attachments WHERE tenant_id = t.id
                   UNION ALL SELECT byte_size FROM intake_attachments WHERE tenant_id = t.id
                   UNION ALL SELECT byte_size FROM expense_attachments WHERE tenant_id = t.id
                 )) AS storage_bytes
         FROM tenants t
         ORDER BY t.created_at DESC`,
      )
      .all();
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      company_name: row.company_name,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      created_at: row.created_at,
      suspended_at: row.suspended_at,
      suspended_reason: row.suspended_reason,
      user_count: row.user_count,
      active_user_count: row.active_user_count,
      order_count: row.order_count,
      storage_bytes: row.storage_bytes,
      storage_quota_bytes: row.storage_quota_bytes,
    }));
  }

  listUsers(tenantId) {
    const tenant = this.db.prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    return this.db
      .prepare(
        `SELECT id, tenant_id, display_name, email, role, active, created_at
         FROM users WHERE tenant_id = ? ORDER BY role, display_name`,
      )
      .all(tenantId)
      .map((row) => ({ ...row, active: Boolean(row.active) }));
  }

  getTenant(tenantId) {
    const summary = this.tenantSummary(tenantId);
    if (!summary) throw error("tenant_not_found", 404);
    const raw = this.db
      .prepare("SELECT storage_quota_bytes FROM tenants WHERE id = ?")
      .get(tenantId);
    return {
      ...summary,
      storage_quota_bytes: raw?.storage_quota_bytes ?? null,
    };
  }

  listTenantSessions(tenantId) {
    if (!this.db.prepare("SELECT id FROM tenants WHERE id = ?").get(tenantId)) {
      throw error("tenant_not_found", 404);
    }
    return this.db
      .prepare(
        `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.impersonated_by_platform_admin_id,
                u.email AS user_email, u.display_name AS user_display_name, u.role AS user_role,
                pa.email AS impersonator_email
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN platform_admins pa ON pa.id = s.impersonated_by_platform_admin_id
         WHERE s.tenant_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
         ORDER BY s.created_at DESC`,
      )
      .all(tenantId, nowIso())
      .map((row) => ({
        id: row.id,
        user_id: row.user_id,
        user_email: row.user_email,
        user_display_name: row.user_display_name,
        user_role: row.user_role,
        created_at: row.created_at,
        expires_at: row.expires_at,
        impersonated_by_platform_admin_id: row.impersonated_by_platform_admin_id,
        impersonator_email: row.impersonator_email,
      }));
  }

  revokeAllTenantSessions(admin, tenantId) {
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    const timestamp = nowIso();
    const result = this.db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL")
      .run(timestamp, tenantId);
    this.audit(admin, "tenant.revoke_all_sessions", "tenant", tenantId, `Force-logout all users on ${tenant.slug}`, {
      slug: tenant.slug,
      sessions_revoked: result.changes,
    });
    return { ok: true, sessions_revoked: result.changes };
  }

  revokeTenantSession(admin, tenantId, sessionId) {
    const session = this.db
      .prepare("SELECT s.*, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.tenant_id = ?")
      .get(sessionId, tenantId);
    if (!session) throw error("session_not_found", 404);
    if (session.revoked_at) return { ok: true, already_revoked: true };
    const timestamp = nowIso();
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(timestamp, sessionId);
    this.audit(admin, "tenant.revoke_session", "session", sessionId, `Revoked session for ${session.email}`, {
      tenant_id: tenantId,
      user_id: session.user_id,
    });
    return { ok: true };
  }

  updateTenantStorageQuota(admin, tenantId, { new_quota_bytes } = {}) {
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    const parsed = z
      .object({
        new_quota_bytes: z.union([z.number().int().min(1024 * 1024), z.null()]),
      })
      .parse({ new_quota_bytes: new_quota_bytes === null ? null : Number(new_quota_bytes) });
    const previous = tenant.storage_quota_bytes;
    const timestamp = nowIso();
    this.db
      .prepare("UPDATE tenants SET storage_quota_bytes = ?, updated_at = ? WHERE id = ?")
      .run(parsed.new_quota_bytes, timestamp, tenantId);
    this.audit(admin, "tenant.update_quota", "tenant", tenantId, `Updated storage quota for ${tenant.slug}`, {
      slug: tenant.slug,
      previous_quota_bytes: previous,
      new_quota_bytes: parsed.new_quota_bytes,
    });
    return this.getTenant(tenantId);
  }

  tenantAudit(tenantId, limit = 100) {
    return this.db
      .prepare(
        `SELECT e.*, a.email AS admin_email
         FROM platform_audit_events e
         LEFT JOIN platform_admins a ON a.id = e.admin_id
         WHERE e.target_id = ?
            OR json_extract(e.metadata_json, '$.tenant_id') = ?
         ORDER BY e.occurred_at DESC LIMIT ?`,
      )
      .all(tenantId, tenantId, Math.min(Math.max(Number(limit) || 100, 1), 500))
      .map((row) => ({
        id: row.id,
        admin_id: row.admin_id,
        admin_email: row.admin_email,
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id,
        summary: row.summary,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        occurred_at: row.occurred_at,
      }));
  }

  async createTenant(admin, payload) {
    const input = z
      .object({
        tenant_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        tenant_name: z.string().min(1),
        owner_email: z.string().email(),
        owner_name: z.string().min(1),
        owner_password: z.string().min(8).max(128),
      })
      .parse(payload);
    const timestamp = nowIso();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await hashPassword(input.owner_password);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO tenants
           (id, portable_id, slug, company_name, sales_tax_rate_basis_points, locale, currency, shop_timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 'en-US', 'USD', 'America/New_York', ?, ?)`,
        )
        .run(tenantId, `tenant_${randomUUID().replace(/-/g, "")}`, input.tenant_slug, input.tenant_name, timestamp, timestamp);
      this.db
        .prepare(
          `INSERT INTO users (id, portable_id, tenant_id, display_name, email, password_hash, role, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'owner', 1, ?, ?)`,
        )
        .run(
          userId,
          `user_${randomUUID().replace(/-/g, "")}`,
          tenantId,
          input.owner_name,
          input.owner_email.toLowerCase(),
          passwordHash,
          timestamp,
          timestamp,
        );
      const intakeToken = randomUUID().replace(/-/g, "");
      const intakeDomain = process.env.SIGNGUY_SLIM_INTAKE_DOMAIN || "intake.signguy-slim.local";
      this.db
        .prepare(
          `INSERT INTO tenant_intake_addresses
           (id, tenant_id, address_token, full_address, active, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(randomUUID(), tenantId, intakeToken, `${input.tenant_slug}+${intakeToken}@${intakeDomain}`, userId, timestamp, timestamp);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      if (String(err.message).includes("UNIQUE")) throw error("tenant_or_user_exists", 409);
      throw err;
    }
    this.audit(admin, "tenant.create", "tenant", tenantId, `Created tenant ${input.tenant_slug}`, {
      slug: input.tenant_slug,
      owner_email: input.owner_email,
    });
    return this.tenantSummary(tenantId);
  }

  tenantSummary(tenantId) {
    return this.listTenants().find((t) => t.id === tenantId) || null;
  }

  suspendTenant(admin, tenantId, reason = null) {
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    if (tenant.suspended_at) return this.tenantSummary(tenantId);
    const timestamp = nowIso();
    this.db
      .prepare("UPDATE tenants SET suspended_at = ?, suspended_reason = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, reason ? String(reason).slice(0, 500) : null, timestamp, tenantId);
    this.db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL")
      .run(timestamp, tenantId);
    this.audit(admin, "tenant.suspend", "tenant", tenantId, `Suspended tenant ${tenant.slug}`, { reason, tenant_id: tenantId, tenant_slug: tenant.slug });
    // Fire-and-forget suspension email to owner + admins. Do not block the response.
    this.notifySuspension(admin, { ...tenant, suspended_at: timestamp, suspended_reason: reason }).catch((err) => {
      console.error(JSON.stringify({ event: "platform_suspension_email_failed", tenant_id: tenantId, error: err.message }));
    });
    return this.tenantSummary(tenantId);
  }

  unsuspendTenant(admin, tenantId) {
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    if (!tenant.suspended_at) return this.tenantSummary(tenantId);
    const timestamp = nowIso();
    this.db
      .prepare("UPDATE tenants SET suspended_at = NULL, suspended_reason = NULL, updated_at = ? WHERE id = ?")
      .run(timestamp, tenantId);
    this.audit(admin, "tenant.unsuspend", "tenant", tenantId, `Unsuspended tenant ${tenant.slug}`, { tenant_id: tenantId, tenant_slug: tenant.slug });
    this.notifyReactivation(admin, { ...tenant, suspended_at: null, suspended_reason: null }).catch((err) => {
      console.error(JSON.stringify({ event: "platform_reactivation_email_failed", tenant_id: tenantId, error: err.message }));
    });
    return this.tenantSummary(tenantId);
  }

  async notifySuspension(admin, tenant) {
    return this.deliverPlatformEmail(admin, tenant, {
      kind: "suspension",
      subject: `Your shop "${tenant.company_name}" has been suspended`,
      buildBody: ({ recipient }) => [
        `Hello ${recipient.display_name || recipient.email},`,
        "",
        `Your SignGuy Slim shop "${tenant.company_name}" (${tenant.slug}) has been suspended by the platform team.`,
        tenant.suspended_reason ? `Reason: ${tenant.suspended_reason}` : "No reason was provided.",
        "",
        "While your shop is suspended:",
        "  • Team members cannot sign in.",
        "  • Existing sessions have been signed out.",
        "  • Your data is preserved and will be restored on reactivation.",
        "",
        "Reply to this email if you have questions or believe this was made in error.",
        "",
        "— SignGuy Slim Platform",
      ].join("\n"),
    });
  }

  async notifyReactivation(admin, tenant) {
    return this.deliverPlatformEmail(admin, tenant, {
      kind: "reactivation",
      subject: `Your shop "${tenant.company_name}" is active again`,
      buildBody: ({ recipient }) => [
        `Hello ${recipient.display_name || recipient.email},`,
        "",
        `Good news — your SignGuy Slim shop "${tenant.company_name}" has been reactivated.`,
        "You and your team can sign in again and pick up where you left off.",
        "",
        "— SignGuy Slim Platform",
      ].join("\n"),
    });
  }

  async deliverPlatformEmail(admin, tenant, { kind, subject, buildBody }) {
    const recipients = this.db
      .prepare(
        `SELECT id, email, display_name, role FROM users
         WHERE tenant_id = ? AND role IN ('owner', 'admin') AND active = 1`,
      )
      .all(tenant.id);
    if (!recipients.length) {
      this.audit(admin, `tenant.${kind}_email`, "tenant", tenant.id, `No recipients for ${kind} email on ${tenant.slug}`, {
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        kind,
        results: [],
      });
      return [];
    }
    const from = {
      email: process.env.SIGNGUY_SLIM_PLATFORM_FROM_EMAIL || "no-reply@signguy-slim.local",
      name: process.env.SIGNGUY_SLIM_PLATFORM_FROM_NAME || "SignGuy Slim Platform",
    };
    const apiKey = process.env.SIGNGUY_SLIM_SENDGRID_API_KEY;
    const results = [];
    for (const recipient of recipients) {
      const bodyText = buildBody({ recipient });
      const payload = {
        personalizations: [{ to: [{ email: recipient.email }] }],
        from,
        subject,
        content: [{ type: "text/plain", value: bodyText }],
        custom_args: { platform_email_kind: kind, tenant_id: tenant.id, user_id: recipient.id },
      };
      if (!apiKey) {
        console.log(JSON.stringify({ event: "platform_email_devlog", kind, to: recipient.email, tenant: tenant.slug, subject }));
        results.push({ to: recipient.email, status: "not_configured" });
        continue;
      }
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        results.push({
          to: recipient.email,
          status: response.status === 202 ? "sent" : "provider_rejected",
          provider_status: response.status,
        });
      } catch (err) {
        results.push({ to: recipient.email, status: "error", error: err.message });
      }
    }
    this.audit(admin, `tenant.${kind}_email`, "tenant", tenant.id, `Sent ${kind} email for ${tenant.slug}`, {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      kind,
      results,
    });
    return results;
  }

  deleteTenant(admin, tenantId, { confirmation } = {}) {
    if (confirmation !== "DELETE") throw error("confirmation_required", 400);
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    if (!tenant.suspended_at) throw error("tenant_must_be_suspended_first", 409);
    const tables = this.db
      .prepare(
        `SELECT m.name AS name
         FROM sqlite_master m
         WHERE m.type = 'table'
           AND m.name NOT IN ('tenants','platform_admins','platform_admin_sessions','platform_audit_events','schema_migrations')
           AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) t WHERE t.name = 'tenant_id')`,
      )
      .all();
    this.db.exec("PRAGMA foreign_keys = OFF");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const { name } of tables) {
        this.db.prepare(`DELETE FROM ${name} WHERE tenant_id = ?`).run(tenantId);
      }
      this.db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      this.db.exec("PRAGMA foreign_keys = ON");
      throw err;
    }
    this.db.exec("PRAGMA foreign_keys = ON");
    this.audit(admin, "tenant.delete", "tenant", tenantId, `Deleted tenant ${tenant.slug}`, {
      slug: tenant.slug,
      company_name: tenant.company_name,
    });
    return { ok: true, deleted_tenant_id: tenantId };
  }

  async resetUserPassword(admin, userId, { new_password }) {
    const parsed = z.object({ new_password: z.string().min(8).max(128) }).parse({ new_password });
    const user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) throw error("user_not_found", 404);
    const passwordHash = await hashPassword(parsed.new_password);
    const timestamp = nowIso();
    this.db
      .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .run(passwordHash, timestamp, userId);
    this.db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .run(timestamp, userId);
    this.audit(admin, "user.password_reset", "user", userId, `Reset password for ${user.email}`, {
      tenant_id: user.tenant_id,
    });
    return { ok: true };
  }

  impersonate(admin, tenantId, targetUserId = null) {
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    if (tenant.suspended_at) throw error("tenant_suspended", 409);
    const user = targetUserId
      ? this.db
          .prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ? AND active = 1")
          .get(targetUserId, tenantId)
      : this.db
          .prepare(
            "SELECT * FROM users WHERE tenant_id = ? AND role = 'owner' AND active = 1 ORDER BY created_at LIMIT 1",
          )
          .get(tenantId);
    if (!user) throw error("user_not_found", 404);
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    const id = randomUUID();
    const expiresAt = sessionExpiry();
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO sessions
         (id, tenant_id, user_id, token_hash, created_at, expires_at, impersonated_by_platform_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, tenantId, user.id, tokenHash, timestamp, expiresAt, admin.id);
    this.audit(admin, "tenant.impersonate", "user", user.id, `Impersonated ${user.email}`, {
      tenant_id: tenantId,
      tenant_slug: tenant.slug,
    });
    return {
      token,
      expires_at: expiresAt,
      tenant: { id: tenant.id, slug: tenant.slug, company_name: tenant.company_name },
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    };
  }

  auditLog({ limit = 100, action = null, tenantId = null, adminId = null, since = null } = {}) {
    const clauses = [];
    const params = [];
    if (action) {
      clauses.push("e.action = ?");
      params.push(action);
    }
    if (tenantId) {
      clauses.push("(e.target_id = ? OR json_extract(e.metadata_json, '$.tenant_id') = ?)");
      params.push(tenantId, tenantId);
    }
    if (adminId) {
      clauses.push("e.admin_id = ?");
      params.push(adminId);
    }
    if (since) {
      clauses.push("e.occurred_at >= ?");
      params.push(since);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const sql = `
      SELECT e.*, a.email AS admin_email,
             COALESCE(t_direct.id, t_meta.id) AS resolved_tenant_id,
             COALESCE(t_direct.slug, t_meta.slug, json_extract(e.metadata_json, '$.tenant_slug')) AS resolved_tenant_slug,
             COALESCE(t_direct.company_name, t_meta.company_name) AS resolved_tenant_name
      FROM platform_audit_events e
      LEFT JOIN platform_admins a ON a.id = e.admin_id
      LEFT JOIN tenants t_direct ON e.target_type = 'tenant' AND t_direct.id = e.target_id
      LEFT JOIN tenants t_meta ON t_meta.id = json_extract(e.metadata_json, '$.tenant_id')
      ${where}
      ORDER BY e.occurred_at DESC LIMIT ?`;
    return this.db
      .prepare(sql)
      .all(...params, cappedLimit)
      .map((row) => ({
        id: row.id,
        admin_id: row.admin_id,
        admin_email: row.admin_email,
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id,
        tenant_id: row.resolved_tenant_id,
        tenant_slug: row.resolved_tenant_slug,
        tenant_company_name: row.resolved_tenant_name,
        summary: row.summary,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        occurred_at: row.occurred_at,
      }));
  }

  auditActions() {
    return this.db
      .prepare("SELECT DISTINCT action FROM platform_audit_events ORDER BY action")
      .all()
      .map((row) => row.action);
  }

  audit(admin, action, targetType, targetId, summary, metadata = null) {
    this.db
      .prepare(
        `INSERT INTO platform_audit_events (id, admin_id, action, target_type, target_id, summary, metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        admin?.id || null,
        action,
        targetType,
        targetId,
        summary,
        metadata ? JSON.stringify(metadata) : null,
        nowIso(),
      );
  }
}
