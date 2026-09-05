import { constantTimeEqual, csrfTokenForSession, hashPassword, hashToken, newSessionToken, sessionExpiry, verifyPassword } from "./security.js";
import { renderPdf } from "./pdf.js";
import { backupHistory, createEncryptedBackup, previewBackup, restoreBackup } from "./backup.js";
import { durableEnsureDirectory } from "./durableFiles.js";
import { appLink, defaultTenantStorageQuotaBytes, passwordResetLifetimeSeconds, publicRegistrationEnabled, rateLimitKeyHash, rateLimitPolicy, rateLimitRetryAfterSeconds, signupInvitationLifetimeSeconds } from "./accountControls.js";
import { installEmployeeDomain } from "./domains/employees/index.js";
import { installGeneralDomain } from "./domains/general/index.js";
import { ADMIN_ROLES, ROLES, addressSchema, assertInside, assertNoSymlinkAncestors, bool, chmodSync, dirname, error, existsSync, formatCents, join, lstatSync, mapTenant, mapUser, now, parseJson, portable, randomUUID, realpathSync, storageRoot, z } from "./domains/shared.js";

function addSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeOptionalEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

export class SlimService {
  constructor(db, options = {}) {
    this.db = db;
    this.inTransaction = false;
    this.emailTransport = options.emailTransport || null;
  }

  ensureAttachmentDirectory(path) {
    try {
      durableEnsureDirectory(path, { mode: 0o700 });
    } catch (err) {
      if (err?.message === "durable_directory_invalid") throw error("attachment_path_invalid", 400);
      throw err;
    }
  }

  attachmentPath(storageKey) {
    const root = storageRoot();
    this.ensureAttachmentDirectory(root);
    if (lstatSync(root).isSymbolicLink()) throw error("attachment_path_invalid", 400);
    const realRoot = realpathSync(root);
    chmodSync(realRoot, 0o700);
    assertNoSymlinkAncestors(realRoot, dirname(realRoot));
    const fullPath = assertInside(realRoot, join(realRoot, storageKey));
    const parent = dirname(fullPath);
    assertNoSymlinkAncestors(parent, realRoot);
    this.ensureAttachmentDirectory(parent);
    assertNoSymlinkAncestors(parent, realRoot);
    chmodSync(parent, 0o700);
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

  registrationOptions() {
    const enabled = publicRegistrationEnabled();
    return {
      public_registration_enabled: enabled,
      registration_mode: enabled ? "public" : "invite_only",
    };
  }

  enforceRateLimit(scope, parts = {}) {
    const policy = rateLimitPolicy(scope);
    const nowMs = Date.now();
    const windowMs = policy.windowSeconds * 1000;
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const windowStartAt = new Date(windowStartMs).toISOString();
    const windowEndAt = new Date(windowStartMs + windowMs).toISOString();
    const timestamp = now();
    const keyHash = rateLimitKeyHash(scope, parts);
    const row = this.transaction(() => {
      this.db.prepare("DELETE FROM rate_limit_buckets WHERE window_end_at <= ?").run(timestamp);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO rate_limit_buckets
           (id, bucket_key_hash, scope, window_start_at, window_end_at, attempt_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(randomUUID(), keyHash, scope, windowStartAt, windowEndAt, timestamp, timestamp);
      this.db
        .prepare(
          `UPDATE rate_limit_buckets
           SET attempt_count = attempt_count + 1, updated_at = ?
           WHERE bucket_key_hash = ? AND scope = ? AND window_start_at = ?`,
        )
        .run(timestamp, keyHash, scope, windowStartAt);
      return this.db
        .prepare("SELECT attempt_count, window_end_at FROM rate_limit_buckets WHERE bucket_key_hash = ? AND scope = ? AND window_start_at = ?")
        .get(keyHash, scope, windowStartAt);
    });
    if (row.attempt_count > policy.limit) {
      const err = error("rate_limit_exceeded", 429);
      err.retry_after_seconds = rateLimitRetryAfterSeconds(row.window_end_at, nowMs);
      throw err;
    }
    return { ok: true, remaining: Math.max(0, policy.limit - row.attempt_count), window_end_at: row.window_end_at };
  }

  effectiveTenantStorageQuotaBytes(tenantId) {
    const tenant = this.db.prepare("SELECT storage_quota_bytes FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    return Number.isInteger(tenant.storage_quota_bytes) && tenant.storage_quota_bytes > 0
      ? tenant.storage_quota_bytes
      : defaultTenantStorageQuotaBytes();
  }

  tenantStorageUsageBytes(tenantId) {
    const orderBytes = this.db
      .prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM order_attachments WHERE tenant_id = ? AND deleted_at IS NULL")
      .get(tenantId).total;
    const intakeBytes = this.db
      .prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM intake_attachments WHERE tenant_id = ? AND accepted = 1 AND storage_key IS NOT NULL")
      .get(tenantId).total;
    return Number(orderBytes || 0) + Number(intakeBytes || 0);
  }

  tenantStorageSummary(actor) {
    const quotaBytes = this.effectiveTenantStorageQuotaBytes(actor.tenant_id);
    const usageBytes = this.tenantStorageUsageBytes(actor.tenant_id);
    return {
      usage_bytes: usageBytes,
      quota_bytes: quotaBytes,
      remaining_bytes: Math.max(0, quotaBytes - usageBytes),
    };
  }

  assertTenantStorageAvailable(tenantId, additionalBytes) {
    const add = Number(additionalBytes || 0);
    if (!Number.isFinite(add) || add < 0) throw error("storage_quota_exceeded", 413);
    const quotaBytes = this.effectiveTenantStorageQuotaBytes(tenantId);
    const usageBytes = this.tenantStorageUsageBytes(tenantId);
    if (usageBytes + add > quotaBytes) {
      const err = error("storage_quota_exceeded", 413);
      err.storage = {
        usage_bytes: usageBytes,
        quota_bytes: quotaBytes,
        attempted_additional_bytes: add,
        remaining_bytes: Math.max(0, quotaBytes - usageBytes),
      };
      throw err;
    }
    return { usage_bytes: usageBytes, quota_bytes: quotaBytes, remaining_bytes: quotaBytes - usageBytes - add };
  }

  updateStorageQuota(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z
      .object({ storage_quota_bytes: z.number().int().min(1024 * 1024).nullable() })
      .parse(payload);
    const timestamp = now();
    this.db
      .prepare("UPDATE tenants SET storage_quota_bytes = ?, updated_at = ? WHERE id = ?")
      .run(input.storage_quota_bytes, timestamp, actor.tenant_id);
    this.audit(actor, "settings.storage_quota_update", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Tenant storage quota updated", {
      storage_quota_bytes: input.storage_quota_bytes,
    });
    return this.settings(actor);
  }

  signupInvitationForToken(token, ownerEmail) {
    const row = this.db
      .prepare(
        `SELECT * FROM signup_invitations
         WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(hashToken(token || ""), now());
    if (!row) throw error("signup_invite_invalid", 400);
    const email = normalizeOptionalEmail(row.email);
    if (email && email !== normalizeOptionalEmail(ownerEmail)) throw error("signup_invite_invalid", 400);
    return row;
  }

  createSignupInvitation(actor, payload = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z
      .object({
        email: z.string().email().nullable().optional(),
        expires_in_hours: z.number().int().min(1).max(24 * 90).optional(),
      })
      .parse(payload);
    const token = newSessionToken();
    const created = now();
    const expiresSeconds = input.expires_in_hours ? input.expires_in_hours * 3600 : signupInvitationLifetimeSeconds();
    const expiresAt = addSeconds(expiresSeconds);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO signup_invitations
         (id, token_hash, created_by_tenant_id, created_by_user_id, email, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, hashToken(token), actor.tenant_id, actor.id, normalizeOptionalEmail(input.email), expiresAt, created, created);
    this.audit(actor, "signup_invitation.create", "signup_invitation", id, id, "Signup invitation created", {
      email: normalizeOptionalEmail(input.email),
      expires_at: expiresAt,
    });
    return {
      id,
      email: normalizeOptionalEmail(input.email),
      expires_at: expiresAt,
      invite_token: token,
      invite_url: appLink(`/register?invite=${encodeURIComponent(token)}`),
    };
  }

  async requestPasswordReset(payload) {
    const input = z.object({ email: z.string().email() }).parse(payload);
    const requestedEmail = normalizeOptionalEmail(input.email);
    const users = this.db
      .prepare(
        `SELECT u.*, t.company_name, t.slug
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.email = ? AND u.active = 1
         ORDER BY t.created_at, u.created_at`,
      )
      .all(requestedEmail);
    for (const user of users) {
      await this.createPasswordResetTokenForUser(user, {
        requested_email: requestedEmail,
        created_by: null,
        send_email: true,
      });
    }
    return { ok: true, message: "If an active account matches that email, reset instructions have been sent." };
  }

  async createPasswordResetTokenForUser(user, { requested_email, created_by = null, send_email = false } = {}) {
    const token = newSessionToken();
    const created = now();
    const expiresAt = addSeconds(passwordResetLifetimeSeconds());
    const id = randomUUID();
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE password_reset_tokens
           SET revoked_at = ?, updated_at = ?
           WHERE tenant_id = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        )
        .run(created, created, user.tenant_id, user.id);
      this.db
        .prepare(
          `INSERT INTO password_reset_tokens
           (id, tenant_id, user_id, token_hash, created_by_tenant_id, created_by_user_id, requested_email, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, user.tenant_id, user.id, hashToken(token), created_by?.tenant_id || null, created_by?.id || null, requested_email || user.email, expiresAt, created, created);
    });
    const resetUrl = appLink(`/reset-password?token=${encodeURIComponent(token)}`);
    let delivery = { state: "not_sent", provider_message_id: null };
    if (send_email) {
      delivery = await this.deliverPasswordResetEmail(user, resetUrl).catch((err) => ({ state: "failed", provider_message_id: null, error: err.message }));
      this.db
        .prepare("UPDATE password_reset_tokens SET email_delivery_state = ?, provider_message_id = ?, updated_at = ? WHERE id = ?")
        .run(delivery.state, delivery.provider_message_id || null, now(), id);
    }
    const summary = send_email ? "Password reset requested" : "Password reset link generated";
    this.auditSystem(user.tenant_id, send_email ? "password_reset.request" : "password_reset.operator_create", "user", user.id, user.portable_id, summary, {
      password_reset_token_id: id,
      email_delivery_state: delivery.state,
      created_by_user_id: created_by?.id || null,
    });
    return { id, user_id: user.id, expires_at: expiresAt, reset_token: token, reset_url: resetUrl, email_delivery_state: delivery.state };
  }

  async deliverPasswordResetEmail(user, resetUrl) {
    if (!this.emailTransport && !process.env.SIGNGUY_SLIM_SENDGRID_API_KEY) throw error("email_provider_unconfigured", 503);
    const tenant = this.tenant(user.tenant_id);
    const settings = this.db.prepare("SELECT * FROM tenant_email_settings WHERE tenant_id = ?").get(user.tenant_id);
    const fromEmail = normalizeOptionalEmail(settings?.sender_email || tenant.contact_email || process.env.SIGNGUY_SLIM_RECOVERY_FROM_EMAIL);
    if (!fromEmail) throw error("email_sender_required", 400);
    const delivered = await this.deliverEmail({
      personalizations: [{ to: [{ email: user.email }] }],
      from: { email: fromEmail, name: settings?.sender_name || tenant.company_name || "SignGuy Slim" },
      subject: "Reset your SignGuy Slim password",
      content: [{ type: "text/plain", value: `Use this one-time link to reset your SignGuy Slim password:\n\n${resetUrl}\n\nThe link expires soon. If you did not request this, you can ignore this email.` }],
      custom_args: { tenant_id: user.tenant_id, user_id: user.id, message_type: "password_reset" },
    });
    return { state: "sent", provider_message_id: delivered.provider_message_id || null };
  }

  async createUserPasswordReset(actor, userId, payload = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z.object({ send_email: z.boolean().default(false) }).parse(payload);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(userId, actor.tenant_id);
    if (!user) throw error("user_not_found", 404);
    if (user.role === "owner" && actor.role !== "owner") throw error("owner_role_locked", 403);
    return this.createPasswordResetTokenForUser(user, { requested_email: user.email, created_by: actor, send_email: input.send_email });
  }

  async completePasswordReset(payload) {
    const input = z
      .object({ reset_token: z.string().min(16), new_password: z.string().min(8).max(128) })
      .parse(payload);
    const row = this.db
      .prepare(
        `SELECT prt.*, u.active AS user_active, u.portable_id AS user_portable_id
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id AND u.tenant_id = prt.tenant_id
         WHERE prt.token_hash = ?`,
      )
      .get(hashToken(input.reset_token));
    if (!row || row.used_at || row.revoked_at || row.expires_at <= now() || !row.user_active) throw error("password_reset_invalid", 400);
    const passwordHash = await hashPassword(input.new_password);
    const timestamp = now();
    this.transaction(() => {
      const fresh = this.db
        .prepare(
          `SELECT prt.*, u.active AS user_active
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id AND u.tenant_id = prt.tenant_id
           WHERE prt.id = ?`,
        )
        .get(row.id);
      if (!fresh || fresh.used_at || fresh.revoked_at || fresh.expires_at <= now() || !fresh.user_active) throw error("password_reset_invalid", 400);
      this.db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(passwordHash, timestamp, row.user_id, row.tenant_id);
      this.db.prepare("UPDATE password_reset_tokens SET used_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, row.id);
      this.db.prepare("UPDATE password_reset_tokens SET revoked_at = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND id <> ?").run(timestamp, timestamp, row.tenant_id, row.user_id, row.id);
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL").run(timestamp, row.tenant_id, row.user_id);
      this.auditSystem(row.tenant_id, "password_reset.complete", "user", row.user_id, row.user_portable_id, "Password reset completed", { password_reset_token_id: row.id });
    });
    return { ok: true };
  }

  async registerTenant(payload, options = {}) {
    const input = z
      .object({
        tenant_name: z.string().min(1),
        tenant_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        owner_email: z.string().email(),
        owner_name: z.string().min(1),
        owner_password: z.string().min(8).max(128),
        invite_token: z.string().min(16).optional(),
        sales_tax_rate_basis_points: z.number().int().min(0).max(10000).default(0),
        locale: z.string().min(2).default("en-US"),
        currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
        shop_timezone: z.string().min(1).default("America/New_York"),
      })
      .parse(payload);
    const inviteRequired = !publicRegistrationEnabled();
    let invitation = null;
    if (inviteRequired && !input.invite_token) throw error("signup_invite_required", 403);
    if (input.invite_token) invitation = this.signupInvitationForToken(input.invite_token, input.owner_email);
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
      if (invitation) {
        const changed = this.db
          .prepare(
            `UPDATE signup_invitations
             SET used_at = ?, consumed_tenant_id = ?, consumed_user_id = ?, updated_at = ?
             WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
          )
          .run(created, tenantId, userId, created, invitation.id, created);
        if (changed.changes !== 1) throw error("signup_invite_invalid", 400);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      if (String(err.message).includes("UNIQUE")) throw error("tenant_or_user_exists", 409);
      throw err;
    }
    const actor = mapUser(this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
    this.audit(actor, "tenant.create", "tenant", tenantId, this.tenant(tenantId).portable_id, `Tenant ${input.tenant_name} created`);
    if (invitation) this.audit(actor, "signup_invitation.consume", "signup_invitation", invitation.id, invitation.id, "Signup invitation consumed");
    const session = this.issueSessionEnvelope(actor);
    return options.includeSessionCredential ? session : session.payload;
  }

  async login(payload, options = {}) {
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
    const session = this.issueSessionEnvelope(mapUser(user));
    return options.includeSessionCredential ? session : session.payload;
  }

  issueSessionEnvelope(user) {
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    const id = randomUUID();
    const expiresAt = sessionExpiry();
    this.db
      .prepare(
        "INSERT INTO sessions (id, tenant_id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, user.tenant_id, user.id, tokenHash, now(), expiresAt);
    const payload = this.sessionPayload(user, { id, token_hash: tokenHash, expires_at: expiresAt });
    return { token, expires_at: expiresAt, payload };
  }

  issueSession(user) {
    return this.issueSessionEnvelope(user).payload;
  }

  sessionPayload(user, session = user?.auth_session) {
    return {
      user: mapUser(user),
      tenant: this.tenant(user.tenant_id),
      capabilities: this.capabilitiesForActor(user),
      csrf_token: csrfTokenForSession(session),
    };
  }

  actorForToken(token) {
    const row = this.db
      .prepare(
        `SELECT u.*, s.id AS session_id, s.token_hash AS session_token_hash, s.expires_at AS session_expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashToken(token || ""), now());
    if (!row || !row.active) throw error("unauthorized", 401);
    const actor = mapUser(row);
    Object.defineProperty(actor, "auth_session", {
      value: { id: row.session_id, token_hash: row.session_token_hash, expires_at: row.session_expires_at },
      enumerable: false,
    });
    return actor;
  }

  logout(token) {
    this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(now(), hashToken(token || ""));
    return true;
  }

  verifyCsrf(actor, csrfToken) {
    const expected = csrfTokenForSession(actor?.auth_session);
    return Boolean(expected && csrfToken && constantTimeEqual(expected, csrfToken));
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
      storage_quota: this.tenantStorageSummary(actor),
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
