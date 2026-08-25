-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE schedule_departments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#255b73',
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE department_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL REFERENCES schedule_departments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  primary_department INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, department_id, user_id)
);

CREATE TABLE schedulable_resources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT REFERENCES schedule_departments(id),
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('equipment', 'vehicle', 'production_area', 'installation_crew', 'other')),
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  color TEXT NOT NULL DEFAULT '#64748b',
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE resource_unavailability (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  resource_id TEXT NOT NULL REFERENCES schedulable_resources(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'Unavailable',
  hard_block INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);

CREATE TABLE calendar_event_assignees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  calendar_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  primary_assignee INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, calendar_event_id, user_id)
);

CREATE TABLE calendar_event_resource_reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  calendar_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES schedulable_resources(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, calendar_event_id, resource_id)
);

CREATE TABLE schedule_views (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#255b73',
  visibility TEXT NOT NULL CHECK (visibility IN ('shared', 'personal')),
  system_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  filters_json TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, visibility, name, owner_user_id),
  UNIQUE (tenant_id, system_key)
);

ALTER TABLE calendar_events ADD COLUMN schedule_category TEXT NOT NULL DEFAULT 'general' CHECK (schedule_category IN ('general', 'production', 'installation', 'sales', 'customer_appointment', 'site_survey', 'pickup', 'delivery', 'meeting', 'deadline', 'other'));
ALTER TABLE calendar_events ADD COLUMN department_id TEXT REFERENCES schedule_departments(id);
ALTER TABLE calendar_events ADD COLUMN conflict_override_reason TEXT;

CREATE INDEX idx_schedule_departments_tenant ON schedule_departments(tenant_id, active, display_order);
CREATE INDEX idx_department_memberships_user ON department_memberships(tenant_id, user_id, active);
CREATE INDEX idx_resources_tenant ON schedulable_resources(tenant_id, active, resource_type);
CREATE INDEX idx_resource_unavailable_range ON resource_unavailability(tenant_id, resource_id, start_at, end_at);
CREATE INDEX idx_calendar_assignees_user ON calendar_event_assignees(tenant_id, user_id, calendar_event_id);
CREATE INDEX idx_calendar_resources_resource ON calendar_event_resource_reservations(tenant_id, resource_id, calendar_event_id);
CREATE INDEX idx_schedule_views_tenant ON schedule_views(tenant_id, visibility, active, display_order);
CREATE INDEX idx_calendar_events_stage2_filters ON calendar_events(tenant_id, schedule_category, department_id, status);

INSERT INTO schedule_departments (id, tenant_id, name, description, color, active, display_order, created_by_user_id, created_at, updated_at)
SELECT lower(hex(randomblob(16))), t.id, d.name, d.description, d.color, 1, d.display_order, NULL, datetime('now'), datetime('now')
FROM tenants t
JOIN (
  SELECT 'Production' AS name, 'Production scheduling' AS description, '#7B3DA6' AS color, 10 AS display_order
  UNION ALL SELECT 'Installation', 'Installation scheduling', '#3F7FC4', 20
  UNION ALL SELECT 'Sales', 'Sales scheduling', '#E06F00', 30
  UNION ALL SELECT 'Office/Administration', 'Office and administration scheduling', '#a7b2c3', 40
) d
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_departments existing WHERE existing.tenant_id = t.id AND existing.name = d.name
);

INSERT INTO schedule_views (id, tenant_id, owner_user_id, name, description, color, visibility, system_key, active, display_order, filters_json, created_by_user_id, created_at, updated_at)
SELECT lower(hex(randomblob(16))), t.id, NULL, v.name, v.description, v.color, 'shared', v.system_key, 1, v.display_order, v.filters_json, NULL, datetime('now'), datetime('now')
FROM tenants t
JOIN (
  SELECT 'All Shop Schedules' AS name, 'All permitted shop schedule entries' AS description, '#75638F' AS color, 'all_shop' AS system_key, 10 AS display_order, '{"entry_types":["event","task","appointment"],"schedule_categories":[],"department_ids":[],"employee_ids":[],"resource_ids":[],"statuses":[],"linked":"all"}' AS filters_json
  UNION ALL SELECT 'Production Schedule', 'Production schedule entries', '#7B3DA6', 'production', 20, '{"schedule_categories":["production"],"entry_types":[],"department_ids":[],"employee_ids":[],"resource_ids":[],"statuses":[],"linked":"all"}'
  UNION ALL SELECT 'Installation Schedule', 'Installation schedule entries', '#3F7FC4', 'installation', 30, '{"schedule_categories":["installation"],"entry_types":[],"department_ids":[],"employee_ids":[],"resource_ids":[],"statuses":[],"linked":"all"}'
  UNION ALL SELECT 'Sales Schedule', 'Sales schedule entries', '#E06F00', 'sales', 40, '{"schedule_categories":["sales"],"entry_types":[],"department_ids":[],"employee_ids":[],"resource_ids":[],"statuses":[],"linked":"all"}'
  UNION ALL SELECT 'Customer Appointments', 'Customer-facing appointments', '#E06F00', 'customer_appointments', 50, '{"schedule_categories":["customer_appointment","site_survey"],"entry_types":["appointment"],"department_ids":[],"employee_ids":[],"resource_ids":[],"statuses":[],"linked":"all"}'
  UNION ALL SELECT 'Pickup & Delivery Schedule', 'Pickup and delivery schedule entries', '#b591cc', 'pickup_delivery', 60, '{"schedule_categories":["pickup","delivery"],"entry_types":[],"department_ids":[],"employee_ids":[],"resource_ids":[],"statuses":[],"linked":"all"}'
) v
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_views existing WHERE existing.tenant_id = t.id AND existing.system_key = v.system_key
);

INSERT INTO calendar_event_assignees (id, tenant_id, calendar_event_id, user_id, primary_assignee, created_at)
SELECT lower(hex(randomblob(16))), ce.tenant_id, ce.id, ce.assigned_user_id, 1, datetime('now')
FROM calendar_events ce
JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
WHERE ce.assigned_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM calendar_event_assignees cea WHERE cea.tenant_id = ce.tenant_id AND cea.calendar_event_id = ce.id AND cea.user_id = ce.assigned_user_id
  );

-- migrate:down
DROP INDEX IF EXISTS idx_calendar_events_stage2_filters;
DROP INDEX IF EXISTS idx_schedule_views_tenant;
DROP INDEX IF EXISTS idx_calendar_resources_resource;
DROP INDEX IF EXISTS idx_calendar_assignees_user;
DROP INDEX IF EXISTS idx_resource_unavailable_range;
DROP INDEX IF EXISTS idx_resources_tenant;
DROP INDEX IF EXISTS idx_department_memberships_user;
DROP INDEX IF EXISTS idx_schedule_departments_tenant;
DROP TABLE IF EXISTS schedule_views;
DROP TABLE IF EXISTS calendar_event_resource_reservations;
DROP TABLE IF EXISTS calendar_event_assignees;
DROP TABLE IF EXISTS resource_unavailability;
DROP TABLE IF EXISTS schedulable_resources;
DROP TABLE IF EXISTS department_memberships;
DROP TABLE IF EXISTS schedule_departments;
