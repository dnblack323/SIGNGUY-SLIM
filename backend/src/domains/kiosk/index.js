import { randomUUID, createHash } from "node:crypto";
import { hashKioskPin, isBcryptHash, verifyKioskPin } from "../../security.js";
import { z } from "zod";
import { installDomainMethods } from "../install.js";
import { ADMIN_ROLES, error, now, minutesBetween, localDateForInstant, payWeekStart } from "../employees/shared.js";
import { DEPARTMENT_STAGES } from "../production/state.js";

const KIOSK_DOMAIN_INSTALLED = Symbol.for("signguy.slim.kioskDomainInstalled");

const pinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });
const pinWithNoteSchema = pinSchema.extend({ note: z.string().trim().max(500).nullable().optional() });
const startJobSchema = pinSchema.extend({
  work_order_id: z.string().min(1).nullable().optional(),
  non_billable_code_id: z.string().min(1).nullable().optional(),
  department_stage: z.enum(DEPARTMENT_STAGES),
  note: z.string().trim().max(500).nullable().optional(),
});
const setPinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

function legacyHashPin(tenantId, pin) {
  return createHash("sha256").update(`${tenantId}::${pin}`).digest("hex");
}

function isLegacyPinHash(hash) {
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash);
}

function matchesPinHash(tenantId, pin, hash) {
  if (isBcryptHash(hash)) return verifyKioskPin(tenantId, pin, hash);
  if (!isLegacyPinHash(hash)) return false;
  return legacyHashPin(tenantId, pin) === hash.toLowerCase();
}

export const kioskMethods = {
  employeeForPin(tenantId, pin) {
    const candidates = this.db
      .prepare("SELECT * FROM employees WHERE tenant_id = ? AND active = 1 AND pin_hash IS NOT NULL")
      .all(tenantId);
    const match = candidates.find((row) => matchesPinHash(tenantId, pin, row.pin_hash));
    if (!match) throw error("kiosk_pin_invalid", 401);
    if (isLegacyPinHash(match.pin_hash)) {
      this.db
        .prepare("UPDATE employees SET pin_hash = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(hashKioskPin(tenantId, pin), now(), match.id, tenantId);
    }
    return match;
  },

  kioskEmployeeState(actor, employee) {
    const openShift = this.db
      .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open' ORDER BY clock_in_at DESC LIMIT 1")
      .get(actor.tenant_id, employee.id);
    const openJob = openShift ? this.db
      .prepare("SELECT * FROM job_time_entries WHERE tenant_id = ? AND employee_id = ? AND end_at IS NULL ORDER BY start_at DESC LIMIT 1")
      .get(actor.tenant_id, employee.id) : null;
    let workOrder = null;
    let nonBillable = null;
    if (openJob?.work_order_id) {
      workOrder = this.db
        .prepare(
          `SELECT wo.id, wo.work_order_number, wo.department_stage, wo.on_hold, wo.budget_minutes, o.title AS order_title, o.order_number,
                  c.business_name, c.contact_name
           FROM work_orders wo
           JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
           JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
           WHERE wo.id = ? AND wo.tenant_id = ?`,
        )
        .get(openJob.work_order_id, actor.tenant_id);
    }
    if (openJob?.non_billable_code_id) {
      nonBillable = this.db
        .prepare("SELECT id, code, label FROM non_billable_codes WHERE id = ? AND tenant_id = ?")
        .get(openJob.non_billable_code_id, actor.tenant_id);
    }
    return {
      employee: {
        id: employee.id,
        name: employee.name,
        employee_number: employee.employee_number,
        role: employee.role,
      },
      shift: openShift ? {
        id: openShift.id,
        clock_in_at: openShift.clock_in_at,
        on_break: Boolean(openShift.break_started_at),
        break_started_at: openShift.break_started_at || null,
        break_total_minutes: openShift.unpaid_break_minutes || 0,
        elapsed_minutes: minutesBetween(openShift.clock_in_at, now()),
      } : null,
      active_job: openJob ? {
        id: openJob.id,
        start_at: openJob.start_at,
        department_stage: openJob.department_stage,
        elapsed_minutes: minutesBetween(openJob.start_at, now()),
        work_order: workOrder ? {
          id: workOrder.id,
          work_order_number: workOrder.work_order_number,
          title: workOrder.order_title,
          order_number: workOrder.order_number,
          customer_name: workOrder.business_name || workOrder.contact_name,
          department_stage: workOrder.department_stage,
          budget_minutes: workOrder.budget_minutes,
          on_hold: Boolean(workOrder.on_hold),
        } : null,
        non_billable: nonBillable || null,
      } : null,
    };
  },

  kioskVerifyPin(actor, payload) {
    const input = pinSchema.parse(payload);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.kioskEmployeeState(actor, employee);
  },

  kioskContext(actor) {
    const workOrders = this.db
      .prepare(
        `SELECT wo.id, wo.work_order_number, wo.department_stage, wo.on_hold, wo.budget_minutes, o.order_number, o.title AS order_title,
                c.business_name, c.contact_name,
                COALESCE((SELECT SUM(COALESCE(jte.duration_minutes, 0)) FROM job_time_entries jte
                          WHERE jte.tenant_id = wo.tenant_id AND jte.work_order_id = wo.id AND jte.end_at IS NOT NULL), 0) AS actual_minutes
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.status = 'active' AND wo.department_stage <> 'done'
         ORDER BY COALESCE(wo.due_date, '9999-12-31'), wo.work_order_number`,
      )
      .all(actor.tenant_id)
      .map((row) => ({
        id: row.id,
        work_order_number: row.work_order_number,
        title: row.order_title,
        order_number: row.order_number,
        customer_name: row.business_name || row.contact_name,
        department_stage: row.department_stage,
        on_hold: Boolean(row.on_hold),
        budget_minutes: row.budget_minutes,
        actual_minutes: row.actual_minutes,
      }));
    const nonBillableCodes = this.db
      .prepare("SELECT id, code, label FROM non_billable_codes WHERE tenant_id = ? AND active = 1 ORDER BY label")
      .all(actor.tenant_id);
    return { work_orders: workOrders, non_billable_codes: nonBillableCodes, department_stages: DEPARTMENT_STAGES };
  },

  kioskClockIn(actor, payload) {
    const input = pinWithNoteSchema.parse(payload);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT id FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'")
        .get(actor.tenant_id, employee.id);
      if (existing) throw error("kiosk_already_clocked_in", 409);
      this.requireOpenPayWeek(actor, employee.id, payWeekStart(localDateForInstant(now(), this.tenantTimezone(actor))));
      const rate = this.rateForInstant(actor, employee.id, now());
      const id = randomUUID();
      const clockInAt = now();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO employee_time_entries
         (id, tenant_id, employee_id, clock_in_at, clock_in_note, rate_cents_snapshot, status, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, clockInAt, input.note ?? null, rate.hourly_rate_cents, actor.id, timestamp, timestamp);
      this.audit(actor, "kiosk.clock_in", "employee", employee.id, employee.portable_id, `${employee.name} clocked in via kiosk`, { time_entry_id: id });
      return this.kioskEmployeeState(actor, employee);
    });
  },

  kioskClockOut(actor, payload) {
    const input = pinWithNoteSchema.parse(payload);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.transaction(() => {
      const entry = this.db
        .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'")
        .get(actor.tenant_id, employee.id);
      if (!entry) throw error("kiosk_not_clocked_in", 409);
      const weekStart = payWeekStart(localDateForInstant(entry.clock_in_at, this.tenantTimezone(actor)));
      this.requireOpenPayWeek(actor, employee.id, weekStart);
      // Auto-close any active job entry
      const openJob = this.db
        .prepare("SELECT * FROM job_time_entries WHERE tenant_id = ? AND employee_id = ? AND end_at IS NULL")
        .get(actor.tenant_id, employee.id);
      if (openJob) this.closeJobEntry(actor, openJob.id, "shift_end");

      // Close open break if any
      let breakMinutes = entry.unpaid_break_minutes || 0;
      if (entry.break_started_at) {
        breakMinutes += minutesBetween(entry.break_started_at, now());
      }
      const clockOutAt = now();
      const duration = Math.max(0, minutesBetween(entry.clock_in_at, clockOutAt) - breakMinutes);
      this.db.prepare(
        `UPDATE employee_time_entries SET clock_out_at = ?, clock_out_note = ?, duration_minutes = ?, unpaid_break_minutes = ?, break_started_at = NULL, status = 'closed', updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(clockOutAt, input.note ?? null, duration, breakMinutes, now(), entry.id, actor.tenant_id);
      this.propagateFollowingOpenWeeks(actor, employee.id, weekStart);
      this.audit(actor, "kiosk.clock_out", "employee", employee.id, employee.portable_id, `${employee.name} clocked out via kiosk`, { time_entry_id: entry.id, duration_minutes: duration, break_minutes: breakMinutes });
      return this.kioskEmployeeState(actor, employee);
    });
  },

  kioskBreakStart(actor, payload) {
    const input = pinSchema.parse(payload);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.transaction(() => {
      const entry = this.db
        .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'")
        .get(actor.tenant_id, employee.id);
      if (!entry) throw error("kiosk_not_clocked_in", 409);
      if (entry.break_started_at) throw error("kiosk_already_on_break", 409);
      // Auto-close active job while on break
      const openJob = this.db
        .prepare("SELECT * FROM job_time_entries WHERE tenant_id = ? AND employee_id = ? AND end_at IS NULL")
        .get(actor.tenant_id, employee.id);
      if (openJob) this.closeJobEntry(actor, openJob.id, "break");
      this.db.prepare("UPDATE employee_time_entries SET break_started_at = ?, updated_at = ? WHERE id = ?")
        .run(now(), now(), entry.id);
      this.audit(actor, "kiosk.break_start", "employee", employee.id, employee.portable_id, `${employee.name} started break`, { time_entry_id: entry.id });
      return this.kioskEmployeeState(actor, employee);
    });
  },

  kioskBreakEnd(actor, payload) {
    const input = pinSchema.parse(payload);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.transaction(() => {
      const entry = this.db
        .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'")
        .get(actor.tenant_id, employee.id);
      if (!entry) throw error("kiosk_not_clocked_in", 409);
      if (!entry.break_started_at) throw error("kiosk_not_on_break", 409);
      const breakMinutes = minutesBetween(entry.break_started_at, now());
      const totalBreak = (entry.unpaid_break_minutes || 0) + breakMinutes;
      this.db.prepare("UPDATE employee_time_entries SET break_started_at = NULL, unpaid_break_minutes = ?, updated_at = ? WHERE id = ?")
        .run(totalBreak, now(), entry.id);
      this.audit(actor, "kiosk.break_end", "employee", employee.id, employee.portable_id, `${employee.name} ended break`, { time_entry_id: entry.id, break_minutes: breakMinutes });
      return this.kioskEmployeeState(actor, employee);
    });
  },

  closeJobEntry(actor, jobId, reason = null, endAt = now()) {
    const job = this.db.prepare("SELECT * FROM job_time_entries WHERE id = ? AND tenant_id = ? AND end_at IS NULL").get(jobId, actor.tenant_id);
    if (!job) return null;
    const duration = minutesBetween(job.start_at, endAt);
    this.db.prepare(
      `UPDATE job_time_entries SET end_at = ?, duration_minutes = ?, auto_closed = ?, auto_close_reason = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
    ).run(endAt, duration, reason ? 1 : 0, reason, now(), jobId, actor.tenant_id);
    return { id: jobId, duration_minutes: duration, auto_close_reason: reason };
  },

  kioskStartJob(actor, payload) {
    const input = startJobSchema.parse(payload);
    if (!input.work_order_id && !input.non_billable_code_id) throw error("kiosk_target_required", 400);
    if (input.work_order_id && input.non_billable_code_id) throw error("kiosk_target_conflict", 400);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.transaction(() => {
      const shift = this.db
        .prepare("SELECT * FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open'")
        .get(actor.tenant_id, employee.id);
      if (!shift) throw error("kiosk_not_clocked_in", 409);
      if (shift.break_started_at) throw error("kiosk_on_break", 409);
      // Close any existing job
      const openJob = this.db
        .prepare("SELECT * FROM job_time_entries WHERE tenant_id = ? AND employee_id = ? AND end_at IS NULL")
        .get(actor.tenant_id, employee.id);
      if (openJob) this.closeJobEntry(actor, openJob.id, "switched_job");
      if (input.work_order_id) {
        const wo = this.db.prepare("SELECT id, on_hold FROM work_orders WHERE id = ? AND tenant_id = ? AND status = 'active'").get(input.work_order_id, actor.tenant_id);
        if (!wo) throw error("work_order_not_found", 404);
        if (wo.on_hold) throw error("work_order_on_hold", 409);
      }
      if (input.non_billable_code_id) {
        const code = this.db.prepare("SELECT id FROM non_billable_codes WHERE id = ? AND tenant_id = ? AND active = 1").get(input.non_billable_code_id, actor.tenant_id);
        if (!code) throw error("non_billable_code_not_found", 404);
      }
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO job_time_entries
         (id, tenant_id, employee_id, shift_id, work_order_id, non_billable_code_id, department_stage, start_at, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, employee.id, shift.id, input.work_order_id || null, input.non_billable_code_id || null, input.department_stage, timestamp, input.note ?? null, timestamp, timestamp);
      this.audit(actor, "kiosk.job_start", "employee", employee.id, employee.portable_id, `${employee.name} started a job task`, { job_time_entry_id: id, work_order_id: input.work_order_id, non_billable_code_id: input.non_billable_code_id, department_stage: input.department_stage });
      return this.kioskEmployeeState(actor, employee);
    });
  },

  kioskEndJob(actor, payload) {
    const input = pinSchema.parse(payload);
    const employee = this.employeeForPin(actor.tenant_id, input.pin);
    return this.transaction(() => {
      const openJob = this.db
        .prepare("SELECT * FROM job_time_entries WHERE tenant_id = ? AND employee_id = ? AND end_at IS NULL")
        .get(actor.tenant_id, employee.id);
      if (!openJob) throw error("kiosk_no_active_job", 409);
      this.closeJobEntry(actor, openJob.id, null);
      this.audit(actor, "kiosk.job_end", "employee", employee.id, employee.portable_id, `${employee.name} ended a job task`, { job_time_entry_id: openJob.id });
      return this.kioskEmployeeState(actor, employee);
    });
  },

  setEmployeePin(actor, employeeId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = setPinSchema.parse(payload);
    const employee = this.employeeRecord(actor, employeeId);
    const pinHash = hashKioskPin(actor.tenant_id, input.pin);
    const conflict = this.db
      .prepare("SELECT id, pin_hash FROM employees WHERE tenant_id = ? AND pin_hash IS NOT NULL AND id <> ?")
      .all(actor.tenant_id, employeeId)
      .find((row) => matchesPinHash(actor.tenant_id, input.pin, row.pin_hash));
    if (conflict) throw error("pin_conflict", 409);
    this.db.prepare("UPDATE employees SET pin_hash = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(pinHash, now(), employeeId, actor.tenant_id);
    this.audit(actor, "employee.pin_set", "employee", employee.id, employee.portable_id, `Kiosk PIN set for ${employee.name}`);
    return { ok: true };
  },

  clearEmployeePin(actor, employeeId) {
    this.requireRole(actor, ADMIN_ROLES);
    const employee = this.employeeRecord(actor, employeeId);
    this.db.prepare("UPDATE employees SET pin_hash = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now(), employeeId, actor.tenant_id);
    this.audit(actor, "employee.pin_clear", "employee", employee.id, employee.portable_id, `Kiosk PIN cleared for ${employee.name}`);
    return { ok: true };
  },

  hasEmployeePin(actor, employeeId) {
    const row = this.db.prepare("SELECT pin_hash FROM employees WHERE id = ? AND tenant_id = ?").get(employeeId, actor.tenant_id);
    return { has_pin: Boolean(row?.pin_hash) };
  },

  // -------- Non-billable code admin --------
  listNonBillableCodes(actor, { include_inactive = false } = {}) {
    const rows = include_inactive
      ? this.db.prepare("SELECT * FROM non_billable_codes WHERE tenant_id = ? ORDER BY active DESC, label").all(actor.tenant_id)
      : this.db.prepare("SELECT * FROM non_billable_codes WHERE tenant_id = ? AND active = 1 ORDER BY label").all(actor.tenant_id);
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      active: Boolean(row.active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  },

  createNonBillableCode(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z.object({
      code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/),
      label: z.string().trim().min(1).max(160),
    }).parse(payload);
    const id = randomUUID();
    const timestamp = now();
    try {
      this.db.prepare(
        `INSERT INTO non_billable_codes (id, tenant_id, code, label, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).run(id, actor.tenant_id, input.code, input.label, timestamp, timestamp);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw error("non_billable_code_conflict", 409);
      throw err;
    }
    this.audit(actor, "non_billable_code.create", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, `Non-billable code created: ${input.code}`, { id, code: input.code, label: input.label });
    return this.db.prepare("SELECT * FROM non_billable_codes WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
  },

  updateNonBillableCode(actor, id, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = z.object({
      label: z.string().trim().min(1).max(160).optional(),
      active: z.boolean().optional(),
    }).parse(payload);
    const existing = this.db.prepare("SELECT * FROM non_billable_codes WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!existing) throw error("non_billable_code_not_found", 404);
    const fields = [];
    const values = [];
    if (input.label !== undefined) { fields.push("label = ?"); values.push(input.label); }
    if (input.active !== undefined) { fields.push("active = ?"); values.push(input.active ? 1 : 0); }
    if (!fields.length) throw error("no_updates", 400);
    fields.push("updated_at = ?");
    values.push(now(), id, actor.tenant_id);
    this.db.prepare(`UPDATE non_billable_codes SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    this.audit(actor, "non_billable_code.update", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, `Non-billable code updated: ${existing.code}`, { id, changes: input });
    return this.db.prepare("SELECT * FROM non_billable_codes WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
  },
};

export function installKioskDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "kiosk",
    installedSymbol: KIOSK_DOMAIN_INSTALLED,
    methodGroups: [kioskMethods],
  });
}
