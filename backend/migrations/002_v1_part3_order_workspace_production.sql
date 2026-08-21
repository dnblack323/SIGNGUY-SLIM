-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE order_attachments (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_order_attachments_tenant_order ON order_attachments(tenant_id, order_id, deleted_at);
CREATE INDEX idx_order_attachments_storage_key ON order_attachments(storage_key);
CREATE INDEX idx_order_items_production ON order_items(tenant_id, production_required, production_stage, assigned_user_id, due_date);

-- migrate:down
DROP INDEX IF EXISTS idx_order_items_production;
DROP INDEX IF EXISTS idx_order_attachments_storage_key;
DROP INDEX IF EXISTS idx_order_attachments_tenant_order;
DROP TABLE IF EXISTS order_attachments;
