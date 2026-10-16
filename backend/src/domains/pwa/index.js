import { randomUUID } from "node:crypto";
import { z } from "zod";
import { installDomainMethods } from "../install.js";
import { MANAGER_ROLES, error, mapEmployee, now, parseShopDateTime, portable } from "../employees/shared.js";

const PWA_INSTALLED = Symbol.for("signguy.slim.pwaInstalled");

const createFixRequestSchema = z.object({
  time_entry_id: z.string().min(1).nullable().optional(),
  requested_clock_in_at: z.string().min(1).nullable().optional(),
  requested_clock_out_at: z.string().min(1).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
});

const reviewFixRequestSchema = z.object({
  approve: z.boolean(),
  review_note: z.string().trim().max(500).nullable().optional(),
});

function mapFixRequest(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    portable_id: row.portable_id,
    employee_id: row.employee_id,
    time_entry_id: row.time_entry_id,
    requested_clock_in_at: row.requested_clock_in_at,
    requested_clock_out_at: row.requested_clock_out_at,
    reason: row.reason,
    status: row.status,
    reviewed_by_user_id: row.reviewed_by_user_id,
    reviewed_at: row.reviewed_at,
    review_note: row.review_note,
    applied_time_entry_id: row.applied_time_entry_id,
    applied_at: row.applied_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extras,
  };
}

function requireSelfEmployee(service, actor) {
  const emp = service.db.prepare("SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1 LIMIT 1")
    .get(actor.tenant_id, actor.id);
  if (!emp) throw error("employee_not_found", 404);
  return emp;
}

function requestedCorrectionPayload(service, actor, row) {
  const entry = service.db.prepare("SELECT * FROM employee_time_entries WHERE id = ? AND tenant_id = ? AND employee_id = ?")
    .get(row.time_entry_id, actor.tenant_id, row.employee_id);
  if (!entry) throw error("time_entry_not_found", 404);
  const timezone = service.tenantTimezone(actor);
  const payload = {};
  let changed = false;
  if (row.requested_clock_in_at) {
    const requested = parseShopDateTime(row.requested_clock_in_at, timezone);
    if (requested !== entry.clock_in_at) changed = true;
    payload.clock_in_at = row.requested_clock_in_at;
  }
  if (row.requested_clock_out_at) {
    const requested = parseShopDateTime(row.requested_clock_out_at, timezone);
    if (requested !== entry.clock_out_at) changed = true;
    payload.clock_out_at = row.requested_clock_out_at;
  }
  if (!changed) throw error("punch_fix_no_changes", 400);
  return payload;
}

export const pwaMethods = {
  // My Queue: work orders assigned directly to the employee's user account, plus
  // work orders whose items are assigned to the employee. Filtered to active,
  // grouped by department stage.
  employeeQueue(actor) {
    const employee = requireSelfEmployee(this, actor);
    const rows = this.db
      .prepare(
        `SELECT DISTINCT wo.id, wo.work_order_number, wo.department_stage, wo.on_hold, wo.on_hold_reason,
                wo.budget_minutes, wo.due_date,
                o.order_number, o.title AS order_title,
                c.business_name, c.contact_name,
                COALESCE((SELECT SUM(COALESCE(jte.duration_minutes, 0))
                          FROM job_time_entries jte
                          WHERE jte.tenant_id = wo.tenant_id AND jte.work_order_id = wo.id AND jte.end_at IS NOT NULL), 0) AS actual_minutes
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN order_items oi ON oi.id = woi.order_item_id AND oi.tenant_id = woi.tenant_id
         WHERE wo.tenant_id = ? AND wo.status = 'active' AND wo.department_stage <> 'done'
           AND (wo.assigned_user_id = ? OR oi.assigned_user_id = ?)
         ORDER BY COALESCE(wo.due_date, '9999-12-31'), wo.work_order_number`,
      )
      .all(actor.tenant_id, actor.id, actor.id)
      .map((row) => ({
        id: row.id,
        work_order_number: row.work_order_number,
        department_stage: row.department_stage,
        on_hold: Boolean(row.on_hold),
        on_hold_reason: row.on_hold_reason,
        budget_minutes: row.budget_minutes,
        actual_minutes: row.actual_minutes,
        due_date: row.due_date,
        order_number: row.order_number,
        title: row.order_title,
        customer_name: row.business_name || row.contact_name,
      }));
    return { employee: mapEmployee(employee), queue: rows };
  },

  createPunchFixRequest(actor, payload) {
    const employee = requireSelfEmployee(this, actor);
    const input = createFixRequestSchema.parse(payload);
    if (!input.requested_clock_in_at && !input.requested_clock_out_at) {
      throw error("punch_fix_target_required", 400);
    }
    if (input.time_entry_id) {
      const entry = this.db.prepare("SELECT id FROM employee_time_entries WHERE id = ? AND tenant_id = ? AND employee_id = ?")
        .get(input.time_entry_id, actor.tenant_id, employee.id);
      if (!entry) throw error("time_entry_not_found", 404);
    }
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO punch_fix_requests
       (id, portable_id, tenant_id, employee_id, time_entry_id, requested_clock_in_at, requested_clock_out_at, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(id, portable("punch_fix_request"), actor.tenant_id, employee.id, input.time_entry_id || null, input.requested_clock_in_at || null, input.requested_clock_out_at || null, input.reason, timestamp, timestamp);
    this.audit(actor, "punch_fix.request", "employee", employee.id, employee.portable_id, `Punch fix request submitted`, { id, reason: input.reason });
    const row = this.db.prepare("SELECT * FROM punch_fix_requests WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    return mapFixRequest(row);
  },

  listMyPunchFixRequests(actor) {
    const employee = requireSelfEmployee(this, actor);
    const rows = this.db.prepare(
      `SELECT * FROM punch_fix_requests WHERE tenant_id = ? AND employee_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).all(actor.tenant_id, employee.id);
    return rows.map((row) => mapFixRequest(row));
  },

  listPendingPunchFixRequests(actor, filters = {}) {
    this.requireRole(actor, MANAGER_ROLES);
    const status = filters.status || "pending";
    const rows = this.db.prepare(
      `SELECT r.*, e.name AS employee_name, e.employee_number
       FROM punch_fix_requests r
       JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
       WHERE r.tenant_id = ? AND (? = 'all' OR r.status = ?)
       ORDER BY r.status = 'pending' DESC, r.created_at DESC
       LIMIT 100`,
    ).all(actor.tenant_id, status, status);
    return rows.map((row) => mapFixRequest(row, { employee_name: row.employee_name, employee_number: row.employee_number }));
  },

  reviewPunchFixRequest(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = reviewFixRequestSchema.parse(payload);
    const row = this.db.prepare("SELECT * FROM punch_fix_requests WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("punch_fix_not_found", 404);
    if (row.status !== "pending") throw error("punch_fix_already_reviewed", 409);
    return this.transaction(() => {
      const employee = this.employeeRecord(actor, row.employee_id);
      if (!input.approve) {
        const timestamp = now();
        this.db.prepare(
          `UPDATE punch_fix_requests SET status = 'denied', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        ).run(actor.id, timestamp, input.review_note || null, timestamp, id, actor.tenant_id);
        this.audit(actor, "punch_fix.denied", "employee", row.employee_id, employee.portable_id, "Punch fix denied", { id, review_note: input.review_note });
        return mapFixRequest(this.db.prepare("SELECT * FROM punch_fix_requests WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id), { employee_name: employee.name, employee_number: employee.employee_number });
      }
      if (!row.time_entry_id) throw error("punch_fix_time_entry_required", 400);
      const reason = `Punch fix approved: ${row.reason}${input.review_note ? ` (${input.review_note})` : ""}`;
      const correction = requestedCorrectionPayload(this, actor, row);
      const corrected = this.updateTimeEntry(actor, row.time_entry_id, {
        ...correction,
        reason,
      });
      const timestamp = now();
      this.db.prepare(
        `UPDATE punch_fix_requests
         SET status = 'applied', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ?,
             applied_time_entry_id = ?, applied_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(actor.id, timestamp, input.review_note || null, corrected.id, timestamp, timestamp, id, actor.tenant_id);
      this.audit(actor, "punch_fix.applied", "employee", row.employee_id, employee.portable_id, "Punch fix applied", { id, time_entry_id: corrected.id, review_note: input.review_note });
      return mapFixRequest(this.db.prepare("SELECT * FROM punch_fix_requests WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id), { employee_name: employee.name, employee_number: employee.employee_number, time_entry: corrected });
    });
  },
};

export function installPwaDomain(SlimService) {
  installDomainMethods(SlimService, {
    domainName: "pwa",
    installedSymbol: PWA_INSTALLED,
    methodGroups: [pwaMethods],
  });
}
