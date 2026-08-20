-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  logo_reference TEXT,
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'US',
  contact_email TEXT,
  contact_phone TEXT,
  sales_tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (sales_tax_rate_basis_points BETWEEN 0 AND 10000),
  locale TEXT NOT NULL DEFAULT 'en-US',
  currency TEXT NOT NULL DEFAULT 'USD',
  shop_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE tenant_sequences (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  sequence_name TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, sequence_name)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_portable_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_number TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  billing_line1 TEXT NOT NULL,
  billing_line2 TEXT,
  billing_city TEXT NOT NULL,
  billing_state TEXT NOT NULL,
  billing_postal_code TEXT NOT NULL,
  billing_country TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  tax_exemption_note TEXT,
  internal_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_number)
);

CREATE TABLE estimates (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  estimate_number TEXT NOT NULL,
  document_date TEXT NOT NULL,
  expires_at TEXT,
  follow_up_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  customer_tax_exempt_snapshot INTEGER NOT NULL,
  tax_rate_basis_points_snapshot INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  internal_notes TEXT,
  converted_order_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, estimate_number)
);

CREATE TABLE estimate_items (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity_decimal TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  taxable INTEGER NOT NULL,
  production_required INTEGER NOT NULL,
  due_date TEXT,
  assigned_user_id TEXT REFERENCES users(id),
  internal_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, estimate_id, position)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  source_estimate_id TEXT UNIQUE REFERENCES estimates(id),
  order_number TEXT NOT NULL,
  document_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'on_hold', 'complete', 'cancelled')),
  customer_tax_exempt_snapshot INTEGER NOT NULL,
  tax_rate_basis_points_snapshot INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  internal_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, order_number)
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_estimate_item_id TEXT REFERENCES estimate_items(id),
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity_decimal TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  taxable INTEGER NOT NULL,
  production_required INTEGER NOT NULL,
  production_stage TEXT NOT NULL DEFAULT 'not_started' CHECK (production_stage IN ('not_started', 'ready', 'in_progress', 'waiting', 'complete')),
  completed INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  assigned_user_id TEXT REFERENCES users(id),
  internal_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, order_id, position)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  invoice_number TEXT NOT NULL,
  document_date TEXT NOT NULL,
  due_date TEXT,
  document_status TEXT NOT NULL CHECK (document_status IN ('draft', 'issued', 'void')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  customer_tax_exempt_snapshot INTEGER NOT NULL,
  tax_rate_basis_points_snapshot INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  balance_due_cents INTEGER NOT NULL,
  historical_amount_paid_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, order_id),
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_estimates_tenant ON estimates(tenant_id);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_audit_tenant_entity ON audit_events(tenant_id, entity_type, entity_id);

-- migrate:down
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS estimate_items;
DROP TABLE IF EXISTS estimates;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS tenant_sequences;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS schema_migrations;
