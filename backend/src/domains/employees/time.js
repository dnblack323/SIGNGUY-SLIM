import { randomUUID } from "node:crypto";
import {
  IMPLAUSIBLE_SHIFT_MINUTES,
  MANAGER_ROLES,
  addDays,
  adminTimeEntrySchema,
  bool,
  clockNoteSchema,
  error,
  localDateForInstant,
  mapEmployee,
  mapPayWeek,
  mapTimeEntry,
  minutesBetween,
  now,
  parseShopDateTime,
  payWeekFilterSchema,
  payWeekStart,
  payWeekStartsForInterval,
  timeCorrectionSchema,
  voidLedgerSchema
} from "./shared.js";

export const employeeTimeMethods = {
  requireOpenPayWeeksForInterval(actor, employeeId, clockInAt, clockOutAt, timezone) {
    for (const weekStart of payWeekStartsForInterval(clockInAt, clockOutAt, timezone)) {
      this.requireOpenPayWeek(actor, employeeId, weekStart);
    }
  },

  requireNoOpenTimeEntryInPayWeek(actor, employeeId, week, timezone) {
    const startUtc = parseShopDateTime(`${week.week_start_date}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(week.week_end_date, 1)}T00:00:00`, timezone);
    const current = now();
    const open = this.db
      .prepare(
        `SELECT id FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND status = 'open' AND clock_in_at < ? AND ? > ?
         LIMIT 1`,
      )
      .get(actor.tenant_id, employeeId, endUtc, current, startUtc);
    if (open) throw error("pay_week_has_open_time_entry", 409);
  },

  currentTimeClock(actor) {
    const employee = this.activeEmployeeForActor(actor);
    return this.timeClockForEmployee(actor, employee.id);
  },

  timeClockForEmployee(actor, employeeId, weekStartOverride = null) {
    const employee = this.employeeRecord(actor, employeeId);
    const timezone = this.tenantTimezone(actor);
    const weekStart = payWeekStart(weekStartOverride || localDateForInstant(now(), timezone));
    const week = this.refreshOpenPayWeek(actor, employeeId, weekStart);
    const open = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open' ORDER BY clock_in_at DESC LIMIT 1").get(actor.tenant_id, employeeId);
    const startUtc = parseShopDateTime(`${week.week_start_date}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(week.week_end_date, 1)}T00:00:00`, timezone);
    const entries = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND clock_in_at >= ? AND clock_in_at < ? ORDER BY clock_in_at").all(actor.tenant_id, employeeId, startUtc, endUtc);
    const includePay = this.canManagePay(actor);
    return {
      employee: mapEmployee(employee),
      timezone,
      week: mapPayWeek(week),
      open_entry: mapTimeEntry(open, timezone, { includePay }),
      entries: entries.map((entry) => mapTimeEntry(entry, timezone, { includePay })),
      current_week_total_minutes: entries.filter((entry) => entry.status === "closed").reduce((sum, entry) => sum + entry.duration_minutes, 0),
      current_week_total_hours_decimal: (entries.filter((entry) => entry.status === "closed").reduce((sum, entry) => sum + entry.duration_minutes, 0) / 60).toFixed(2),
      warning: open && minutesBetween(open.clock_in_at, now()) > IMPLAUSIBLE_SHIFT_MINUTES ? "open_entry_implausibly_long" : "",
    };
  },

  clockIn(actor, payload = {}) {
    const employee = this.activeEmployeeForActor(actor);
    const input = clockNoteSchema.parse(payload);
    const existing = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'").get(actor.tenant_id, employee.id);
    if (existing) return { ...this.timeClockForEmployee(actor, employee.id), idempotent: true };
    const timezone = this.tenantTimezone(actor);
    const clockInAt = now();
    const weekStart = payWeekStart(localDateForInstant(clockInAt, timezone));
    this.requireOpenPayWeek(actor, employee.id, weekStart);
    const rate = this.rateForInstant(actor, employee.id, clockInAt);
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO employee_time_entries
       (id, tenant_id, employee_id, clock_in_at, clock_in_note, rate_cents_snapshot, status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(id, actor.tenant_id, employee.id, clockInAt, input.note ?? null, rate.hourly_rate_cents, actor.id, timestamp, timestamp);
    this.audit(actor, "time.clock_in", "employee", employee.id, employee.portable_id, `${employee.name} clocked in`, { time_entry_id: id });
    return { ...this.timeClockForEmployee(actor, employee.id, weekStart), idempotent: false };
  },

  clockOut(actor, payload = {}) {
    const employee = this.activeEmployeeForActor(actor);
    const input = clockNoteSchema.parse(payload);
    const entry = this.db.prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'").get(actor.tenant_id, employee.id);
    if (!entry) return { ...this.timeClockForEmployee(actor, employee.id), idempotent: true };
    return this.transaction(() => {
      const timezone = this.tenantTimezone(actor);
      const clockOutAt = now();
      if (new Date(clockOutAt) <= new Date(entry.clock_in_at)) throw error("time_entry_invalid_range", 400);
      const duration = minutesBetween(entry.clock_in_at, clockOutAt);
      const weekStart = payWeekStart(localDateForInstant(entry.clock_in_at, timezone));
      this.requireOpenPayWeek(actor, employee.id, weekStart);
      this.db.prepare(
        `UPDATE employee_time_entries SET clock_out_at = ?, clock_out_note = ?, duration_minutes = ?, status = 'closed',
         implausible = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).run(clockOutAt, input.note ?? null, duration, bool(duration > IMPLAUSIBLE_SHIFT_MINUTES), now(), entry.id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "time.clock_out", "employee", employee.id, employee.portable_id, `${employee.name} clocked out`, { time_entry_id: entry.id, duration_minutes: duration });
      return { ...this.timeClockForEmployee(actor, employee.id, weekStart), idempotent: false };
    });
  },

  listTimeEntries(actor, filters = {}) {
    this.requireRole(actor, MANAGER_ROLES);
    const parsed = payWeekFilterSchema.parse(filters);
    const employeeId = parsed.employee_id || this.db.prepare("SELECT id FROM employees WHERE tenant_id = ? ORDER BY name LIMIT 1").get(actor.tenant_id)?.id || "";
    if (!employeeId) return { employee: null, entries: [], week: null, clocked_in: [] };
    const employee = this.employeeRecord(actor, employeeId);
    const timezone = this.tenantTimezone(actor);
    const includePay = this.canManagePay(actor);
    const weekStart = payWeekStart(parsed.week_start_date || localDateForInstant(now(), timezone));
    const week = this.refreshOpenPayWeek(actor, employeeId, weekStart);
    const startUtc = parseShopDateTime(`${week.week_start_date}T00:00:00`, timezone);
    const endUtc = parseShopDateTime(`${addDays(week.week_end_date, 1)}T00:00:00`, timezone);
    const entries = this.db
      .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND clock_in_at >= ? AND clock_in_at < ? ORDER BY clock_in_at")
      .all(actor.tenant_id, employeeId, startUtc, endUtc)
      .map((entry) => mapTimeEntry(entry, timezone, { includePay }));
    const totalMinutes = entries.filter((entry) => entry.status === "closed").reduce((sum, entry) => sum + entry.duration_minutes, 0);
    const clockedIn = this.db
      .prepare("SELECT t.*, e.name AS employee_name FROM employee_time_entries t JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id WHERE t.tenant_id = ? AND t.status = 'open' ORDER BY t.clock_in_at")
      .all(actor.tenant_id)
      .map((row) => ({ ...mapTimeEntry(row, timezone, { includePay }), employee_name: row.employee_name }));
    return { employee: mapEmployee(employee, { includePay }), entries, week: mapPayWeek(week), clocked_in: clockedIn, current_week_total_minutes: totalMinutes, current_week_total_hours_decimal: (totalMinutes / 60).toFixed(2) };
  },

  addTimeEntry(actor, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = adminTimeEntrySchema.parse(payload);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, input.employee_id);
      const timezone = this.tenantTimezone(actor);
      const clockInAt = parseShopDateTime(input.clock_in_at, timezone);
      const clockOutAt = parseShopDateTime(input.clock_out_at, timezone);
      if (new Date(clockOutAt) <= new Date(clockInAt)) throw error("time_entry_invalid_range", 400);
      const overlapping = this.db.prepare(
        `SELECT id FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND status <> 'void'
           AND clock_in_at < ? AND COALESCE(clock_out_at, '9999-12-31T00:00:00.000Z') > ?
         LIMIT 1`,
      ).get(actor.tenant_id, employee.id, clockOutAt, clockInAt);
      if (overlapping) throw error("time_entry_overlap", 409);
      const weekStart = payWeekStart(localDateForInstant(clockInAt, timezone));
      this.requireOpenPayWeeksForInterval(actor, employee.id, clockInAt, clockOutAt, timezone);
      const rate = this.rateForInstant(actor, employee.id, clockInAt);
      const duration = minutesBetween(clockInAt, clockOutAt);
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO employee_time_entries
         (id, tenant_id, employee_id, clock_in_at, clock_out_at, clock_in_note, clock_out_note, duration_minutes, rate_cents_snapshot, status, implausible, created_by_user_id, corrected_by_user_id, corrected_at, correction_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, clockInAt, clockOutAt, input.clock_in_note ?? null, input.clock_out_note ?? null, duration, rate.hourly_rate_cents, bool(duration > IMPLAUSIBLE_SHIFT_MINUTES), actor.id, actor.id, timestamp, input.reason, timestamp, timestamp);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "time.entry_add", "employee", employee.id, employee.portable_id, "Time Entry added by administrator", { time_entry_id: id, reason: input.reason });
      return mapTimeEntry(this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id), timezone, { includePay: this.canManagePay(actor) });
    });
  },

  updateTimeEntry(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = timeCorrectionSchema.parse(payload);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("time_entry_not_found", 404);
      if (existing.status === "void") throw error("time_entry_voided", 409);
      const employee = this.employeeRecord(actor, existing.employee_id);
      const timezone = this.tenantTimezone(actor);
      const clockInAt = input.clock_in_at ? parseShopDateTime(input.clock_in_at, timezone) : existing.clock_in_at;
      const clockOutAt = input.clock_out_at === null ? null : input.clock_out_at ? parseShopDateTime(input.clock_out_at, timezone) : existing.clock_out_at;
      if (clockOutAt && new Date(clockOutAt) <= new Date(clockInAt)) throw error("time_entry_invalid_range", 400);
      const status = clockOutAt ? "closed" : "open";
      const duration = clockOutAt ? minutesBetween(clockInAt, clockOutAt) : 0;
      const overlap = this.db.prepare(
        `SELECT id FROM employee_time_entries
         WHERE tenant_id = ? AND employee_id = ? AND id <> ? AND status <> 'void'
           AND clock_in_at < COALESCE(?, '9999-12-31T00:00:00.000Z')
           AND COALESCE(clock_out_at, '9999-12-31T00:00:00.000Z') > ?
         LIMIT 1`,
      ).get(actor.tenant_id, employee.id, id, clockOutAt, clockInAt);
      if (overlap) throw error("time_entry_overlap", 409);
      const previousWeekStart = payWeekStart(localDateForInstant(existing.clock_in_at, timezone));
      const nextWeekStart = payWeekStart(localDateForInstant(clockInAt, timezone));
      this.requireOpenPayWeek(actor, employee.id, previousWeekStart);
      if (clockOutAt) this.requireOpenPayWeeksForInterval(actor, employee.id, clockInAt, clockOutAt, timezone);
      else this.requireOpenPayWeek(actor, employee.id, nextWeekStart);
      const rate = this.rateForInstant(actor, employee.id, clockInAt);
      const before = mapTimeEntry(existing, timezone, { includePay: true });
      this.db.prepare(
        `UPDATE employee_time_entries SET clock_in_at = ?, clock_out_at = ?, clock_in_note = ?, clock_out_note = ?, duration_minutes = ?,
         rate_cents_snapshot = ?, status = ?, implausible = ?, corrected_by_user_id = ?, corrected_at = ?, correction_reason = ?, before_json = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(clockInAt, clockOutAt, input.clock_in_note ?? existing.clock_in_note, input.clock_out_note ?? existing.clock_out_note, duration, rate.hourly_rate_cents, status, bool(status === "open" ? minutesBetween(clockInAt, now()) > IMPLAUSIBLE_SHIFT_MINUTES : duration > IMPLAUSIBLE_SHIFT_MINUTES), actor.id, now(), input.reason, JSON.stringify(before), now(), id, actor.tenant_id);
      const updated = this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      this.db.prepare("UPDATE employee_time_entries SET after_json = ? WHERE id = ? AND tenant_id = ?").run(JSON.stringify(mapTimeEntry(updated, timezone, { includePay: true })), id, actor.tenant_id);
      const propagationStart = previousWeekStart < nextWeekStart ? previousWeekStart : nextWeekStart;
      this.propagateFollowingOpenWeeks(actor, employee.id, propagationStart);
      this.audit(actor, "time.entry_correct", "employee", employee.id, employee.portable_id, "Time Entry corrected by administrator", { time_entry_id: id, reason: input.reason, before, after: mapTimeEntry(updated, timezone, { includePay: true }) });
      return mapTimeEntry(updated, timezone, { includePay: this.canManagePay(actor) });
    });
  },

  voidTimeEntry(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = voidLedgerSchema.parse(payload);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("time_entry_not_found", 404);
      const employee = this.employeeRecord(actor, existing.employee_id);
      const timezone = this.tenantTimezone(actor);
      const weekStart = payWeekStart(localDateForInstant(existing.clock_in_at, timezone));
      this.requireOpenPayWeek(actor, employee.id, weekStart);
      const voidedAt = now();
      const clockOutAt = existing.clock_out_at || voidedAt;
      this.db.prepare("UPDATE employee_time_entries SET status = 'void', clock_out_at = ?, voided_by_user_id = ?, voided_at = ?, void_reason = ?, duration_minutes = 0, updated_at = ? WHERE id = ? AND tenant_id = ?").run(clockOutAt, actor.id, voidedAt, input.reason, now(), id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "time.entry_void", "employee", employee.id, employee.portable_id, "Time Entry voided", { time_entry_id: id, reason: input.reason });
      return mapTimeEntry(this.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id), timezone, { includePay: this.canManagePay(actor) });
    });
  }
};
