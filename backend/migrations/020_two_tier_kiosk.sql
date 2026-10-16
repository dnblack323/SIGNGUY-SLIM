-- migrate:up

-- Phase A: PIN authentication for kiosks and burden rate tracking.
ALTER TABLE employees ADD COLUMN pin_hash TEXT;
ALTER TABLE employees ADD COLUMN burden_rate_basis_points INTEGER;
CREATE UNIQUE INDEX idx_employees_pin_hash ON employees(tenant_id, pin_hash) WHERE pin_hash IS NOT NULL;

-- Tier 1 shifts already exist in `employee_time_entries`. Add break tracking.
ALTER TABLE employee_time_entries ADD COLUMN unpaid_break_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employee_time_entries ADD COLUMN break_started_at TEXT;

-- Non-billable buckets (Shop Maintenance, Material Unloading, etc.).
CREATE TABLE non_billable_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, code)
);

-- Tier 2 job/stage costing. Every open job timer belongs to an open shift.
CREATE TABLE job_time_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  shift_id TEXT NOT NULL REFERENCES employee_time_entries(id),
  work_order_id TEXT REFERENCES work_orders(id),
  non_billable_code_id TEXT REFERENCES non_billable_codes(id),
  department_stage TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  duration_minutes INTEGER,
  note TEXT,
  auto_closed INTEGER NOT NULL DEFAULT 0,
  auto_close_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((work_order_id IS NOT NULL AND non_billable_code_id IS NULL) OR (work_order_id IS NULL AND non_billable_code_id IS NOT NULL))
);

CREATE INDEX idx_job_time_entries_active ON job_time_entries(tenant_id, employee_id, end_at);
CREATE INDEX idx_job_time_entries_shift ON job_time_entries(shift_id);
CREATE INDEX idx_job_time_entries_work_order ON job_time_entries(tenant_id, work_order_id);
CREATE UNIQUE INDEX idx_job_time_entries_one_open_per_employee
  ON job_time_entries(tenant_id, employee_id) WHERE end_at IS NULL;

-- 7-stage Kanban departments (spec §4). We add these as new columns rather than
-- rewriting `production_stage` because SQLite can't drop a CHECK constraint from
-- inside a migration and rebuilding the table conflicts with existing FKs
-- (work_order_items → work_orders). The existing `production_stage` is retained
-- as a lightweight workflow status; `department_stage` is the authoritative
-- Kanban column used by the new UI.
ALTER TABLE work_orders ADD COLUMN department_stage TEXT NOT NULL DEFAULT 'design';
ALTER TABLE work_orders ADD COLUMN on_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN on_hold_reason TEXT;
ALTER TABLE work_orders ADD COLUMN budget_minutes INTEGER;

-- Backfill department_stage from the existing 5-stage production_stage values.
UPDATE work_orders SET on_hold = 1 WHERE production_stage = 'waiting';
UPDATE work_orders SET department_stage = CASE production_stage
  WHEN 'not_started' THEN 'design'
  WHEN 'ready' THEN 'design'
  WHEN 'in_progress' THEN 'assembly'
  WHEN 'waiting' THEN 'assembly'
  WHEN 'complete' THEN 'done'
  ELSE 'design'
END;

CREATE INDEX idx_work_orders_department_stage ON work_orders(tenant_id, department_stage);

-- migrate:down
DROP INDEX IF EXISTS idx_work_orders_department_stage;
DROP INDEX IF EXISTS idx_job_time_entries_one_open_per_employee;
DROP INDEX IF EXISTS idx_job_time_entries_work_order;
DROP INDEX IF EXISTS idx_job_time_entries_shift;
DROP INDEX IF EXISTS idx_job_time_entries_active;
DROP TABLE IF EXISTS job_time_entries;
DROP TABLE IF EXISTS non_billable_codes;
DROP INDEX IF EXISTS idx_employees_pin_hash;
