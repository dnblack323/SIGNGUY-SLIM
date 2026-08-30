-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  employee_number TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
  portal_access_enabled INTEGER NOT NULL DEFAULT 1,
  pay_management_enabled INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  hire_date TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, employee_number)
);

CREATE UNIQUE INDEX ux_employees_active_user ON employees(tenant_id, user_id) WHERE active = 1;
CREATE INDEX idx_employees_tenant_active ON employees(tenant_id, active, name);

CREATE TABLE employee_rates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  effective_date TEXT NOT NULL,
  hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents >= 0),
  note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, employee_id, effective_date)
);

CREATE INDEX idx_employee_rates_effective ON employee_rates(tenant_id, employee_id, effective_date);

CREATE TABLE employee_time_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  clock_in_note TEXT,
  clock_out_note TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  rate_cents_snapshot INTEGER NOT NULL CHECK (rate_cents_snapshot >= 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'void')),
  implausible INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  corrected_by_user_id TEXT REFERENCES users(id),
  corrected_at TEXT,
  correction_reason TEXT,
  voided_by_user_id TEXT REFERENCES users(id),
  voided_at TEXT,
  void_reason TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'open' AND clock_out_at IS NULL) OR (status IN ('closed', 'void') AND clock_out_at IS NOT NULL))
);

CREATE UNIQUE INDEX ux_employee_open_time_entry ON employee_time_entries(tenant_id, employee_id) WHERE status = 'open';
CREATE INDEX idx_employee_time_week ON employee_time_entries(tenant_id, employee_id, clock_in_at, status);

CREATE TABLE employee_pay_weeks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  week_start_date TEXT NOT NULL,
  week_end_date TEXT NOT NULL,
  payday_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opening_carryover_cents INTEGER NOT NULL DEFAULT 0,
  valid_minutes INTEGER NOT NULL DEFAULT 0,
  gross_pay_cents INTEGER NOT NULL DEFAULT 0,
  positive_adjustments_cents INTEGER NOT NULL DEFAULT 0,
  negative_adjustments_cents INTEGER NOT NULL DEFAULT 0,
  advances_cents INTEGER NOT NULL DEFAULT 0,
  manual_payments_cents INTEGER NOT NULL DEFAULT 0,
  estimated_amount_due_cents INTEGER NOT NULL DEFAULT 0,
  closing_carryover_cents INTEGER,
  rate_breakdown_json TEXT NOT NULL DEFAULT '[]',
  snapshot_json TEXT,
  closed_by_user_id TEXT REFERENCES users(id),
  closed_at TEXT,
  reopened_by_user_id TEXT REFERENCES users(id),
  reopened_at TEXT,
  reopen_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, employee_id, week_start_date)
);

CREATE INDEX idx_employee_pay_weeks_tenant_week ON employee_pay_weeks(tenant_id, week_start_date, status);

CREATE TABLE employee_pay_advances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  pay_week_start TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  advance_date TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  voided_at TEXT,
  voided_by_user_id TEXT REFERENCES users(id),
  void_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE employee_pay_adjustments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  pay_week_start TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('positive', 'negative')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  voided_at TEXT,
  voided_by_user_id TEXT REFERENCES users(id),
  void_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE employee_pay_manual_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  pay_week_start TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_date TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  note TEXT,
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id),
  voided_at TEXT,
  voided_by_user_id TEXT REFERENCES users(id),
  void_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pay_advances_week ON employee_pay_advances(tenant_id, employee_id, pay_week_start);
CREATE INDEX idx_pay_adjustments_week ON employee_pay_adjustments(tenant_id, employee_id, pay_week_start);
CREATE INDEX idx_pay_manual_payments_week ON employee_pay_manual_payments(tenant_id, employee_id, pay_week_start);

CREATE TRIGGER trg_employee_user_tenant_insert
BEFORE INSERT ON employees
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_user_tenant_mismatch') END;
END;

CREATE TRIGGER trg_employee_user_tenant_update
BEFORE UPDATE OF tenant_id, user_id ON employees
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_user_tenant_mismatch') END;
END;

CREATE TRIGGER trg_employee_rate_relationship_insert
BEFORE INSERT ON employee_rates
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_employee_rate_relationship_update
BEFORE UPDATE OF tenant_id, employee_id, created_by_user_id ON employee_rates
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_time_entry_relationship_insert
BEFORE INSERT ON employee_time_entries
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_time_entry_relationship_update
BEFORE UPDATE OF tenant_id, employee_id, created_by_user_id, corrected_by_user_id, voided_by_user_id ON employee_time_entries
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.corrected_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.corrected_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_week_relationship_insert
BEFORE INSERT ON employee_pay_weeks
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_week_relationship_update
BEFORE UPDATE OF tenant_id, employee_id, closed_by_user_id, reopened_by_user_id ON employee_pay_weeks
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.closed_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.closed_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.reopened_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.reopened_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_advance_relationship_insert
BEFORE INSERT ON employee_pay_advances
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_pay_weeks w WHERE w.tenant_id = NEW.tenant_id AND w.employee_id = NEW.employee_id AND w.week_start_date = NEW.pay_week_start
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_advance_relationship_update
BEFORE UPDATE OF tenant_id, employee_id, pay_week_start, created_by_user_id, voided_by_user_id ON employee_pay_advances
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_pay_weeks w WHERE w.tenant_id = NEW.tenant_id AND w.employee_id = NEW.employee_id AND w.week_start_date = NEW.pay_week_start
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_adjustment_relationship_insert
BEFORE INSERT ON employee_pay_adjustments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_pay_weeks w WHERE w.tenant_id = NEW.tenant_id AND w.employee_id = NEW.employee_id AND w.week_start_date = NEW.pay_week_start
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_adjustment_relationship_update
BEFORE UPDATE OF tenant_id, employee_id, pay_week_start, created_by_user_id, voided_by_user_id ON employee_pay_adjustments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_pay_weeks w WHERE w.tenant_id = NEW.tenant_id AND w.employee_id = NEW.employee_id AND w.week_start_date = NEW.pay_week_start
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_manual_payment_relationship_insert
BEFORE INSERT ON employee_pay_manual_payments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_pay_weeks w WHERE w.tenant_id = NEW.tenant_id AND w.employee_id = NEW.employee_id AND w.week_start_date = NEW.pay_week_start
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.recorded_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

CREATE TRIGGER trg_pay_manual_payment_relationship_update
BEFORE UPDATE OF tenant_id, employee_id, pay_week_start, recorded_by_user_id, voided_by_user_id ON employee_pay_manual_payments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM employee_pay_weeks w WHERE w.tenant_id = NEW.tenant_id AND w.employee_id = NEW.employee_id AND w.week_start_date = NEW.pay_week_start
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.recorded_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
  SELECT CASE WHEN NEW.voided_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.voided_by_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'employee_relationship_invalid') END;
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_pay_manual_payment_relationship_update;
DROP TRIGGER IF EXISTS trg_pay_manual_payment_relationship_insert;
DROP TRIGGER IF EXISTS trg_pay_adjustment_relationship_update;
DROP TRIGGER IF EXISTS trg_pay_adjustment_relationship_insert;
DROP TRIGGER IF EXISTS trg_pay_advance_relationship_update;
DROP TRIGGER IF EXISTS trg_pay_advance_relationship_insert;
DROP TRIGGER IF EXISTS trg_pay_week_relationship_update;
DROP TRIGGER IF EXISTS trg_pay_week_relationship_insert;
DROP TRIGGER IF EXISTS trg_time_entry_relationship_update;
DROP TRIGGER IF EXISTS trg_time_entry_relationship_insert;
DROP TRIGGER IF EXISTS trg_employee_rate_relationship_update;
DROP TRIGGER IF EXISTS trg_employee_rate_relationship_insert;
DROP TRIGGER IF EXISTS trg_employee_user_tenant_update;
DROP TRIGGER IF EXISTS trg_employee_user_tenant_insert;
DROP INDEX IF EXISTS idx_pay_manual_payments_week;
DROP INDEX IF EXISTS idx_pay_adjustments_week;
DROP INDEX IF EXISTS idx_pay_advances_week;
DROP INDEX IF EXISTS idx_employee_pay_weeks_tenant_week;
DROP INDEX IF EXISTS ux_employee_open_time_entry;
DROP INDEX IF EXISTS idx_employee_time_week;
DROP INDEX IF EXISTS idx_employee_rates_effective;
DROP INDEX IF EXISTS idx_employees_tenant_active;
DROP INDEX IF EXISTS ux_employees_active_user;
DROP TABLE IF EXISTS employee_pay_manual_payments;
DROP TABLE IF EXISTS employee_pay_adjustments;
DROP TABLE IF EXISTS employee_pay_advances;
DROP TABLE IF EXISTS employee_pay_weeks;
DROP TABLE IF EXISTS employee_time_entries;
DROP TABLE IF EXISTS employee_rates;
DROP TABLE IF EXISTS employees;
