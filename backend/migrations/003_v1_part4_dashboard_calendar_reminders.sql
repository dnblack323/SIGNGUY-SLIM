-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  order_item_id TEXT REFERENCES order_items(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  assigned_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'complete', 'cancelled')),
  internal_note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);

CREATE INDEX idx_calendar_events_range ON calendar_events(tenant_id, start_at, end_at, status);
CREATE INDEX idx_calendar_events_links ON calendar_events(tenant_id, order_id, order_item_id);
CREATE INDEX idx_calendar_events_assigned ON calendar_events(tenant_id, assigned_user_id, status);

-- migrate:down
DROP INDEX IF EXISTS idx_calendar_events_assigned;
DROP INDEX IF EXISTS idx_calendar_events_links;
DROP INDEX IF EXISTS idx_calendar_events_range;
DROP TABLE IF EXISTS calendar_events;
