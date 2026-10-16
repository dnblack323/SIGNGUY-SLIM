-- migrate:up

-- Punch-Fix requests: employees can request corrections to time entries.
-- Approval creates the correction via the normal admin correction path.

CREATE TABLE punch_fix_requests (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  time_entry_id TEXT REFERENCES employee_time_entries(id),
  requested_clock_in_at TEXT,
  requested_clock_out_at TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','denied')),
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  applied_time_entry_id TEXT REFERENCES employee_time_entries(id),
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_punch_fix_requests_status ON punch_fix_requests(tenant_id, status, created_at DESC);
CREATE INDEX idx_punch_fix_requests_employee ON punch_fix_requests(tenant_id, employee_id, created_at DESC);

-- migrate:down
DROP INDEX IF EXISTS idx_punch_fix_requests_employee;
DROP INDEX IF EXISTS idx_punch_fix_requests_status;
DROP TABLE IF EXISTS punch_fix_requests;
