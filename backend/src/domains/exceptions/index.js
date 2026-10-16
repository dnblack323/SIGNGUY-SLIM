import { z } from "zod";
import { installDomainMethods } from "../install.js";
import { MANAGER_ROLES, minutesBetween, now } from "../employees/shared.js";

const EXCEPTIONS_INSTALLED = Symbol.for("signguy.slim.exceptionsInstalled");
const IMPLAUSIBLE_OPEN_SHIFT_MINUTES = 16 * 60;
const LOW_DIRECT_LABOR_THRESHOLD = 70; // Percent

function isoWeekAgo(daysBack = 7) {
  const d = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function centsToDollars(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

function minutesToHours(minutes) {
  return ((minutes || 0) / 60).toFixed(2);
}

export const exceptionMethods = {
  exceptionsSummary(actor) {
    this.requireRole(actor, MANAGER_ROLES);
    const nowIso = now();
    const sevenDaysAgo = isoWeekAgo(7);

    // 1. Implausibly-long open shifts (still clocked in > 16 h)
    const openShifts = this.db
      .prepare(
        `SELECT t.id, t.employee_id, t.clock_in_at, e.name AS employee_name, e.employee_number
         FROM employee_time_entries t
         JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
         WHERE t.tenant_id = ? AND t.status = 'open'`,
      )
      .all(actor.tenant_id)
      .map((row) => ({
        id: row.id,
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        employee_number: row.employee_number,
        clock_in_at: row.clock_in_at,
        elapsed_minutes: minutesBetween(row.clock_in_at, nowIso),
      }))
      .filter((row) => row.elapsed_minutes > IMPLAUSIBLE_OPEN_SHIFT_MINUTES);

    // 2. Over-budget work orders (actual > budget)
    const overBudget = this.db
      .prepare(
        `SELECT wo.id, wo.work_order_number, wo.department_stage, wo.budget_minutes,
                o.order_number, o.title AS order_title,
                c.business_name, c.contact_name,
                COALESCE((SELECT SUM(COALESCE(jte.duration_minutes, 0))
                          FROM job_time_entries jte
                          WHERE jte.tenant_id = wo.tenant_id AND jte.work_order_id = wo.id AND jte.end_at IS NOT NULL), 0) AS actual_minutes
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.status = 'active' AND wo.budget_minutes > 0`,
      )
      .all(actor.tenant_id)
      .filter((row) => row.actual_minutes > row.budget_minutes)
      .map((row) => ({
        work_order_id: row.id,
        work_order_number: row.work_order_number,
        order_number: row.order_number,
        title: row.order_title,
        customer_name: row.business_name || row.contact_name,
        department_stage: row.department_stage,
        budget_minutes: row.budget_minutes,
        actual_minutes: row.actual_minutes,
        overage_minutes: row.actual_minutes - row.budget_minutes,
        overage_percent: Math.round(((row.actual_minutes - row.budget_minutes) / row.budget_minutes) * 100),
      }));

    // 3. Direct Labor % — per-employee ratio of billable job time / shift time
    //    last 7 days. Flag anyone below LOW_DIRECT_LABOR_THRESHOLD (70%).
    const shiftMinutesRows = this.db
      .prepare(
        `SELECT t.employee_id, e.name AS employee_name, e.employee_number,
                SUM(COALESCE(t.duration_minutes, 0)) AS shift_minutes
         FROM employee_time_entries t
         JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
         WHERE t.tenant_id = ? AND t.status = 'closed' AND t.clock_in_at >= ?
         GROUP BY t.employee_id`,
      )
      .all(actor.tenant_id, sevenDaysAgo);
    const jobMinutesRows = this.db
      .prepare(
        `SELECT jte.employee_id,
                SUM(CASE WHEN jte.work_order_id IS NOT NULL THEN COALESCE(jte.duration_minutes, 0) ELSE 0 END) AS billable_minutes,
                SUM(CASE WHEN jte.non_billable_code_id IS NOT NULL THEN COALESCE(jte.duration_minutes, 0) ELSE 0 END) AS non_billable_minutes
         FROM job_time_entries jte
         WHERE jte.tenant_id = ? AND jte.end_at IS NOT NULL AND jte.start_at >= ?
         GROUP BY jte.employee_id`,
      )
      .all(actor.tenant_id, sevenDaysAgo);
    const jobByEmployee = new Map(jobMinutesRows.map((row) => [row.employee_id, row]));
    const directLabor = shiftMinutesRows
      .map((row) => {
        const jobs = jobByEmployee.get(row.employee_id) || { billable_minutes: 0, non_billable_minutes: 0 };
        const billable = jobs.billable_minutes || 0;
        const nonBillable = jobs.non_billable_minutes || 0;
        const shift = row.shift_minutes || 0;
        const percent = shift ? Math.round((billable / shift) * 100) : 0;
        return {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          employee_number: row.employee_number,
          shift_minutes: shift,
          billable_minutes: billable,
          non_billable_minutes: nonBillable,
          untracked_minutes: Math.max(0, shift - billable - nonBillable),
          direct_labor_percent: percent,
        };
      })
      .filter((row) => row.shift_minutes >= 60 && row.direct_labor_percent < LOW_DIRECT_LABOR_THRESHOLD);

    // 4. Outstanding loans (advance ledger 2.0)
    const outstandingLoans = this.db
      .prepare(
        `SELECT l.id, l.principal_cents, l.balance_cents, l.deduction_mode, l.installment_cents,
                l.issued_date, e.name AS employee_name, e.employee_number, e.active AS employee_active
         FROM employee_advance_loans l
         JOIN employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
         WHERE l.tenant_id = ? AND l.status = 'active' AND l.balance_cents > 0
         ORDER BY e.active DESC, l.balance_cents DESC`,
      )
      .all(actor.tenant_id)
      .map((row) => ({
        loan_id: row.id,
        employee_name: row.employee_name,
        employee_number: row.employee_number,
        employee_active: Boolean(row.employee_active),
        principal_cents: row.principal_cents,
        balance_cents: row.balance_cents,
        deduction_mode: row.deduction_mode,
        installment_cents: row.installment_cents,
        issued_date: row.issued_date,
      }));

    return {
      generated_at: nowIso,
      thresholds: {
        implausible_open_shift_minutes: IMPLAUSIBLE_OPEN_SHIFT_MINUTES,
        low_direct_labor_percent: LOW_DIRECT_LABOR_THRESHOLD,
        direct_labor_window_days: 7,
      },
      open_shifts_too_long: openShifts,
      over_budget_work_orders: overBudget,
      low_direct_labor_employees: directLabor,
      outstanding_loans: outstandingLoans,
      counts: {
        open_shifts_too_long: openShifts.length,
        over_budget_work_orders: overBudget.length,
        low_direct_labor_employees: directLabor.length,
        outstanding_loans: outstandingLoans.length,
        total: openShifts.length + overBudget.length + directLabor.length + outstandingLoans.length,
      },
    };
  },

  payrollCsvExport(actor, filters = {}) {
    this.requirePayManagement(actor);
    const parsed = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.enum(["closed", "open", "all"]).optional().default("closed"),
    }).parse(filters);

    const params = [actor.tenant_id];
    let sql = `SELECT w.*, e.name AS employee_name, e.employee_number, e.email
               FROM employee_pay_weeks w
               JOIN employees e ON e.id = w.employee_id AND e.tenant_id = w.tenant_id
               WHERE w.tenant_id = ?`;
    if (parsed.status !== "all") { sql += " AND w.status = ?"; params.push(parsed.status); }
    if (parsed.from) { sql += " AND w.week_start_date >= ?"; params.push(parsed.from); }
    if (parsed.to) { sql += " AND w.week_start_date <= ?"; params.push(parsed.to); }
    sql += " ORDER BY w.week_start_date DESC, e.name";
    const rows = this.db.prepare(sql).all(...params);

    const header = [
      "employee_number", "employee_name", "email",
      "week_start_date", "week_end_date", "payday_date", "status",
      "hours_decimal", "gross_pay_dollars",
      "positive_adjustments_dollars", "negative_adjustments_dollars",
      "advances_dollars", "loan_deductions_dollars",
      "manual_payments_dollars",
      "opening_carryover_dollars", "closing_carryover_dollars",
      "estimated_amount_due_dollars",
    ];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push([
        row.employee_number,
        row.employee_name,
        row.email,
        row.week_start_date,
        row.week_end_date,
        row.payday_date,
        row.status,
        minutesToHours(row.valid_minutes),
        centsToDollars(row.gross_pay_cents),
        centsToDollars(row.positive_adjustments_cents),
        centsToDollars(row.negative_adjustments_cents),
        centsToDollars(row.advances_cents),
        centsToDollars(row.loan_deductions_cents),
        centsToDollars(row.manual_payments_cents),
        centsToDollars(row.opening_carryover_cents),
        row.closing_carryover_cents == null ? "" : centsToDollars(row.closing_carryover_cents),
        centsToDollars(row.estimated_amount_due_cents),
      ].map(csvCell).join(","));
    }
    const filename = `payroll_${parsed.from || "all"}_${parsed.to || "all"}_${parsed.status}.csv`;
    this.audit(actor, "payroll.csv_export", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, `Payroll CSV export (${rows.length} weeks)`, { from: parsed.from, to: parsed.to, status: parsed.status, row_count: rows.length });
    return { filename, mime_type: "text/csv", body: lines.join("\n") + "\n" };
  },
};

export function installExceptionsDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "exceptions",
    installedSymbol: EXCEPTIONS_INSTALLED,
    methodGroups: [exceptionMethods],
  });
}
