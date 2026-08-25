-- migrate:up
PRAGMA foreign_keys = ON;

ALTER TABLE calendar_events ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'event' CHECK (entry_type IN ('event', 'task', 'appointment'));
ALTER TABLE calendar_events ADD COLUMN task_priority TEXT CHECK (task_priority IS NULL OR task_priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE calendar_events ADD COLUMN appointment_type TEXT;
ALTER TABLE calendar_events ADD COLUMN customer_name TEXT;
ALTER TABLE calendar_events ADD COLUMN customer_contact TEXT;
ALTER TABLE calendar_events ADD COLUMN location TEXT;
ALTER TABLE calendar_events ADD COLUMN estimate_id TEXT REFERENCES estimates(id);

CREATE INDEX idx_calendar_events_type ON calendar_events(tenant_id, entry_type, status);
CREATE INDEX idx_calendar_events_estimate ON calendar_events(tenant_id, estimate_id);

-- migrate:down
DROP INDEX IF EXISTS idx_calendar_events_estimate;
DROP INDEX IF EXISTS idx_calendar_events_type;
