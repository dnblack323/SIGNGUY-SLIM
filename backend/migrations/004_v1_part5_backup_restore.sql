-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE backup_restore_receipts (
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL,
  source_product TEXT NOT NULL,
  source_format_version TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  source_tenant_identifier TEXT NOT NULL,
  target_tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'completed', 'blocked', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  restored_counts_json TEXT NOT NULL,
  warning_summary_json TEXT NOT NULL,
  error_summary_json TEXT NOT NULL,
  report_json TEXT NOT NULL,
  UNIQUE (target_tenant_id, backup_id, status)
);

CREATE INDEX idx_backup_restore_receipts_tenant ON backup_restore_receipts(target_tenant_id, started_at);

-- migrate:down
DROP INDEX IF EXISTS idx_backup_restore_receipts_tenant;
DROP TABLE IF EXISTS backup_restore_receipts;
