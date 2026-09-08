-- migrate:up
PRAGMA foreign_keys = ON;

ALTER TABLE tenants ADD COLUMN dashboard_widgets_json TEXT NOT NULL DEFAULT '{"summary_cards":true,"important_week":true,"clocked_in":true,"messages":true,"production_focus":true,"next_up":true,"recent_orders":true,"payments":true,"attention":true}';

-- migrate:down
-- SQLite cannot drop columns safely without a table rebuild; this additive
-- preference column is intentionally retained on downgrade.
