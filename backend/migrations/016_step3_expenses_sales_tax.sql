-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL CHECK (expense_date GLOB '????-??-??'),
  vendor TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_method TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_by_user_id TEXT REFERENCES users(id),
  archived_at TEXT,
  archived_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE expense_attachments (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_expenses_tenant_date ON expenses(tenant_id, expense_date, archived_at);
CREATE INDEX idx_expenses_tenant_category ON expenses(tenant_id, category, payment_method);
CREATE INDEX idx_expense_attachments_tenant_expense ON expense_attachments(tenant_id, expense_id, deleted_at);
CREATE INDEX idx_expense_attachments_storage_key ON expense_attachments(storage_key);
CREATE UNIQUE INDEX idx_expense_attachments_one_active ON expense_attachments(tenant_id, expense_id) WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_expense_attachments_one_active;
DROP INDEX IF EXISTS idx_expense_attachments_storage_key;
DROP INDEX IF EXISTS idx_expense_attachments_tenant_expense;
DROP INDEX IF EXISTS idx_expenses_tenant_category;
DROP INDEX IF EXISTS idx_expenses_tenant_date;
DROP TABLE IF EXISTS expense_attachments;
DROP TABLE IF EXISTS expenses;
