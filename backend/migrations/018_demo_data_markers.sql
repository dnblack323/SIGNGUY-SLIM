-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS demo_data_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demo_set TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, demo_set, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_demo_data_records_tenant_set
  ON demo_data_records(tenant_id, demo_set, entity_type);

-- migrate:down
DROP INDEX IF EXISTS idx_demo_data_records_tenant_set;
DROP TABLE IF EXISTS demo_data_records;
