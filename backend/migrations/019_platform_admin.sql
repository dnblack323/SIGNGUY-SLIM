-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE platform_admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Platform Creator',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE platform_admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_platform_admin_sessions_admin_id ON platform_admin_sessions(admin_id);

ALTER TABLE tenants ADD COLUMN suspended_at TEXT;
ALTER TABLE tenants ADD COLUMN suspended_reason TEXT;

ALTER TABLE sessions ADD COLUMN impersonated_by_platform_admin_id TEXT REFERENCES platform_admins(id);

CREATE TABLE platform_audit_events (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT NOT NULL,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_platform_audit_events_occurred_at ON platform_audit_events(occurred_at DESC);

-- migrate:down
DROP INDEX IF EXISTS idx_platform_audit_events_occurred_at;
DROP TABLE IF EXISTS platform_audit_events;
DROP INDEX IF EXISTS idx_platform_admin_sessions_admin_id;
DROP TABLE IF EXISTS platform_admin_sessions;
DROP TABLE IF EXISTS platform_admins;
