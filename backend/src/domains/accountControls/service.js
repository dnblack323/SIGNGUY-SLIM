import { hashPassword, hashToken, newSessionToken } from "../../security.js";
import {
  appLink,
  defaultTenantStorageQuotaBytes,
  passwordResetLifetimeSeconds,
  passwordResetRequestMaxMatches,
  publicRegistrationEnabled,
  rateLimitKeyHash,
  rateLimitPolicy,
  rateLimitRetryAfterSeconds,
  signupInvitationLifetimeSeconds,
} from "../../accountControls.js";
import { ADMIN_ROLES, error, now, randomUUID, z } from "../shared.js";

function addSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeOptionalEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

export const accountControlMethods = {
  registrationOptions() {
    const enabled = publicRegistrationEnabled();
    return {
      public_registration_enabled: enabled,
      registration_mode: enabled ? "public" : "invite_only",
    };
  },

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
  },

  effectiveTenantStorageQuotaBytes(tenantId) {
    const tenant = this.db.prepare("SELECT storage_quota_bytes FROM tenants WHERE id = ?").get(tenantId);
    if (!tenant) throw error("tenant_not_found", 404);
    return Number.isInteger(tenant.storage_quota_bytes) && tenant.storage_quota_bytes > 0
      ? tenant.storage_quota_bytes
      : defaultTenantStorageQuotaBytes();
  },

  tenantStorageUsageBytes(tenantId) {
    const orderBytes = this.db
      .prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM order_attachments WHERE tenant_id = ?")
      .get(tenantId).total;
    const intakeBytes = this.db
      .prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM intake_attachments WHERE tenant_id = ? AND accepted = 1 AND storage_key IS NOT NULL")
      .get(tenantId).total;
    return Number(orderBytes || 0) + Number(intakeBytes || 0);
  },

  tenantStorageSummary(actor) {
    const quotaBytes = this.effectiveTenantStorageQuotaBytes(actor.tenant_id);
    const usageBytes = this.tenantStorageUsageBytes(actor.tenant_id);
    return {
      usage_bytes: usageBytes,
      quota_bytes: quotaBytes,
      remaining_bytes: Math.max(0, quotaBytes - usageBytes),
    };
  },

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
  },

  updateStorageQuota(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    z.object({ storage_quota_bytes: z.number().int().min(1024 * 1024).nullable() }).parse(payload);
    throw error("storage_quota_host_managed", 403);
  },

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
  },

  createSignupInvitationRecord(actor, payload = {}) {
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
    const inviteUrl = appLink(`/register?invite=${encodeURIComponent(token)}`);
    this.db
      .prepare(
        `INSERT INTO signup_invitations
         (id, token_hash, created_by_tenant_id, created_by_user_id, email, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, hashToken(token), actor?.tenant_id || null, actor?.id || null, normalizeOptionalEmail(input.email), expiresAt, created, created);
    if (actor) {
      this.audit(actor, "signup_invitation.create", "signup_invitation", id, id, "Signup invitation created", {
        email: normalizeOptionalEmail(input.email),
        expires_at: expiresAt,
      });
    }
    return {
      id,
      email: normalizeOptionalEmail(input.email),
      expires_at: expiresAt,
      invite_token: token,
      invite_url: inviteUrl,
    };
  },

  createSignupInvitation(actor, payload = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.createSignupInvitationRecord(actor, payload);
  },

  createBootstrapSignupInvitation(payload = {}) {
    const tenantCount = this.db.prepare("SELECT COUNT(*) AS count FROM tenants").get().count;
    if (tenantCount !== 0) throw error("bootstrap_invitation_unavailable", 409);
    return this.createSignupInvitationRecord(null, payload);
  },

  listSignupInvitations(actor) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.db
      .prepare(
        `SELECT id, email, expires_at, used_at, revoked_at, consumed_tenant_id, consumed_user_id, created_at
         FROM signup_invitations
         WHERE created_by_tenant_id = ?
         ORDER BY created_at DESC`,
      )
      .all(actor.tenant_id);
  },

  revokeSignupInvitation(actor, invitationId) {
    this.requireRole(actor, ADMIN_ROLES);
    const row = this.db
      .prepare("SELECT * FROM signup_invitations WHERE id = ? AND created_by_tenant_id = ?")
      .get(invitationId, actor.tenant_id);
    if (!row) throw error("signup_invitation_not_found", 404);
    if (row.used_at) throw error("signup_invitation_already_used", 409);
    if (row.revoked_at) return { ok: true, id: row.id, revoked_at: row.revoked_at };
    const timestamp = now();
    this.db.prepare("UPDATE signup_invitations SET revoked_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, row.id);
    this.audit(actor, "signup_invitation.revoke", "signup_invitation", row.id, row.id, "Signup invitation revoked", {
      email: row.email,
    });
    return { ok: true, id: row.id, revoked_at: timestamp };
  },

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
      .all(requestedEmail)
      .slice(0, passwordResetRequestMaxMatches());
    const scheduleReset = typeof setImmediate === "function" ? setImmediate : (work) => setTimeout(work, 0);
    for (const user of users) {
      scheduleReset(() => {
        void this.createPasswordResetTokenForUser(user, {
          requested_email: requestedEmail,
          created_by: null,
          send_email: true,
        }).catch((err) => {
          this.auditSystem(user.tenant_id, "password_reset.request_failed", "user", user.id, user.portable_id, "Password reset request failed", {
            error: err.message,
          });
        });
      });
    }
    return { ok: true, message: "If an active account matches that email, reset instructions have been sent." };
  },

  async createPasswordResetTokenForUser(user, { requested_email, created_by = null, send_email = false } = {}) {
    const token = newSessionToken();
    const created = now();
    const expiresAt = addSeconds(passwordResetLifetimeSeconds());
    const id = randomUUID();
    const resetUrl = appLink(`/reset-password?token=${encodeURIComponent(token)}`);
    const insertToken = () => {
      this.db
        .prepare(
          `INSERT INTO password_reset_tokens
           (id, tenant_id, user_id, token_hash, created_by_tenant_id, created_by_user_id, requested_email, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, user.tenant_id, user.id, hashToken(token), created_by?.tenant_id || null, created_by?.id || null, requested_email || user.email, expiresAt, created, created);
    };
    if (send_email) {
      this.transaction(insertToken);
    } else {
      this.transaction(() => {
        this.db
          .prepare(
            `UPDATE password_reset_tokens
             SET revoked_at = ?, updated_at = ?
             WHERE tenant_id = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
          )
          .run(created, created, user.tenant_id, user.id);
        insertToken();
      });
    }
    let delivery = { state: "not_sent", provider_message_id: null };
    if (send_email) {
      delivery = await this.deliverPasswordResetEmail(user, resetUrl).catch((err) => ({ state: "failed", provider_message_id: null, error: err.message }));
      this.transaction(() => {
        if (delivery.state === "sent") {
          this.db
            .prepare(
              `UPDATE password_reset_tokens
               SET revoked_at = ?, updated_at = ?
               WHERE tenant_id = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND id <> ? AND created_at < ?`,
            )
            .run(now(), now(), user.tenant_id, user.id, id, created);
        } else {
          this.db.prepare("UPDATE password_reset_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
        }
        this.db
          .prepare("UPDATE password_reset_tokens SET email_delivery_state = ?, provider_message_id = ?, updated_at = ? WHERE id = ?")
          .run(delivery.state, delivery.provider_message_id || null, now(), id);
      });
    } else {
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
  },

  async deliverPasswordResetEmail(user, resetUrl) {
    if (!this.emailTransport && !process.env.SIGNGUY_SLIM_SENDGRID_API_KEY) throw error("email_provider_unconfigured", 503);
    const tenant = this.tenant(user.tenant_id);
    const settings = this.db.prepare("SELECT * FROM tenant_email_settings WHERE tenant_id = ?").get(user.tenant_id);
    const tenantSender = settings?.sendgrid_verified ? normalizeOptionalEmail(settings.sender_email) : null;
    const fromEmail = normalizeOptionalEmail(process.env.SIGNGUY_SLIM_RECOVERY_FROM_EMAIL) || tenantSender;
    if (!fromEmail) throw error("email_sender_required", 400);
    const delivered = await this.deliverEmail({
      personalizations: [{ to: [{ email: user.email }] }],
      from: { email: fromEmail, name: settings?.sender_name || tenant.company_name || "SignGuy Slim" },
      subject: "Reset your SignGuy Slim password",
      content: [{ type: "text/plain", value: `Use this one-time link to reset your SignGuy Slim password:\n\n${resetUrl}\n\nThe link expires soon. If you did not request this, you can ignore this email.` }],
      custom_args: { tenant_id: user.tenant_id, user_id: user.id, message_type: "password_reset" },
    });
    return { state: "sent", provider_message_id: delivered.provider_message_id || null };
  },

  async createUserPasswordReset(actor, userId, payload = {}) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z.object({ send_email: z.boolean().default(false) }).parse(payload);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(userId, actor.tenant_id);
    if (!user) throw error("user_not_found", 404);
    if (user.role === "owner" && actor.role !== "owner") throw error("owner_role_locked", 403);
    return this.createPasswordResetTokenForUser(user, { requested_email: user.email, created_by: actor, send_email: input.send_email });
  },

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
  },
};
