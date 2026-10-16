import { randomUUID } from "node:crypto";
import { z } from "zod";
import { installDomainMethods } from "../install.js";
import { ADMIN_ROLES, MANAGER_ROLES, error, mapEmployee, now, portable } from "../employees/shared.js";

const ADVANCE_LEDGER_INSTALLED = Symbol.for("signguy.slim.advanceLedgerInstalled");

const createLoanSchema = z.object({
  employee_id: z.string().min(1),
  principal_cents: z.number().int().positive().max(100_000_00),
  deduction_mode: z.enum(["lump_sum", "installment"]),
  installment_cents: z.number().int().positive().optional(),
  issued_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).nullable().optional(),
}).refine((v) => v.deduction_mode !== "installment" || (v.installment_cents && v.installment_cents > 0), {
  message: "installment_cents required for installment mode",
});

const voidLoanSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const updateLoanSchema = z.object({
  deduction_mode: z.enum(["lump_sum", "installment"]).optional(),
  installment_cents: z.number().int().positive().nullable().optional(),
});

function mapLoan(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    tenant_id: row.tenant_id,
    employee_id: row.employee_id,
    principal_cents: row.principal_cents,
    balance_cents: row.balance_cents,
    deduction_mode: row.deduction_mode,
    installment_cents: row.installment_cents,
    issued_date: row.issued_date,
    note: row.note,
    status: row.status,
    voided_at: row.voided_at,
    void_reason: row.void_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extra,
  };
}

function mapDeduction(row) {
  if (!row) return null;
  return {
    id: row.id,
    loan_id: row.loan_id,
    employee_id: row.employee_id,
    pay_week_start: row.pay_week_start,
    requested_cents: row.requested_cents,
    applied_cents: row.applied_cents,
    balance_after_cents: row.balance_after_cents,
    auto_reduced: Boolean(row.auto_reduced),
    auto_reduce_reason: row.auto_reduce_reason,
    created_at: row.created_at,
  };
}

export const advanceLedgerMethods = {
  activeLoansForEmployee(actor, employeeId) {
    return this.db
      .prepare(
        `SELECT * FROM employee_advance_loans
         WHERE tenant_id = ? AND employee_id = ? AND status = 'active' AND balance_cents > 0
         ORDER BY issued_date, created_at`,
      )
      .all(actor.tenant_id, employeeId);
  },

  listAdvanceLoans(actor, filters = {}) {
    this.requireRole(actor, MANAGER_ROLES);
    const params = [actor.tenant_id];
    let sql = `SELECT l.*, e.name AS employee_name, e.employee_number
               FROM employee_advance_loans l
               JOIN employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
               WHERE l.tenant_id = ?`;
    if (filters.status) { sql += " AND l.status = ?"; params.push(filters.status); }
    if (filters.employee_id) { sql += " AND l.employee_id = ?"; params.push(filters.employee_id); }
    sql += " ORDER BY l.status = 'active' DESC, l.created_at DESC";
    return this.db.prepare(sql).all(...params).map((row) => mapLoan(row, {
      employee_name: row.employee_name,
      employee_number: row.employee_number,
    }));
  },

  advanceLoan(actor, loanId) {
    this.requireRole(actor, MANAGER_ROLES);
    const row = this.db.prepare(
      `SELECT l.*, e.name AS employee_name, e.employee_number
       FROM employee_advance_loans l
       JOIN employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
       WHERE l.id = ? AND l.tenant_id = ?`,
    ).get(loanId, actor.tenant_id);
    if (!row) throw error("advance_loan_not_found", 404);
    const deductions = this.db.prepare(
      `SELECT * FROM employee_advance_deductions WHERE loan_id = ? AND tenant_id = ? ORDER BY pay_week_start DESC, created_at DESC`,
    ).all(loanId, actor.tenant_id).map(mapDeduction);
    return { ...mapLoan(row, { employee_name: row.employee_name, employee_number: row.employee_number }), deductions };
  },

  createAdvanceLoan(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = createLoanSchema.parse(payload);
    const employee = this.employeeRecord(actor, input.employee_id);
    if (!employee.active) throw error("advance_employee_inactive", 400);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO employee_advance_loans
         (id, portable_id, tenant_id, employee_id, principal_cents, balance_cents, deduction_mode, installment_cents, issued_date, note, status, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).run(id, portable("advance_loan"), actor.tenant_id, input.employee_id, input.principal_cents, input.principal_cents,
             input.deduction_mode, input.installment_cents || null, input.issued_date, input.note || null,
             actor.id, timestamp, timestamp);
      const loan = this.db.prepare("SELECT * FROM employee_advance_loans WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      this.audit(actor, "advance.loan_create", "employee", employee.id, employee.portable_id, `Loan issued: $${(input.principal_cents / 100).toFixed(2)}`, { loan_id: id, principal_cents: input.principal_cents, deduction_mode: input.deduction_mode, installment_cents: input.installment_cents });
      return mapLoan(loan, { employee_name: employee.name, employee_number: employee.employee_number });
    });
  },

  updateAdvanceLoan(actor, loanId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = updateLoanSchema.parse(payload);
    const row = this.db.prepare("SELECT * FROM employee_advance_loans WHERE id = ? AND tenant_id = ?").get(loanId, actor.tenant_id);
    if (!row) throw error("advance_loan_not_found", 404);
    if (row.status !== "active") throw error("advance_loan_not_active", 409);
    const mode = input.deduction_mode || row.deduction_mode;
    const installment = input.installment_cents === undefined ? row.installment_cents : input.installment_cents;
    if (mode === "installment" && !installment) throw error("advance_installment_required", 400);
    this.db.prepare("UPDATE employee_advance_loans SET deduction_mode = ?, installment_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(mode, mode === "installment" ? installment : null, now(), loanId, actor.tenant_id);
    const employee = this.employeeRecord(actor, row.employee_id);
    this.audit(actor, "advance.loan_update", "employee", employee.id, employee.portable_id, `Loan ${row.id} rule updated`, { loan_id: loanId, deduction_mode: mode, installment_cents: mode === "installment" ? installment : null });
    return this.advanceLoan(actor, loanId);
  },

  voidAdvanceLoan(actor, loanId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = voidLoanSchema.parse(payload);
    const row = this.db.prepare("SELECT * FROM employee_advance_loans WHERE id = ? AND tenant_id = ?").get(loanId, actor.tenant_id);
    if (!row) throw error("advance_loan_not_found", 404);
    if (row.status !== "active") throw error("advance_loan_not_active", 409);
    return this.transaction(() => {
      this.db.prepare("UPDATE employee_advance_loans SET status = 'voided', voided_by_user_id = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(actor.id, now(), input.reason, now(), loanId, actor.tenant_id);
      const employee = this.employeeRecord(actor, row.employee_id);
      this.audit(actor, "advance.loan_void", "employee", employee.id, employee.portable_id, `Loan voided`, { loan_id: loanId, reason: input.reason });
      return this.advanceLoan(actor, loanId);
    });
  },

  projectedAdvanceDeductionsForPayWeek(actor, employeeId, preDeductionDueCents) {
    const loans = this.activeLoansForEmployee(actor, employeeId);
    let remainingBudget = Math.max(0, preDeductionDueCents);
    let totalDeducted = 0;
    const results = [];
    for (const loan of loans) {
      const requested = loan.deduction_mode === "lump_sum"
        ? loan.balance_cents
        : Math.min(loan.installment_cents || 0, loan.balance_cents);
      if (requested <= 0) continue;

      const applied = Math.min(requested, remainingBudget);
      const autoReduced = applied < requested;
      const autoReason = autoReduced ? (remainingBudget === 0 ? "net_pay_zero" : "net_pay_ceiling") : null;

      const newBalance = loan.balance_cents - applied;
      remainingBudget -= applied;
      totalDeducted += applied;
      results.push({ loan_id: loan.id, requested_cents: requested, applied_cents: applied, balance_after_cents: newBalance, auto_reduced: autoReduced, auto_reduce_reason: autoReason });
    }
    return { total_deducted_cents: totalDeducted, deductions: results };
  },

  // Called only when closing a pay week. Open-week refreshes must stay read-only
  // so a manager can view payroll repeatedly without reducing loan balances.
  applyAdvanceDeductionsForPayWeek(actor, employeeId, payWeekStartDate, preDeductionDueCents) {
    const existing = this.db.prepare(
      `SELECT COUNT(*) AS count FROM employee_advance_deductions
       WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ?`,
    ).get(actor.tenant_id, employeeId, payWeekStartDate);
    if (existing.count) {
      return {
        total_deducted_cents: this.advanceDeductionsForPayWeek(actor, employeeId, payWeekStartDate),
        deductions: this.db.prepare(
          `SELECT * FROM employee_advance_deductions
           WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ?
           ORDER BY created_at`,
        ).all(actor.tenant_id, employeeId, payWeekStartDate).map(mapDeduction),
      };
    }

    const projected = this.projectedAdvanceDeductionsForPayWeek(actor, employeeId, preDeductionDueCents);
    const timestamp = now();
    for (const deduction of projected.deductions) {
      this.db.prepare(
        `INSERT INTO employee_advance_deductions
         (id, tenant_id, loan_id, employee_id, pay_week_start, requested_cents, applied_cents, balance_after_cents, auto_reduced, auto_reduce_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        actor.tenant_id,
        deduction.loan_id,
        employeeId,
        payWeekStartDate,
        deduction.requested_cents,
        deduction.applied_cents,
        deduction.balance_after_cents,
        deduction.auto_reduced ? 1 : 0,
        deduction.auto_reduce_reason,
        timestamp,
        timestamp,
      );
      const nextStatus = deduction.balance_after_cents <= 0 ? "paid_off" : "active";
      this.db.prepare("UPDATE employee_advance_loans SET balance_cents = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(deduction.balance_after_cents, nextStatus, timestamp, deduction.loan_id, actor.tenant_id);
    }
    return projected;
  },

  rollbackAdvanceDeductionsForPayWeek(actor, employeeId, payWeekStartDate) {
    const rows = this.db.prepare(
      `SELECT d.*, l.status AS loan_status, l.voided_at
       FROM employee_advance_deductions d
       JOIN employee_advance_loans l ON l.id = d.loan_id AND l.tenant_id = d.tenant_id
       WHERE d.tenant_id = ? AND d.employee_id = ? AND d.pay_week_start = ?
       ORDER BY d.created_at DESC`,
    ).all(actor.tenant_id, employeeId, payWeekStartDate);
    const timestamp = now();
    for (const row of rows) {
      if (row.voided_at) continue;
      const restoredBalance = row.balance_after_cents + row.applied_cents;
      this.db.prepare("UPDATE employee_advance_loans SET balance_cents = ?, status = 'active', updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(restoredBalance, timestamp, row.loan_id, actor.tenant_id);
    }
    this.db.prepare(
      "DELETE FROM employee_advance_deductions WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ?",
    ).run(actor.tenant_id, employeeId, payWeekStartDate);
    return { reverted_count: rows.length };
  },

  advanceDeductionsForPayWeek(actor, employeeId, payWeekStartDate) {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(applied_cents), 0) AS total
         FROM employee_advance_deductions
         WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ?`,
      )
      .get(actor.tenant_id, employeeId, payWeekStartDate).total;
  },

  employeeLoanSummary(actor, employeeId) {
    // Both owners/admins/managers and the employee themselves can see this.
    if (!MANAGER_ROLES.has(actor.role)) {
      const self = this.db.prepare("SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND id = ?")
        .get(actor.tenant_id, actor.id, employeeId);
      if (!self) throw error("permission_denied", 403);
    }    const employee = this.employeeRecord(actor, employeeId);
    const active = this.db.prepare(
      `SELECT * FROM employee_advance_loans WHERE tenant_id = ? AND employee_id = ? AND status = 'active' ORDER BY created_at`,
    ).all(actor.tenant_id, employeeId).map((row) => mapLoan(row));
    const paidOff = this.db.prepare(
      `SELECT * FROM employee_advance_loans WHERE tenant_id = ? AND employee_id = ? AND status IN ('paid_off','voided') ORDER BY updated_at DESC LIMIT 20`,
    ).all(actor.tenant_id, employeeId).map((row) => mapLoan(row));
    const totalOutstanding = active.reduce((sum, l) => sum + l.balance_cents, 0);
    const totalPrincipal = active.reduce((sum, l) => sum + l.principal_cents, 0);
    const totalPaidBack = totalPrincipal - totalOutstanding;
    return {
      employee: mapEmployee(employee),
      active_loans: active,
      history: paidOff,
      total_outstanding_cents: totalOutstanding,
      total_principal_cents: totalPrincipal,
      total_paid_back_cents: totalPaidBack,
      payoff_percent: totalPrincipal ? Math.round((totalPaidBack / totalPrincipal) * 100) : 0,
    };
  },

  // Called from updateEmployee when deactivating. Returns list of unpaid loans.
  advanceExitAlert(actor, employeeId) {
    const rows = this.db.prepare(
      `SELECT * FROM employee_advance_loans WHERE tenant_id = ? AND employee_id = ? AND status = 'active' AND balance_cents > 0`,
    ).all(actor.tenant_id, employeeId);
    return rows.map((row) => mapLoan(row));
  },

  // Portal helper — resolves the caller's own employee row and returns the summary.
  employeeLoanSummaryForActor(actor) {
    const emp = this.db.prepare("SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1 LIMIT 1")
      .get(actor.tenant_id, actor.id);
    if (!emp) throw error("employee_not_found", 404);
    return this.employeeLoanSummary(actor, emp.id);
  },
};

export function installAdvanceLedgerDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "advanceLedger",
    installedSymbol: ADVANCE_LEDGER_INSTALLED,
    methodGroups: [advanceLedgerMethods],
  });
}
