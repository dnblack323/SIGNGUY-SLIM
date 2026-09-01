import {
  ADMIN_ROLES,
  MANAGER_ROLES,
  error
} from "./shared.js";

export const employeeCapabilityMethods = {
  activeEmployeeForActor(actor) {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1")
      .get(actor.tenant_id, actor.id);
    if (!row) throw error("employee_inactive", 403);
    if (!row.portal_access_enabled) throw error("employee_portal_disabled", 403);
    return row;
  },

  employeePortalRecordForActor(actor) {
    if (!actor?.active) return null;
    return this.db
      .prepare(
        `SELECT e.id
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, actor.id) || null;
  },

  activeEmployeeForUser(actor, userId) {
    const row = this.db
      .prepare(
        `SELECT e.*, u.display_name, u.email AS user_email, u.role AS user_role
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, userId);
    if (!row) throw error("message_recipient_invalid", 400);
    return row;
  },

  canManagePay(actor) {
    if (actor?.role === "owner") return true;
    const row = this.db
      .prepare("SELECT pay_management_enabled FROM employees WHERE tenant_id = ? AND user_id = ? AND active = 1 AND portal_access_enabled = 1 LIMIT 1")
      .get(actor.tenant_id, actor.id);
    return Boolean(row?.pay_management_enabled);
  },

  requirePayManagement(actor) {
    if (!actor?.active || !this.canManagePay(actor)) throw error("pay_permission_required", 403);
  },

  capabilitiesForActor(actor) {
    const active = Boolean(actor?.active);
    return {
      can_manage_employees: active && MANAGER_ROLES.has(actor.role),
      can_review_time: active && MANAGER_ROLES.has(actor.role),
      can_manage_pay: active && this.canManagePay(actor),
      can_use_employee_portal: Boolean(this.employeePortalRecordForActor(actor)),
      can_manage_announcements: active && ADMIN_ROLES.has(actor.role),
    };
  }
};
