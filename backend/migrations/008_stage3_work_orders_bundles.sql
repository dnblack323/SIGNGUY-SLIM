-- migrate:up
PRAGMA foreign_keys = ON;

ALTER TABLE orders ADD COLUMN title TEXT;
ALTER TABLE orders ADD COLUMN production_grouping_mode TEXT CHECK (production_grouping_mode IN ('whole_order', 'individual_items', 'custom_groups'));
ALTER TABLE orders ADD COLUMN sent_to_production_at TEXT;
ALTER TABLE orders ADD COLUMN sent_to_production_by_user_id TEXT REFERENCES users(id);

ALTER TABLE estimate_items ADD COLUMN title TEXT;
ALTER TABLE order_items ADD COLUMN title TEXT;

UPDATE orders
SET title = COALESCE(NULLIF(TRIM(title), ''), 'Order ' || order_number)
WHERE title IS NULL OR TRIM(title) = '';

UPDATE estimate_items
SET title = COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(description), ''), 'Item ' || (position + 1))
WHERE title IS NULL OR TRIM(title) = '';

UPDATE order_items
SET title = COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(description), ''), 'Item ' || (position + 1))
WHERE title IS NULL OR TRIM(title) = '';

CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  work_order_number TEXT NOT NULL,
  title TEXT NOT NULL,
  grouping_mode TEXT NOT NULL CHECK (grouping_mode IN ('whole_order', 'individual_items', 'custom_groups')),
  production_stage TEXT NOT NULL DEFAULT 'not_started' CHECK (production_stage IN ('not_started', 'ready', 'in_progress', 'waiting', 'complete')),
  completed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  due_date TEXT,
  assigned_user_id TEXT REFERENCES users(id),
  department_id TEXT REFERENCES schedule_departments(id),
  instructions_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT REFERENCES users(id),
  sent_to_production_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, work_order_number)
);

CREATE TABLE work_order_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, work_order_id, order_item_id)
);

CREATE UNIQUE INDEX ux_work_order_items_active_item
  ON work_order_items(tenant_id, order_item_id)
  WHERE active = 1;

CREATE INDEX idx_work_orders_tenant_order ON work_orders(tenant_id, order_id, status);
CREATE INDEX idx_work_orders_board ON work_orders(tenant_id, status, production_stage, assigned_user_id, due_date);
CREATE INDEX idx_work_order_items_work_order ON work_order_items(tenant_id, work_order_id, active);

ALTER TABLE calendar_events ADD COLUMN work_order_id TEXT REFERENCES work_orders(id);
CREATE INDEX idx_calendar_events_work_order ON calendar_events(tenant_id, work_order_id, start_at);

CREATE TABLE commercial_bundles (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  document_type TEXT NOT NULL CHECK (document_type IN ('estimate', 'order', 'invoice')),
  document_id TEXT NOT NULL,
  source_order_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL,
  pricing_mode TEXT NOT NULL CHECK (pricing_mode IN ('itemized_subtotal', 'bundle_price')),
  manual_total_cents INTEGER CHECK (manual_total_cents IS NULL OR manual_total_cents >= 0),
  override_reason TEXT,
  show_member_prices INTEGER NOT NULL DEFAULT 1,
  allocation_snapshot_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE commercial_bundle_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bundle_id TEXT NOT NULL REFERENCES commercial_bundles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('estimate', 'order', 'invoice')),
  document_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('estimate_item', 'order_item')),
  item_id TEXT NOT NULL,
  allocated_cents INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, bundle_id, item_id)
);

CREATE UNIQUE INDEX ux_commercial_bundle_items_active_doc_item
  ON commercial_bundle_items(tenant_id, document_type, document_id, item_type, item_id)
  WHERE active = 1;

CREATE INDEX idx_commercial_bundles_document ON commercial_bundles(tenant_id, document_type, document_id, active, display_order);
CREATE INDEX idx_commercial_bundle_items_bundle ON commercial_bundle_items(tenant_id, bundle_id, active);

-- Existing production-required Order Items are exposed as individual Work Orders
-- so Stage 2 production records remain operable after the new grouping model lands.
INSERT INTO work_orders
  (id, portable_id, tenant_id, order_id, work_order_number, title, grouping_mode, production_stage, completed, status,
   due_date, assigned_user_id, department_id, instructions_snapshot_json, created_by_user_id, sent_to_production_at, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
  'sgp_v1_work_order_' || lower(hex(randomblob(16))),
  oi.tenant_id,
  oi.order_id,
  o.order_number || '-WO-' || printf('%03d', oi.position + 1),
  oi.title,
  'individual_items',
  oi.production_stage,
  oi.completed,
  'active',
  COALESCE(oi.due_date, o.due_date),
  oi.assigned_user_id,
  NULL,
  json_object('items', json_array(json_object('order_item_id', oi.id, 'title', oi.title, 'description', oi.description, 'quantity_decimal', oi.quantity_decimal, 'production_required', oi.production_required))),
  o.sent_to_production_by_user_id,
  COALESCE(o.sent_to_production_at, oi.created_at),
  oi.created_at,
  oi.updated_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
WHERE oi.production_required = 1;

INSERT INTO work_order_items (id, tenant_id, work_order_id, order_item_id, position, active, created_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
  wo.tenant_id,
  wo.id,
  oi.id,
  0,
  1,
  wo.created_at
FROM work_orders wo
JOIN order_items oi ON oi.tenant_id = wo.tenant_id AND oi.order_id = wo.order_id AND oi.title = wo.title AND oi.production_required = 1
WHERE wo.grouping_mode = 'individual_items'
  AND wo.work_order_number = (SELECT o.order_number FROM orders o WHERE o.id = oi.order_id AND o.tenant_id = oi.tenant_id) || '-WO-' || printf('%03d', oi.position + 1);

UPDATE orders
SET production_grouping_mode = 'individual_items',
    sent_to_production_at = COALESCE(sent_to_production_at, (SELECT MIN(created_at) FROM work_orders WHERE work_orders.order_id = orders.id AND work_orders.tenant_id = orders.tenant_id)),
    sent_to_production_by_user_id = COALESCE(sent_to_production_by_user_id, (SELECT created_by_user_id FROM work_orders WHERE work_orders.order_id = orders.id AND work_orders.tenant_id = orders.tenant_id LIMIT 1))
WHERE EXISTS (SELECT 1 FROM work_orders WHERE work_orders.order_id = orders.id AND work_orders.tenant_id = orders.tenant_id);

-- migrate:down
DROP INDEX IF EXISTS idx_commercial_bundle_items_bundle;
DROP INDEX IF EXISTS idx_commercial_bundles_document;
DROP INDEX IF EXISTS ux_commercial_bundle_items_active_doc_item;
DROP TABLE IF EXISTS commercial_bundle_items;
DROP TABLE IF EXISTS commercial_bundles;
DROP INDEX IF EXISTS idx_calendar_events_work_order;
DROP INDEX IF EXISTS idx_work_order_items_work_order;
DROP INDEX IF EXISTS idx_work_orders_board;
DROP INDEX IF EXISTS idx_work_orders_tenant_order;
DROP INDEX IF EXISTS ux_work_order_items_active_item;
DROP TABLE IF EXISTS work_order_items;
DROP TABLE IF EXISTS work_orders;
