-- migrate:up

-- Advance Ledger 2.0 (Phase C). A loan is a principal balance with a
-- weekly deduction rule. Deductions get auto-generated during pay-week
-- refresh and respect a net-pay ceiling so the employee never nets
-- negative from a loan deduction alone.

CREATE TABLE employee_advance_loans (
  id TEXT PRIMARY KEY,
  portable_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  principal_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  deduction_mode TEXT NOT NULL CHECK (deduction_mode IN ('lump_sum','installment')),
  installment_cents INTEGER,
  issued_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid_off','voided')),
  created_by_user_id TEXT NOT NULL,
  voided_by_user_id TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_advance_loans_active ON employee_advance_loans(tenant_id, employee_id, status);

CREATE TABLE employee_advance_deductions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL REFERENCES employee_advance_loans(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  pay_week_start TEXT NOT NULL,
  requested_cents INTEGER NOT NULL,       -- what the rule wanted to deduct
  applied_cents INTEGER NOT NULL,         -- what actually applied after net-pay ceiling
  balance_after_cents INTEGER NOT NULL,
  auto_reduced INTEGER NOT NULL DEFAULT 0,
  auto_reduce_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, loan_id, pay_week_start)
);

CREATE INDEX idx_advance_deductions_week ON employee_advance_deductions(tenant_id, employee_id, pay_week_start);

ALTER TABLE employee_pay_weeks ADD COLUMN loan_deductions_cents INTEGER NOT NULL DEFAULT 0;

-- migrate:down
DROP INDEX IF EXISTS idx_advance_deductions_week;
DROP TABLE IF EXISTS employee_advance_deductions;
DROP INDEX IF EXISTS idx_advance_loans_active;
DROP TABLE IF EXISTS employee_advance_loans;
