-- migrate:up

ALTER TABLE tenants ADD COLUMN storage_quota_bytes INTEGER;

CREATE TABLE rate_limit_buckets (
  id TEXT PRIMARY KEY,
  bucket_key_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  window_start_at TEXT NOT NULL,
  window_end_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bucket_key_hash, scope, window_start_at)
);

CREATE INDEX idx_rate_limit_buckets_expiry
  ON rate_limit_buckets(window_end_at);

CREATE TABLE signup_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_tenant_id TEXT,
  created_by_user_id TEXT,
  email TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  consumed_tenant_id TEXT,
  consumed_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(created_by_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(consumed_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  FOREIGN KEY(consumed_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_signup_invitations_email
  ON signup_invitations(email);

CREATE INDEX idx_signup_invitations_expires
  ON signup_invitations(expires_at);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_tenant_id TEXT,
  created_by_user_id TEXT,
  requested_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  email_delivery_state TEXT NOT NULL DEFAULT 'not_sent' CHECK(email_delivery_state IN ('not_sent', 'sent', 'failed')),
  provider_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_password_reset_tokens_user
  ON password_reset_tokens(tenant_id, user_id, expires_at);

CREATE INDEX idx_password_reset_tokens_expires
  ON password_reset_tokens(expires_at);

-- migrate:down
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS signup_invitations;
DROP TABLE IF EXISTS rate_limit_buckets;
