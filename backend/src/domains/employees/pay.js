import { randomUUID } from "node:crypto";
import {
  PAY_LEDGER_TYPES,
  addDays,
  advanceSchema,
  adjustmentSchema,
  error,
  grossCentsForMinutes,
  ledgerRow,
  manualPaymentSchema,
  mapEmployee,
  mapPayWeek,
  localDateForInstant,
  now,
  overlappedMinutes,
  parseShopDateTime,
  payWeekEnd,
  payWeekFilterSchema,
  payWeekStart,
  reopenPayWeekSchema,
  voidLedgerSchema
} from "./shared.js";

export const employeePayMethods = {
  ensurePayWeek(actor, employeeId, weekStart, openingCarryover = null) {
    const normalizedStart = payWeekStart(weekStart);
    const existing = this.db.prepare("SELECT * FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date = ?").get(actor.tenant_id, employeeId, normalizedStart);
    if (existing) return existing;
    const previous = this.db
      .prepare(
        `SELECT * FROM employee_pay_weeks
         WHERE tenant_id = ? AND employee_id = ? AND week_start_date < ? AND status = 'closed'
         ORDER BY week_start_date DESC LIMIT 1`,
      )
      .get(actor.tenant_id, employeeId, normalizedStart);
    const carryover = openingCarryover ?? previous?.closing_carryover_cents ?? 0;
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO employee_pay_weeks
       (id, tenant_id, employee_id, week_start_date, week_end_date, payday_date, status, opening_carryover_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(randomUUID(), actor.tenant_id, employeeId, normalizedStart, payWeekEnd(normalizedStart), payWeekEnd(normalizedStart), carryover, timestamp, timestamp);
    return this.db.prepare("SELECT * FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date = ?").get(actor.tenant_id, employeeId, normalizedStart);
  },

  payWeekCalculation(actor, employeeId, weekStart, openingCarryover) {
    const normalizedStart = payWeekStart(weekStart);
    const timezone = this.tenantTimezone(actor);
    const weekEnd = payWeekEnd(normalizedStart);
    const startUtc = parseShopDateTime(`${normalizedStart}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(weekEnd, 1)}T00:00:00`, timezone);
    const entries = this.db
      .prepare(
        `SELECT * FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND status = 'closed' AND clock_in_at < ? AND clock_out_at > ?
         ORDER BY clock_in_at, id`,
      )
      .all(actor.tenant_id, employeeId, endUtc, startUtc);
    const breakdownMap = new Map();
    const entryIds = [];
    for (const entry of entries) {
      const minutes = overlappedMinutes(entry, startUtc, endUtc);
      if (!minutes) continue;
      const key = String(entry.rate_cents_snapshot);
      const current = breakdownMap.get(key) || { hourly_rate_cents: entry.rate_cents_snapshot, minutes: 0, gross_pay_cents: 0 };
      current.minutes += minutes;
      current.gross_pay_cents += grossCentsForMinutes(minutes, entry.rate_cents_snapshot);
      breakdownMap.set(key, current);
      entryIds.push(entry.id);
    }
    const validMinutes = [...breakdownMap.values()].reduce((sum, entry) => sum + entry.minutes, 0);
    const gross = [...breakdownMap.values()].reduce((sum, entry) => sum + entry.gross_pay_cents, 0);
    const advances = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_advances WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const positive = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_adjustments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND direction = 'positive' AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const negative = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_adjustments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND direction = 'negative' AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const manual = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM employee_pay_manual_payments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? AND voided_at IS NULL").get(actor.tenant_id, employeeId, normalizedStart).total;
    const due = openingCarryover + gross + positive - negative - advances - manual;
    return {
      week_start_date: normalizedStart,
      week_end_date: weekEnd,
      payday_date: weekEnd,
      valid_minutes: validMinutes,
      gross_pay_cents: gross,
      positive_adjustments_cents: positive,
      negative_adjustments_cents: negative,
      advances_cents: advances,
      manual_payments_cents: manual,
      estimated_amount_due_cents: due,
      rate_breakdown: [...breakdownMap.values()].map((entry) => ({ ...entry, hours_decimal: (entry.minutes / 60).toFixed(2) })),
      entry_ids: entryIds,
    };
  },

  refreshOpenPayWeek(actor, employeeId, weekStart) {
    const week = this.ensurePayWeek(actor, employeeId, weekStart);
    if (week.status === "closed") return week;
    const calc = this.payWeekCalculation(actor, employeeId, week.week_start_date, week.opening_carryover_cents);
    this.db.prepare(
      `UPDATE employee_pay_weeks SET valid_minutes = ?, gross_pay_cents = ?, positive_adjustments_cents = ?, negative_adjustments_cents = ?,
       advances_cents = ?, manual_payments_cents = ?, estimated_amount_due_cents = ?, rate_breakdown_json = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
    ).run(calc.valid_minutes, calc.gross_pay_cents, calc.positive_adjustments_cents, calc.negative_adjustments_cents, calc.advances_cents, calc.manual_payments_cents, calc.estimated_amount_due_cents, JSON.stringify(calc.rate_breakdown), now(), week.id, actor.tenant_id);
    return this.db.prepare("SELECT * FROM employee_pay_weeks WHERE id = ? AND tenant_id = ?").get(week.id, actor.tenant_id);
  },

  requireOpenPayWeek(actor, employeeId, weekStart) {
    const week = this.ensurePayWeek(actor, employeeId, weekStart);
    if (week.status === "closed") throw error("pay_week_closed", 409);
    return week;
  },

  updateOpenCarryoverChain(actor, employeeId, fromWeekStart, openingCarryover) {
    let carry = openingCarryover;
    const weeks = this.db
      .prepare("SELECT * FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date >= ? ORDER BY week_start_date")
      .all(actor.tenant_id, employeeId, fromWeekStart);
    for (const week of weeks) {
      if (week.status === "closed") throw error("downstream_closed_pay_week_requires_manual_reopen", 409);
      this.db.prepare("UPDATE employee_pay_weeks SET opening_carryover_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(carry, now(), week.id, actor.tenant_id);
      const refreshed = this.refreshOpenPayWeek(actor, employeeId, week.week_start_date);
      carry = refreshed.estimated_amount_due_cents;
    }
  },

  propagateFollowingOpenWeeks(actor, employeeId, weekStart) {
    const current = this.refreshOpenPayWeek(actor, employeeId, weekStart);
    if (current.status === "closed") return current;
    const nextStart = addDays(current.week_end_date, 1);
    this.updateOpenCarryoverChain(actor, employeeId, nextStart, current.estimated_amount_due_cents);
    return current;
  },

  paySummary(actor, employeeId, weekStart) {
    this.requirePayManagement(actor);
    const employee = this.employeeRecord(actor, employeeId);
    const week = this.refreshOpenPayWeek(actor, employee.id, payWeekStart(weekStart || localDateForInstant(now(), this.tenantTimezone(actor))));
    return this.payWeekDetail(actor, employee, week, true);
  },

  myPaySummary(actor, weekStart = null) {
    const employee = this.activeEmployeeForActor(actor);
    const week = this.refreshOpenPayWeek(actor, employee.id, payWeekStart(weekStart || localDateForInstant(now(), this.tenantTimezone(actor))));
    return this.payWeekDetail(actor, employee, week, true);
  },

  listPayWeeks(actor, filters = {}) {
    this.requirePayManagement(actor);
    const parsed = payWeekFilterSchema.parse(filters);
    const params = [actor.tenant_id];
    let where = "tenant_id = ?";
    if (parsed.employee_id) {
      this.employeeRecord(actor, parsed.employee_id);
      where += " AND employee_id = ?";
      params.push(parsed.employee_id);
    }
    const rows = this.db.prepare(`SELECT * FROM employee_pay_weeks WHERE ${where} ORDER BY week_start_date DESC, employee_id`).all(...params);
    return rows.map(mapPayWeek);
  },

  payWeekDetail(actor, employee, week, includeLedger = true) {
    const mapped = mapPayWeek(week);
    const ledger = includeLedger ? {
      advances: this.db.prepare("SELECT * FROM employee_pay_advances WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? ORDER BY advance_date, created_at").all(actor.tenant_id, employee.id, week.week_start_date).map((row) => ledgerRow(row, "advance")),
      adjustments: this.db.prepare("SELECT * FROM employee_pay_adjustments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? ORDER BY created_at").all(actor.tenant_id, employee.id, week.week_start_date).map((row) => ledgerRow(row, "adjustment")),
      manual_payments: this.db.prepare("SELECT * FROM employee_pay_manual_payments WHERE tenant_id = ? AND employee_id = ? AND pay_week_start = ? ORDER BY payment_date, created_at").all(actor.tenant_id, employee.id, week.week_start_date).map((row) => ledgerRow(row, "manual_payment")),
    } : {};
    return { employee: mapEmployee(employee), week: mapped, ...ledger, formula: "Estimated Amount Due = Opening Carryover + Gross Pay + Positive Adjustments - Negative Adjustments - Advances - Manual Payments" };
  },

  recordPayAdvance(actor, payload) {
    this.requirePayManagement(actor);
    const input = advanceSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const week = this.requireOpenPayWeek(actor, employee.id, input.pay_week_start);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO employee_pay_advances (id, tenant_id, employee_id, pay_week_start, amount_cents, advance_date, note, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, week.week_start_date, input.amount_cents, input.advance_date, input.note, actor.id, now());
      this.propagateFollowingOpenWeeks(actor, employee.id, week.week_start_date);
      this.audit(actor, "pay.advance_create", "employee", employee.id, employee.portable_id, "Employee pay advance recorded", { advance_id: id, amount_cents: input.amount_cents });
      return this.paySummary(actor, employee.id, week.week_start_date);
    });
  },

  recordPayAdjustment(actor, payload) {
    this.requirePayManagement(actor);
    const input = adjustmentSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const week = this.requireOpenPayWeek(actor, employee.id, input.pay_week_start);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO employee_pay_adjustments (id, tenant_id, employee_id, pay_week_start, direction, amount_cents, reason, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, week.week_start_date, input.direction, input.amount_cents, input.reason, actor.id, now());
      this.propagateFollowingOpenWeeks(actor, employee.id, week.week_start_date);
      this.audit(actor, "pay.adjustment_create", "employee", employee.id, employee.portable_id, "Employee pay adjustment recorded", { adjustment_id: id, direction: input.direction, amount_cents: input.amount_cents });
      return this.paySummary(actor, employee.id, week.week_start_date);
    });
  },

  recordManualPayment(actor, payload) {
    this.requirePayManagement(actor);
    const input = manualPaymentSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const week = this.requireOpenPayWeek(actor, employee.id, input.pay_week_start);
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO employee_pay_manual_payments (id, tenant_id, employee_id, pay_week_start, amount_cents, payment_date, method, reference, note, recorded_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, week.week_start_date, input.amount_cents, input.payment_date, input.method ?? null, input.reference ?? null, input.note ?? null, actor.id, now());
      this.propagateFollowingOpenWeeks(actor, employee.id, week.week_start_date);
      this.audit(actor, "pay.manual_payment_create", "employee", employee.id, employee.portable_id, "Manual employee payment recorded", { payment_id: id, amount_cents: input.amount_cents });
      return this.paySummary(actor, employee.id, week.week_start_date);
    });
  },

  voidPayLedger(actor, type, id, payload) {
    this.requirePayManagement(actor);
    if (!PAY_LEDGER_TYPES.includes(type)) throw error("pay_ledger_type_invalid", 400);
    const input = voidLedgerSchema.parse(payload);
    return this.transaction(() => {
      const table = type === "advance" ? "employee_pay_advances" : type === "adjustment" ? "employee_pay_adjustments" : "employee_pay_manual_payments";
      const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`).get(id, actor.tenant_id);
      if (!row) throw error("pay_ledger_not_found", 404);
      this.requireOpenPayWeek(actor, row.employee_id, row.pay_week_start);
      if (row.voided_at) return this.paySummary(actor, row.employee_id, row.pay_week_start);
      this.db.prepare(`UPDATE ${table} SET voided_at = ?, voided_by_user_id = ?, void_reason = ? WHERE id = ? AND tenant_id = ?`).run(now(), actor.id, input.reason, id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, row.employee_id, row.pay_week_start);
      const employee = this.employeeRecord(actor, row.employee_id);
      this.audit(actor, `pay.${type}_void`, "employee", row.employee_id, employee.portable_id, "Employee pay ledger record voided", { ledger_id: id, type, reason: input.reason });
      return this.paySummary(actor, row.employee_id, row.pay_week_start);
    });
  },

  closePayWeek(actor, employeeId, weekStart) {
    this.requirePayManagement(actor);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, employeeId);
      let week = this.ensurePayWeek(actor, employee.id, payWeekStart(weekStart));
      if (week.status === "closed") return this.payWeekDetail(actor, employee, week, true);
      const laterClosed = this.db.prepare("SELECT id FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date > ? AND status = 'closed' LIMIT 1").get(actor.tenant_id, employee.id, week.week_start_date);
      if (laterClosed) throw error("downstream_closed_pay_week_requires_manual_reopen", 409);
      this.requireNoOpenTimeEntryInPayWeek(actor, employee.id, week, this.tenantTimezone(actor));
      week = this.refreshOpenPayWeek(actor, employee.id, week.week_start_date);
      const calc = this.payWeekCalculation(actor, employee.id, week.week_start_date, week.opening_carryover_cents);
      const timestamp = now();
      this.db.prepare(
        `UPDATE employee_pay_weeks SET status = 'closed', valid_minutes = ?, gross_pay_cents = ?, positive_adjustments_cents = ?,
         negative_adjustments_cents = ?, advances_cents = ?, manual_payments_cents = ?, estimated_amount_due_cents = ?,
         closing_carryover_cents = ?, rate_breakdown_json = ?, snapshot_json = ?, closed_by_user_id = ?, closed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(calc.valid_minutes, calc.gross_pay_cents, calc.positive_adjustments_cents, calc.negative_adjustments_cents, calc.advances_cents, calc.manual_payments_cents, calc.estimated_amount_due_cents, calc.estimated_amount_due_cents, JSON.stringify(calc.rate_breakdown), JSON.stringify(calc), actor.id, timestamp, timestamp, week.id, actor.tenant_id);
      const nextStart = addDays(week.week_end_date, 1);
      const next = this.ensurePayWeek(actor, employee.id, nextStart, calc.estimated_amount_due_cents);
      if (next.status === "open") this.updateOpenCarryoverChain(actor, employee.id, next.week_start_date, calc.estimated_amount_due_cents);
      this.audit(actor, "pay.week_close", "employee", employee.id, employee.portable_id, "Employee pay week closed", { week_start_date: week.week_start_date, estimated_amount_due_cents: calc.estimated_amount_due_cents });
      week = this.db.prepare("SELECT * FROM employee_pay_weeks WHERE id = ? AND tenant_id = ?").get(week.id, actor.tenant_id);
      return this.payWeekDetail(actor, employee, week, true);
    });
  },

  reopenPayWeek(actor, employeeId, weekStart, payload) {
    this.requirePayManagement(actor);
    const input = reopenPayWeekSchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, employeeId);
      const week = this.ensurePayWeek(actor, employee.id, weekStart);
      if (week.status !== "closed") return this.payWeekDetail(actor, employee, week, true);
      const laterClosed = this.db.prepare("SELECT id FROM employee_pay_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start_date > ? AND status = 'closed' LIMIT 1").get(actor.tenant_id, employee.id, week.week_start_date);
      if (laterClosed) throw error("downstream_closed_pay_week_requires_manual_reopen", 409);
      this.db.prepare(
        `UPDATE employee_pay_weeks SET status = 'open', closing_carryover_cents = NULL, reopened_by_user_id = ?, reopened_at = ?,
         reopen_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).run(actor.id, now(), input.reason, now(), week.id, actor.tenant_id);
      const refreshed = this.refreshOpenPayWeek(actor, employee.id, week.week_start_date);
      this.updateOpenCarryoverChain(actor, employee.id, addDays(refreshed.week_end_date, 1), refreshed.estimated_amount_due_cents);
      this.audit(actor, "pay.week_reopen", "employee", employee.id, employee.portable_id, "Employee pay week reopened", { week_start_date: week.week_start_date, reason: input.reason });
      return this.payWeekDetail(actor, employee, this.db.prepare("SELECT * FROM employee_pay_weeks WHERE id = ? AND tenant_id = ?").get(week.id, actor.tenant_id), true);
    });
  }
};
