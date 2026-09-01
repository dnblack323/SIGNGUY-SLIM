import { randomUUID } from "node:crypto";
import {
  ADMIN_ROLES,
  MANAGER_ROLES,
  bool,
  employeeRateSchema,
  employeeSchema,
  employeeUpdateSchema,
  error,
  localDateForInstant,
  mapEmployee,
  normalizedEmail,
  now,
  portable,
  today
} from "./shared.js";

export const employeeAdminMethods = {
  nextEmployeeNumber(tenantId) {
    const next = this.db.prepare("SELECT next_value FROM tenant_sequences WHERE tenant_id = ? AND sequence_name = 'employee'").get(tenantId)?.next_value || 1;
    this.db.prepare(
      `INSERT INTO tenant_sequences (tenant_id, sequence_name, next_value)
       VALUES (?, 'employee', ?)
       ON CONFLICT(tenant_id, sequence_name) DO UPDATE SET next_value = excluded.next_value`,
    ).run(tenantId, next + 1);
    return `EMP-${String(next).padStart(4, "0")}`;
  },

  currentRateRow(employeeId, tenantId, effectiveDate = today()) {
    return this.db
      .prepare(
        `SELECT * FROM employee_rates
         WHERE tenant_id = ? AND employee_id = ? AND effective_date <= ?
         ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
      )
      .get(tenantId, employeeId, effectiveDate);
  },

  employeeRecord(actor, employeeId, { includeInactive = true, includePay = false } = {}) {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE id = ? AND tenant_id = ?")
      .get(employeeId, actor.tenant_id);
    if (!row || (!includeInactive && !row.active)) throw error("employee_not_found", 404);
    if (!includePay) return row;
    const rate = this.currentRateRow(row.id, actor.tenant_id, today());
    return { ...row, current_rate_cents: rate?.hourly_rate_cents ?? null, current_rate_effective_date: rate?.effective_date ?? null };
  },

  listEmployees(actor) {
    this.requireRole(actor, MANAGER_ROLES);
    const includePay = this.canManagePay(actor);
    return this.db
      .prepare(
        `SELECT e.*,
                (SELECT hourly_rate_cents FROM employee_rates r WHERE r.tenant_id = e.tenant_id AND r.employee_id = e.id AND r.effective_date <= ? ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) AS current_rate_cents,
                (SELECT effective_date FROM employee_rates r WHERE r.tenant_id = e.tenant_id AND r.employee_id = e.id AND r.effective_date <= ? ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) AS current_rate_effective_date
         FROM employees e WHERE e.tenant_id = ? ORDER BY e.active DESC, e.name, e.id`,
      )
      .all(today(), today(), actor.tenant_id)
      .map((row) => mapEmployee(row, { includePay }));
  },

  listPayrollEmployees(actor) {
    this.requirePayManagement(actor);
    return this.db
      .prepare(
        `SELECT id, employee_number, name, active
         FROM employees
         WHERE tenant_id = ?
         ORDER BY active DESC, name, id`,
      )
      .all(actor.tenant_id)
      .map((row) => ({
        id: row.id,
        employee_number: row.employee_number,
        name: row.name,
        active: Boolean(row.active),
      }));
  },

  createEmployee(actor, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const input = employeeSchema.parse(payload);
    const user = this.db.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ?").get(input.user_id, actor.tenant_id);
    if (!user) throw error("employee_user_tenant_mismatch", 400);
    const duplicate = this.db.prepare("SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1").get(actor.tenant_id, input.user_id);
    if (duplicate && input.active !== false) throw error("employee_user_already_linked", 409);
    if (input.pay_management_enabled && actor.role !== "owner") throw error("pay_permission_required", 403);
    const id = randomUUID();
    const timestamp = now();
    return this.transaction(() => {
      const employeeNumber = this.nextEmployeeNumber(actor.tenant_id);
      this.db.prepare(
        `INSERT INTO employees
         (id, portable_id, tenant_id, user_id, employee_number, name, email, phone, role, portal_access_enabled, pay_management_enabled, active, hire_date, internal_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        portable("employee"),
        actor.tenant_id,
        input.user_id,
        employeeNumber,
        input.name,
        normalizedEmail(input.email),
        input.phone ?? null,
        input.role,
        bool(input.portal_access_enabled),
        bool(input.pay_management_enabled),
        bool(input.active),
        input.hire_date ?? null,
        input.internal_note ?? null,
        timestamp,
        timestamp,
      );
      if (input.hourly_rate_cents !== undefined) {
        this.addEmployeeRate(actor, id, {
          hourly_rate_cents: input.hourly_rate_cents,
          effective_date: input.rate_effective_date || input.hire_date || today(),
          note: "Initial employee rate",
        });
      }
      const employee = this.employeeRecord(actor, id, { includePay: true });
      this.audit(actor, "employee.create", "employee", id, employee.portable_id, `Employee ${employee.name} created`, { user_id: input.user_id, active: input.active });
      return mapEmployee(employee, { includePay: true });
    });
  },

  updateEmployee(actor, employeeId, payload) {
    this.requireRole(actor, ADMIN_ROLES);
    const existing = this.employeeRecord(actor, employeeId);
    const input = employeeUpdateSchema.parse(payload);
    if (input.pay_management_enabled !== undefined && actor.role !== "owner") throw error("pay_permission_required", 403);
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === "boolean" ? bool(value) : key === "email" ? normalizedEmail(value) : value);
    }
    if (!fields.length) throw error("no_updates");
    fields.push("updated_at = ?");
    values.push(now(), employeeId, actor.tenant_id);
    this.db.prepare(`UPDATE employees SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
    const updated = this.employeeRecord(actor, employeeId, { includePay: true });
    this.audit(actor, "employee.update", "employee", employeeId, updated.portable_id, `Employee ${updated.name} updated`, { before: { active: Boolean(existing.active), portal_access_enabled: Boolean(existing.portal_access_enabled) }, after: input });
    return mapEmployee(updated, { includePay: this.canManagePay(actor) });
  },

  addEmployeeRate(actor, employeeId, payload) {
    this.requirePayManagement(actor);
    const employee = this.employeeRecord(actor, employeeId);
    const input = employeeRateSchema.parse(payload);
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(
      `INSERT INTO employee_rates (id, tenant_id, employee_id, effective_date, hourly_rate_cents, note, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, actor.tenant_id, employeeId, input.effective_date, input.hourly_rate_cents, input.note ?? null, actor.id, timestamp);
    this.audit(actor, "employee.rate_create", "employee", employeeId, employee.portable_id, `Employee rate effective ${input.effective_date}`, { hourly_rate_cents: input.hourly_rate_cents, effective_date: input.effective_date });
    return this.employeeRates(actor, employeeId);
  },

  employeeRates(actor, employeeId) {
    this.requirePayManagement(actor);
    this.employeeRecord(actor, employeeId);
    return this.db.prepare("SELECT * FROM employee_rates WHERE tenant_id = ? AND employee_id = ? ORDER BY effective_date DESC, created_at DESC").all(actor.tenant_id, employeeId);
  },

  rateForInstant(actor, employeeId, instant) {
    const effectiveDate = localDateForInstant(instant, this.tenantTimezone(actor));
    const rate = this.currentRateRow(employeeId, actor.tenant_id, effectiveDate);
    if (!rate) throw error("employee_rate_missing", 400);
    return rate;
  }
};
