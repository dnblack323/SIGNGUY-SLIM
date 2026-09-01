import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  CALENDAR_ENTRY_TYPES,
  CALENDAR_FEED_TYPES,
  CALENDAR_STATUSES,
  LINKED_RECORD_TYPES,
  MANAGER_ROLES,
  SCHEDULE_CATEGORIES,
  WRITE_ROLES,
  activeProductionWorkOrderCompletionPredicate,
  addDays,
  bool,
  calendarEventSchema,
  dateOnly,
  departmentSchema,
  error,
  inflateBool,
  listParam,
  mapCalendarEvent,
  mapDepartment,
  mapResource,
  mapScheduleView,
  normalizeTimedDateTime,
  now,
  portable,
  randomUUID,
  resourceSchema,
  scheduleViewFiltersSchema,
  scheduleViewSchema,
  todayInTimeZone,
} = shared;

class CalendarDomainMethods {
  ensureSchedulingDefaults(actor) {
    const timestamp = now();
    const departments = [
      ["Production", "Production scheduling", "#7B3DA6", 10],
      ["Installation", "Installation scheduling", "#3F7FC4", 20],
      ["Sales", "Sales scheduling", "#E06F00", 30],
      ["Office/Administration", "Office and administration scheduling", "#a7b2c3", 40],
    ];
    for (const [name, description, color, displayOrder] of departments) {
      const exists = this.db.prepare("SELECT id FROM schedule_departments WHERE tenant_id = ? AND name = ?").get(actor.tenant_id, name);
      if (!exists) {
        this.db.prepare(
          `INSERT INTO schedule_departments
           (id, tenant_id, name, description, color, active, display_order, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        ).run(randomUUID(), actor.tenant_id, name, description, color, displayOrder, actor.id || null, timestamp, timestamp);
      }
    }
    const views = [
      ["All Shop Schedules", "All permitted shop schedule entries", "#75638F", "all_shop", 10, { entry_types: ["event", "task", "appointment"], schedule_categories: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Production Schedule", "Production schedule entries", "#7B3DA6", "production", 20, { schedule_categories: ["production"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Installation Schedule", "Installation schedule entries", "#3F7FC4", "installation", 30, { schedule_categories: ["installation"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Sales Schedule", "Sales schedule entries", "#E06F00", "sales", 40, { schedule_categories: ["sales"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Customer Appointments", "Customer-facing appointments", "#E06F00", "customer_appointments", 50, { schedule_categories: ["customer_appointment", "site_survey"], entry_types: ["appointment"], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
      ["Pickup & Delivery Schedule", "Pickup and delivery schedule entries", "#b591cc", "pickup_delivery", 60, { schedule_categories: ["pickup", "delivery"], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" }],
    ];
    for (const [name, description, color, systemKey, displayOrder, filters] of views) {
      const exists = this.db.prepare("SELECT id FROM schedule_views WHERE tenant_id = ? AND system_key = ?").get(actor.tenant_id, systemKey);
      if (!exists) {
        this.db.prepare(
          `INSERT INTO schedule_views
           (id, tenant_id, owner_user_id, name, description, color, visibility, system_key, active, display_order, filters_json, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, 'shared', ?, 1, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), actor.tenant_id, name, description, color, systemKey, displayOrder, JSON.stringify(filters), actor.id || null, timestamp, timestamp);
      }
    }
  }

  department(actor, id) {
    const row = this.db.prepare("SELECT * FROM schedule_departments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("department_not_found", 404);
    const memberships = this.db
      .prepare(
        `SELECT dm.*, u.display_name, u.email, u.role, u.active AS user_active
         FROM department_memberships dm
         JOIN users u ON u.id = dm.user_id AND u.tenant_id = dm.tenant_id
         WHERE dm.department_id = ? AND dm.tenant_id = ?
         ORDER BY dm.primary_department DESC, u.display_name`,
      )
      .all(id, actor.tenant_id)
      .map((membership) => inflateBool({
        id: membership.id,
        user_id: membership.user_id,
        display_name: membership.display_name,
        email: membership.email,
        role: membership.role,
        user_active: membership.user_active,
        primary_department: membership.primary_department,
        active: membership.active,
      }, ["user_active", "primary_department", "active"]));
    return mapDepartment(row, memberships);
  }

  listDepartments(actor) {
    this.ensureSchedulingDefaults(actor);
    return {
      items: this.db
        .prepare("SELECT * FROM schedule_departments WHERE tenant_id = ? ORDER BY display_order, name")
        .all(actor.tenant_id)
        .map((row) => this.department(actor, row.id)),
      users: this.users(actor).filter((user) => user.active),
    };
  }

  validateDepartmentId(actor, id, { allowInactive = false } = {}) {
    if (!id) return null;
    const row = this.db.prepare("SELECT id, active FROM schedule_departments WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("department_not_found", 404);
    if (!allowInactive && !row.active) throw error("department_inactive", 400);
    return id;
  }

  saveDepartmentMemberships(actor, departmentId, memberships = []) {
    const seen = new Set();
    const timestamp = now();
    for (const membership of memberships) {
      if (seen.has(membership.user_id)) throw error("duplicate_department_membership", 400);
      seen.add(membership.user_id);
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(membership.user_id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
      if (membership.primary_department && membership.active) {
        this.db.prepare(
          "UPDATE department_memberships SET primary_department = 0, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND department_id <> ?",
        ).run(timestamp, actor.tenant_id, membership.user_id, departmentId);
      }
      const existing = this.db.prepare("SELECT id FROM department_memberships WHERE tenant_id = ? AND department_id = ? AND user_id = ?").get(actor.tenant_id, departmentId, membership.user_id);
      if (existing) {
        this.db.prepare("UPDATE department_memberships SET primary_department = ?, active = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(bool(membership.primary_department), bool(membership.active), timestamp, existing.id, actor.tenant_id);
      } else {
        this.db.prepare(
          `INSERT INTO department_memberships (id, tenant_id, department_id, user_id, primary_department, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), actor.tenant_id, departmentId, membership.user_id, bool(membership.primary_department), bool(membership.active), timestamp, timestamp);
      }
    }
    this.db.prepare(`UPDATE department_memberships SET active = 0, updated_at = ? WHERE tenant_id = ? AND department_id = ? AND user_id NOT IN (${memberships.map(() => "?").join(",") || "''"})`).run(timestamp, actor.tenant_id, departmentId, ...memberships.map((membership) => membership.user_id));
  }

  createDepartment(actor, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = departmentSchema.parse(payload);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO schedule_departments
         (id, tenant_id, name, description, color, active, display_order, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, input.name, input.description || null, input.color, bool(input.active), input.display_order ?? 100, actor.id, timestamp, timestamp);
      this.saveDepartmentMemberships(actor, id, input.memberships || []);
      const department = this.department(actor, id);
      this.audit(actor, "schedule.department_create", "schedule_department", id, id, `Department ${input.name} created`, { memberships: department.memberships.length });
      return department;
    });
  }

  updateDepartment(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const existing = this.department(actor, id);
    const input = departmentSchema.parse({ ...existing, ...payload, memberships: payload.memberships ?? existing.memberships });
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare(
        `UPDATE schedule_departments
         SET name = ?, description = ?, color = ?, active = ?, display_order = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(input.name, input.description || null, input.color, bool(input.active), input.display_order ?? existing.display_order, timestamp, id, actor.tenant_id);
      if (payload.memberships) this.saveDepartmentMemberships(actor, id, input.memberships);
      const warnings = this.departmentDeactivateWarnings(actor, id);
      this.audit(actor, "schedule.department_update", "schedule_department", id, id, `Department ${input.name} updated`, { active: input.active, warnings });
      return { ...this.department(actor, id), warnings };
    });
  }

  departmentDeactivateWarnings(actor, id) {
    const future = todayInTimeZone(this.tenantTimezone(actor));
    return {
      active_employees: this.db.prepare("SELECT COUNT(*) AS count FROM department_memberships WHERE tenant_id = ? AND department_id = ? AND active = 1").get(actor.tenant_id, id).count,
      future_entries: this.db.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE tenant_id = ? AND department_id = ? AND start_at >= ? AND status = 'scheduled'").get(actor.tenant_id, id, future).count,
      active_resources: this.db.prepare("SELECT COUNT(*) AS count FROM schedulable_resources WHERE tenant_id = ? AND department_id = ? AND active = 1").get(actor.tenant_id, id).count,
      saved_views: this.db.prepare("SELECT COUNT(*) AS count FROM schedule_views WHERE tenant_id = ? AND active = 1 AND filters_json LIKE ?").get(actor.tenant_id, `%${id}%`).count,
    };
  }

  resource(actor, id) {
    const row = this.db
      .prepare(
        `SELECT r.*, d.name AS department_name
         FROM schedulable_resources r
         LEFT JOIN schedule_departments d ON d.id = r.department_id AND d.tenant_id = r.tenant_id
         WHERE r.id = ? AND r.tenant_id = ?`,
      )
      .get(id, actor.tenant_id);
    if (!row) throw error("resource_not_found", 404);
    const unavailable = this.db.prepare("SELECT * FROM resource_unavailability WHERE tenant_id = ? AND resource_id = ? ORDER BY start_at").all(actor.tenant_id, id).map((entry) => inflateBool(entry, ["hard_block"]));
    return mapResource(row, unavailable);
  }

  listResources(actor) {
    return {
      items: this.db
        .prepare("SELECT id FROM schedulable_resources WHERE tenant_id = ? ORDER BY active DESC, name")
        .all(actor.tenant_id)
        .map((row) => this.resource(actor, row.id)),
      departments: this.listDepartments(actor).items,
    };
  }

  saveResourceUnavailable(actor, resourceId, unavailable = []) {
    const timestamp = now();
    this.db.prepare("DELETE FROM resource_unavailability WHERE tenant_id = ? AND resource_id = ?").run(actor.tenant_id, resourceId);
    for (const entry of unavailable) {
      const range = this.validateCalendarRange({ start_at: entry.start_at, end_at: entry.end_at, all_day: false }, actor);
      this.db.prepare(
        `INSERT INTO resource_unavailability
         (id, tenant_id, resource_id, start_at, end_at, reason, hard_block, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), actor.tenant_id, resourceId, range.start_at, range.end_at, entry.reason || "Unavailable", bool(entry.hard_block), actor.id, timestamp, timestamp);
    }
  }

  createResource(actor, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = resourceSchema.parse(payload);
    if (input.department_id) this.validateDepartmentId(actor, input.department_id);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO schedulable_resources
         (id, tenant_id, department_id, name, resource_type, description, capacity, color, active, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, input.department_id || null, input.name, input.resource_type, input.description || null, input.capacity, input.color, bool(input.active), actor.id, timestamp, timestamp);
      this.saveResourceUnavailable(actor, id, input.unavailable || []);
      this.audit(actor, "schedule.resource_create", "schedulable_resource", id, id, `Resource ${input.name} created`, { resource_type: input.resource_type, capacity: input.capacity });
      return this.resource(actor, id);
    });
  }

  updateResource(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const existing = this.resource(actor, id);
    const input = resourceSchema.parse({ ...existing, ...payload, unavailable: payload.unavailable ?? existing.unavailable });
    if (input.department_id) this.validateDepartmentId(actor, input.department_id, { allowInactive: true });
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare(
        `UPDATE schedulable_resources
         SET department_id = ?, name = ?, resource_type = ?, description = ?, capacity = ?, color = ?, active = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(input.department_id || null, input.name, input.resource_type, input.description || null, input.capacity, input.color, bool(input.active), timestamp, id, actor.tenant_id);
      if (payload.unavailable) this.saveResourceUnavailable(actor, id, input.unavailable);
      this.audit(actor, "schedule.resource_update", "schedulable_resource", id, id, `Resource ${input.name} updated`, { active: input.active, capacity: input.capacity });
      return this.resource(actor, id);
    });
  }

  scheduleView(actor, id) {
    this.ensureSchedulingDefaults(actor);
    const row = this.db.prepare("SELECT * FROM schedule_views WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("schedule_view_not_found", 404);
    if (row.visibility === "personal" && row.owner_user_id !== actor.id) throw error("permission_denied", 403);
    return mapScheduleView(row);
  }

  listScheduleViews(actor) {
    this.ensureSchedulingDefaults(actor);
    const clauses = ["tenant_id = ?", "(visibility = 'shared' OR owner_user_id = ?)"];
    const rows = this.db.prepare(`SELECT * FROM schedule_views WHERE ${clauses.join(" AND ")} ORDER BY visibility, display_order, name`).all(actor.tenant_id, actor.id);
    return { items: rows.map(mapScheduleView), can_manage_shared: MANAGER_ROLES.has(actor.role) };
  }

  validateScheduleViewFilters(actor, filters) {
    const input = scheduleViewFiltersSchema.parse(filters || {});
    for (const id of input.department_ids) this.validateDepartmentId(actor, id, { allowInactive: true });
    for (const id of input.employee_ids) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
    }
    for (const id of input.resource_ids) {
      const resource = this.db.prepare("SELECT id FROM schedulable_resources WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!resource) throw error("resource_not_found", 404);
    }
    return input;
  }

  createScheduleView(actor, payload) {
    const input = scheduleViewSchema.parse(payload);
    if (input.visibility === "shared") this.requireRole(actor, MANAGER_ROLES);
    const filters = this.validateScheduleViewFilters(actor, input.filters);
    return this.transaction(() => {
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        `INSERT INTO schedule_views
         (id, tenant_id, owner_user_id, name, description, color, visibility, system_key, active, display_order, filters_json, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(id, actor.tenant_id, input.visibility === "personal" ? actor.id : null, input.name, input.description || null, input.color, input.visibility, bool(input.active), input.display_order ?? 100, JSON.stringify(filters), actor.id, timestamp, timestamp);
      this.audit(actor, "schedule.view_create", "schedule_view", id, id, `Schedule view ${input.name} created`, { visibility: input.visibility });
      return this.scheduleView(actor, id);
    });
  }

  updateScheduleView(actor, id, payload) {
    const existing = this.scheduleView(actor, id);
    if (existing.visibility === "shared") this.requireRole(actor, MANAGER_ROLES);
    if (existing.visibility === "personal" && existing.owner_user_id !== actor.id) throw error("permission_denied", 403);
    if (existing.system_key && Object.keys(payload).some((key) => key !== "active" || payload.active === false)) throw error("system_view_protected", 400);
    const input = scheduleViewSchema.parse({
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      color: payload.color ?? existing.color,
      visibility: payload.visibility ?? existing.visibility,
      active: payload.active ?? existing.active,
      display_order: payload.display_order ?? existing.display_order,
      filters: payload.filters ?? existing.filters,
    });
    if (input.visibility !== existing.visibility) throw error("invalid_schedule_view_visibility", 400);
    const filters = this.validateScheduleViewFilters(actor, input.filters);
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare(
        `UPDATE schedule_views
         SET name = ?, description = ?, color = ?, active = ?, display_order = ?, filters_json = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      ).run(input.name, input.description || null, input.color, bool(input.active), input.display_order ?? existing.display_order, JSON.stringify(filters), timestamp, id, actor.tenant_id);
      this.audit(actor, "schedule.view_update", "schedule_view", id, id, `Schedule view ${input.name} updated`, { active: input.active });
      return this.scheduleView(actor, id);
    });
  }

  validateCalendarRange(input, actor) {
    if (input.all_day) {
      if (!dateOnly(input.start_at) || !dateOnly(input.end_at)) throw error("invalid_calendar_date", 400);
      if (input.end_at <= input.start_at) throw error("invalid_calendar_range", 400);
      return { start_at: input.start_at, end_at: input.end_at };
    }
    const timezone = this.tenantTimezone(actor);
    const startAt = normalizeTimedDateTime(input.start_at, timezone);
    const endAt = normalizeTimedDateTime(input.end_at, timezone);
    if (endAt <= startAt) throw error("invalid_calendar_range", 400);
    return { start_at: startAt, end_at: endAt };
  }

  validateCalendarLinks(actor, input) {
    const linked = { estimate_id: input.estimate_id || null, order_id: input.order_id || null, order_item_id: input.order_item_id || null, work_order_id: input.work_order_id || null };
    if (linked.estimate_id) {
      const estimate = this.db.prepare("SELECT id FROM estimates WHERE id = ? AND tenant_id = ?").get(linked.estimate_id, actor.tenant_id);
      if (!estimate) throw error("calendar_link_not_found", 404);
    }
    if (linked.order_id) {
      const order = this.db.prepare("SELECT id FROM orders WHERE id = ? AND tenant_id = ?").get(linked.order_id, actor.tenant_id);
      if (!order) throw error("calendar_link_not_found", 404);
    }
    if (linked.order_item_id) {
      const itemRow = this.db.prepare("SELECT id, order_id FROM order_items WHERE id = ? AND tenant_id = ?").get(linked.order_item_id, actor.tenant_id);
      if (!itemRow) throw error("calendar_link_not_found", 404);
      if (linked.order_id && itemRow.order_id !== linked.order_id) throw error("invalid_calendar_link", 400);
      linked.order_id = linked.order_id || itemRow.order_id;
    }
    if (linked.work_order_id) {
      const workOrder = this.db.prepare("SELECT id, order_id FROM work_orders WHERE id = ? AND tenant_id = ? AND status = 'active'").get(linked.work_order_id, actor.tenant_id);
      if (!workOrder) throw error("calendar_link_not_found", 404);
      if (linked.order_id && workOrder.order_id !== linked.order_id) throw error("invalid_calendar_link", 400);
      linked.order_id = linked.order_id || workOrder.order_id;
      if (linked.order_item_id) {
        const member = this.db.prepare("SELECT id FROM work_order_items WHERE tenant_id = ? AND work_order_id = ? AND order_item_id = ? AND active = 1").get(actor.tenant_id, linked.work_order_id, linked.order_item_id);
        if (!member) throw error("invalid_calendar_link", 400);
      }
    }
    if (input.assigned_user_id) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(input.assigned_user_id, actor.tenant_id);
      if (!user) throw error("calendar_assigned_user_not_found", 404);
    }
    return linked;
  }

  normalizeCalendarAssignees(actor, input) {
    const ids = new Set([...(input.assignee_user_ids || []), input.assigned_user_id, input.primary_assignee_user_id].filter(Boolean));
    const assigneeIds = [...ids];
    for (const id of assigneeIds) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(id, actor.tenant_id);
      if (!user) throw error("calendar_assigned_user_not_found", 404);
    }
    const primary = input.primary_assignee_user_id || input.assigned_user_id || assigneeIds[0] || null;
    return { assigneeIds, primary };
  }

  validateCalendarResources(actor, reservations = []) {
    const seen = new Set();
    return reservations.map((reservation) => {
      if (seen.has(reservation.resource_id)) throw error("duplicate_resource_reservation", 400);
      seen.add(reservation.resource_id);
      const resource = this.db.prepare("SELECT id, name, capacity, active FROM schedulable_resources WHERE id = ? AND tenant_id = ?").get(reservation.resource_id, actor.tenant_id);
      if (!resource) throw error("resource_not_found", 404);
      if (!resource.active) throw error("resource_inactive", 400);
      if (reservation.quantity > resource.capacity) throw error("resource_capacity_exceeded", 400);
      return { ...reservation, resource };
    });
  }

  validateCalendarFilterReferences(actor, filters) {
    for (const category of filters.schedule_categories || []) {
      if (!SCHEDULE_CATEGORIES.includes(category)) throw error("invalid_calendar_filter", 400);
    }
    for (const id of filters.department_ids || []) this.validateDepartmentId(actor, id, { allowInactive: true });
    for (const id of filters.resource_ids || []) {
      const resource = this.db.prepare("SELECT id FROM schedulable_resources WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!resource) throw error("resource_not_found", 404);
    }
    for (const id of filters.employee_ids || []) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
      if (!MANAGER_ROLES.has(actor.role) && id !== actor.id) throw error("permission_denied", 403);
    }
    if (filters.assigned_user_id && !["all", "unassigned"].includes(filters.assigned_user_id)) {
      const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?").get(filters.assigned_user_id, actor.tenant_id);
      if (!user) throw error("user_not_found", 404);
      if (!MANAGER_ROLES.has(actor.role) && filters.assigned_user_id !== actor.id) throw error("permission_denied", 403);
    }
    if (filters.estimate_id) {
      const estimate = this.db.prepare("SELECT id FROM estimates WHERE id = ? AND tenant_id = ?").get(filters.estimate_id, actor.tenant_id);
      if (!estimate) throw error("calendar_link_not_found", 404);
    }
    if (filters.order_id) {
      const order = this.db.prepare("SELECT id FROM orders WHERE id = ? AND tenant_id = ?").get(filters.order_id, actor.tenant_id);
      if (!order) throw error("calendar_link_not_found", 404);
    }
    if (filters.order_item_id) {
      const item = this.db.prepare("SELECT id FROM order_items WHERE id = ? AND tenant_id = ?").get(filters.order_item_id, actor.tenant_id);
      if (!item) throw error("calendar_link_not_found", 404);
    }
    if (filters.work_order_id) {
      const workOrder = this.db.prepare("SELECT id FROM work_orders WHERE id = ? AND tenant_id = ?").get(filters.work_order_id, actor.tenant_id);
      if (!workOrder) throw error("calendar_link_not_found", 404);
    }
  }

  calendarScheduleDetails(actor, id) {
    const assignees = this.db
      .prepare(
        `SELECT cea.user_id, cea.primary_assignee, u.display_name, u.email, u.role
         FROM calendar_event_assignees cea
         JOIN users u ON u.id = cea.user_id AND u.tenant_id = cea.tenant_id
         WHERE cea.tenant_id = ? AND cea.calendar_event_id = ?
         ORDER BY cea.primary_assignee DESC, u.display_name`,
      )
      .all(actor.tenant_id, id)
      .map((row) => inflateBool(row, ["primary_assignee"]));
    const resources = this.db
      .prepare(
        `SELECT cer.resource_id, cer.quantity, r.name, r.resource_type, r.color, r.capacity
         FROM calendar_event_resource_reservations cer
         JOIN schedulable_resources r ON r.id = cer.resource_id AND r.tenant_id = cer.tenant_id
         WHERE cer.tenant_id = ? AND cer.calendar_event_id = ?
         ORDER BY r.name`,
      )
      .all(actor.tenant_id, id);
    return { assignees, resource_reservations: resources };
  }

  attachCalendarScheduleDetails(actor, event) {
    if (!event || event.derived) return event;
    const details = this.calendarScheduleDetails(actor, event.id);
    if (!details.assignees.length && event.assigned_user_id) {
      details.assignees.push({ user_id: event.assigned_user_id, primary_assignee: true, display_name: event.assigned_user_name });
    }
    return { ...event, ...details };
  }

  writeCalendarAssignees(actor, eventId, assignees) {
    const timestamp = now();
    this.db.prepare("DELETE FROM calendar_event_assignees WHERE tenant_id = ? AND calendar_event_id = ?").run(actor.tenant_id, eventId);
    for (const userId of assignees.assigneeIds) {
      this.db.prepare(
        `INSERT INTO calendar_event_assignees (id, tenant_id, calendar_event_id, user_id, primary_assignee, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), actor.tenant_id, eventId, userId, bool(userId === assignees.primary), timestamp);
    }
  }

  writeCalendarResources(actor, eventId, reservations = []) {
    const timestamp = now();
    this.db.prepare("DELETE FROM calendar_event_resource_reservations WHERE tenant_id = ? AND calendar_event_id = ?").run(actor.tenant_id, eventId);
    for (const reservation of reservations) {
      this.db.prepare(
        `INSERT INTO calendar_event_resource_reservations (id, tenant_id, calendar_event_id, resource_id, quantity, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), actor.tenant_id, eventId, reservation.resource_id, reservation.quantity || 1, timestamp);
    }
  }

  checkCalendarConflicts(actor, { id = null, range, assigneeIds = [], reservations = [] }) {
    const conflicts = [];
    for (const userId of assigneeIds) {
      const rows = this.db
        .prepare(
          `SELECT ce.id, ce.title, ce.start_at, ce.end_at, u.display_name
           FROM calendar_events ce
           JOIN calendar_event_assignees cea ON cea.calendar_event_id = ce.id AND cea.tenant_id = ce.tenant_id
           JOIN users u ON u.id = cea.user_id AND u.tenant_id = cea.tenant_id
           WHERE ce.tenant_id = ? AND cea.user_id = ? AND ce.status = 'scheduled' AND ce.id <> ? AND ce.start_at < ? AND ce.end_at > ?`,
        )
        .all(actor.tenant_id, userId, id || "", range.end_at, range.start_at);
      for (const row of rows) {
        conflicts.push({ type: "employee", user_id: userId, name: row.display_name, conflicting_entry_id: row.id, conflicting_title: row.title, start_at: row.start_at, end_at: row.end_at, reason: "employee_already_assigned", override_permitted: MANAGER_ROLES.has(actor.role) });
      }
    }
    for (const reservation of reservations) {
      const unavailable = this.db
        .prepare(
          `SELECT ru.*, r.name
           FROM resource_unavailability ru
           JOIN schedulable_resources r ON r.id = ru.resource_id AND r.tenant_id = ru.tenant_id
           WHERE ru.tenant_id = ? AND ru.resource_id = ? AND ru.start_at < ? AND ru.end_at > ?`,
        )
        .all(actor.tenant_id, reservation.resource_id, range.end_at, range.start_at);
      for (const row of unavailable) {
        conflicts.push({ type: "resource", resource_id: reservation.resource_id, name: row.name, conflicting_entry_id: null, start_at: row.start_at, end_at: row.end_at, reason: row.reason || "resource_unavailable", override_permitted: MANAGER_ROLES.has(actor.role), hard_block: Boolean(row.hard_block) });
      }
      const usage = this.db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN ce.id IS NOT NULL THEN cer.quantity ELSE 0 END), 0) AS quantity, r.capacity, r.name
           FROM schedulable_resources r
           LEFT JOIN calendar_event_resource_reservations cer ON cer.resource_id = r.id AND cer.tenant_id = r.tenant_id
           LEFT JOIN calendar_events ce ON ce.id = cer.calendar_event_id AND ce.tenant_id = cer.tenant_id AND ce.status = 'scheduled' AND ce.id <> ? AND ce.start_at < ? AND ce.end_at > ?
           WHERE r.id = ? AND r.tenant_id = ?
           GROUP BY r.id`,
        )
        .get(id || "", range.end_at, range.start_at, reservation.resource_id, actor.tenant_id);
      if (usage && Number(usage.quantity || 0) + reservation.quantity > usage.capacity) {
        conflicts.push({ type: "resource", resource_id: reservation.resource_id, name: usage.name, conflicting_entry_id: null, start_at: range.start_at, end_at: range.end_at, reason: "resource_capacity_exceeded", override_permitted: MANAGER_ROLES.has(actor.role), hard_block: true });
      }
    }
    return conflicts;
  }

  enforceCalendarConflicts(actor, input, range, assignees, resources, existingId = null) {
    const conflicts = this.checkCalendarConflicts(actor, { id: existingId, range, assigneeIds: assignees.assigneeIds, reservations: resources });
    if (!conflicts.length) return [];
    if (!input.conflict_override) {
      const err = error("schedule_conflict", 409);
      err.conflicts = conflicts;
      throw err;
    }
    if (!MANAGER_ROLES.has(actor.role)) throw error("permission_denied", 403);
    const reason = String(input.conflict_override_reason || "").trim();
    if (reason.length < 5) throw error("conflict_override_reason_required", 400);
    return { conflicts, reason };
  }

  applyScheduleViewFilters(actor, filters) {
    this.ensureSchedulingDefaults(actor);
    const next = { ...filters };
    if (next.view_id) {
      const view = this.scheduleView(actor, next.view_id);
      Object.assign(next, {
        schedule_categories: view.filters.schedule_categories,
        entry_types: view.filters.entry_types,
        department_ids: view.filters.department_ids,
        employee_ids: view.filters.employee_ids,
        resource_ids: view.filters.resource_ids,
        statuses: view.filters.statuses,
        linked_state: view.filters.linked,
        selected_view: view,
      });
    }
    if (next.my_schedule === "1" || next.my_schedule === "true" || next.my_schedule === true) {
      next.my_schedule = true;
      next.selected_view = { id: "my_schedule", name: "My Schedule", color: "#255b73", filters: {} };
    }
    next.schedule_categories = listParam(next.schedule_categories || next.schedule_category);
    next.entry_types = listParam(next.entry_types || next.entry_type).filter((type) => type !== "all");
    next.department_ids = listParam(next.department_ids || next.department_id);
    next.employee_ids = listParam(next.employee_ids || next.employee_id || next.assigned_user_id).filter((id) => id !== "unassigned");
    next.resource_ids = listParam(next.resource_ids || next.resource_id);
    next.statuses = listParam(next.statuses || next.status).filter((status) => status !== "all");
    return next;
  }

  calendarEvent(actor, id) {
    const tenant = this.tenant(actor.tenant_id);
    const row = this.db
      .prepare(
        `SELECT ce.*, d.name AS department_name, d.color AS department_color, e.estimate_number,
                o.order_number, o.title AS order_title, oi.title AS item_title, oi.description AS item_description,
                wo.title AS work_order_title, wo.work_order_number, u.display_name AS assigned_user_name
         FROM calendar_events ce
         LEFT JOIN schedule_departments d ON d.id = ce.department_id AND d.tenant_id = ce.tenant_id
         LEFT JOIN estimates e ON e.id = ce.estimate_id AND e.tenant_id = ce.tenant_id
         LEFT JOIN orders o ON o.id = ce.order_id AND o.tenant_id = ce.tenant_id
         LEFT JOIN order_items oi ON oi.id = ce.order_item_id AND oi.tenant_id = ce.tenant_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id AND wo.tenant_id = ce.tenant_id
         LEFT JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
         WHERE ce.id = ? AND ce.tenant_id = ?`,
      )
      .get(id, actor.tenant_id);
    if (!row) throw error("calendar_event_not_found", 404);
    return this.attachCalendarScheduleDetails(actor, mapCalendarEvent(row, tenant));
  }

  listCalendarEvents(actor, filters = {}) {
    filters = this.applyScheduleViewFilters(actor, filters);
    const tenant = this.tenant(actor.tenant_id);
    const start = filters.start_at || filters.start || addDays(todayInTimeZone(tenant.shop_timezone), -31);
    const end = filters.end_at || filters.end || addDays(todayInTimeZone(tenant.shop_timezone), 62);
    if (!String(start).trim() || !String(end).trim() || String(end) <= String(start)) throw error("invalid_calendar_range", 400);
    if (filters.status && filters.status !== "all" && !CALENDAR_STATUSES.includes(filters.status)) throw error("invalid_calendar_status", 400);
    for (const status of filters.statuses || []) if (!CALENDAR_STATUSES.includes(status)) throw error("invalid_calendar_status", 400);
    if (filters.entry_type && filters.entry_type !== "all" && !CALENDAR_FEED_TYPES.includes(filters.entry_type)) throw error("invalid_calendar_filter", 400);
    for (const type of filters.entry_types || []) if (!CALENDAR_FEED_TYPES.includes(type)) throw error("invalid_calendar_filter", 400);
    if (filters.linked_record_type && !LINKED_RECORD_TYPES.includes(filters.linked_record_type)) throw error("invalid_calendar_filter", 400);
    this.validateCalendarFilterReferences(actor, filters);
    const clauses = ["ce.tenant_id = ?", "ce.start_at < ?", "ce.end_at > ?"];
    const values = [actor.tenant_id, end, start];
    if (filters.status && filters.status !== "all") {
      clauses.push("ce.status = ?");
      values.push(filters.status);
    }
    if (filters.statuses?.length) {
      clauses.push(`ce.status IN (${filters.statuses.map(() => "?").join(",")})`);
      values.push(...filters.statuses);
    }
    if (filters.entry_type && filters.entry_type !== "all" && CALENDAR_ENTRY_TYPES.includes(filters.entry_type)) {
      clauses.push("ce.entry_type = ?");
      values.push(filters.entry_type);
    }
    if (filters.entry_types?.length && filters.entry_types.every((type) => CALENDAR_ENTRY_TYPES.includes(type))) {
      clauses.push(`ce.entry_type IN (${filters.entry_types.map(() => "?").join(",")})`);
      values.push(...filters.entry_types);
    } else if (filters.entry_types?.some((type) => ["production", "deadline"].includes(type)) && !filters.entry_types.some((type) => CALENDAR_ENTRY_TYPES.includes(type))) {
      clauses.push("1 = 0");
    }
    if (["production", "deadline"].includes(filters.entry_type)) clauses.push("1 = 0");
    if (filters.schedule_categories?.length) {
      clauses.push(`ce.schedule_category IN (${filters.schedule_categories.map(() => "?").join(",")})`);
      values.push(...filters.schedule_categories);
    }
    if (filters.department_ids?.length) {
      clauses.push(`ce.department_id IN (${filters.department_ids.map(() => "?").join(",")})`);
      values.push(...filters.department_ids);
    }
    if (filters.assigned_user_id && filters.assigned_user_id !== "all") {
      if (filters.assigned_user_id === "unassigned") clauses.push("ce.assigned_user_id IS NULL");
      else {
        clauses.push("(ce.assigned_user_id = ? OR EXISTS (SELECT 1 FROM calendar_event_assignees cea_filter WHERE cea_filter.calendar_event_id = ce.id AND cea_filter.tenant_id = ce.tenant_id AND cea_filter.user_id = ?))");
        values.push(filters.assigned_user_id);
        values.push(filters.assigned_user_id);
      }
    }
    if (filters.employee_ids?.length) {
      clauses.push(`EXISTS (SELECT 1 FROM calendar_event_assignees cea_employee WHERE cea_employee.calendar_event_id = ce.id AND cea_employee.tenant_id = ce.tenant_id AND cea_employee.user_id IN (${filters.employee_ids.map(() => "?").join(",")}))`);
      values.push(...filters.employee_ids);
    }
    if (filters.resource_ids?.length) {
      clauses.push(`EXISTS (SELECT 1 FROM calendar_event_resource_reservations cer_filter WHERE cer_filter.calendar_event_id = ce.id AND cer_filter.tenant_id = ce.tenant_id AND cer_filter.resource_id IN (${filters.resource_ids.map(() => "?").join(",")}))`);
      values.push(...filters.resource_ids);
    }
    if (filters.my_schedule) {
      clauses.push(`(
        EXISTS (SELECT 1 FROM calendar_event_assignees cea_me WHERE cea_me.calendar_event_id = ce.id AND cea_me.tenant_id = ce.tenant_id AND cea_me.user_id = ?)
        OR ce.assigned_user_id = ?
        OR EXISTS (
          SELECT 1 FROM department_memberships dm_me
          WHERE dm_me.tenant_id = ce.tenant_id AND dm_me.department_id = ce.department_id AND dm_me.user_id = ? AND dm_me.active = 1
        )
      )`);
      values.push(actor.id, actor.id, actor.id);
    }
    if (filters.order_id) {
      clauses.push("ce.order_id = ?");
      values.push(filters.order_id);
    }
    if (filters.order_item_id) {
      clauses.push("ce.order_item_id = ?");
      values.push(filters.order_item_id);
    }
    if (filters.work_order_id) {
      clauses.push("ce.work_order_id = ?");
      values.push(filters.work_order_id);
    }
    if (filters.estimate_id) {
      clauses.push("ce.estimate_id = ?");
      values.push(filters.estimate_id);
    }
    if (filters.linked_record_type === "none") clauses.push("ce.estimate_id IS NULL AND ce.order_id IS NULL AND ce.order_item_id IS NULL AND ce.work_order_id IS NULL");
    if (filters.linked_record_type === "estimate") clauses.push("ce.estimate_id IS NOT NULL");
    if (filters.linked_record_type === "order") clauses.push("ce.order_id IS NOT NULL AND ce.order_item_id IS NULL");
    if (filters.linked_record_type === "order_item") clauses.push("ce.order_item_id IS NOT NULL");
    if (filters.linked_record_type === "work_order") clauses.push("ce.work_order_id IS NOT NULL");
    if (filters.linked_state === "linked") clauses.push("(ce.estimate_id IS NOT NULL OR ce.order_id IS NOT NULL OR ce.order_item_id IS NOT NULL OR ce.work_order_id IS NOT NULL)");
    if (filters.linked_state === "unlinked") clauses.push("ce.estimate_id IS NULL AND ce.order_id IS NULL AND ce.order_item_id IS NULL AND ce.work_order_id IS NULL");
    const rows = this.db
      .prepare(
        `SELECT ce.*, d.name AS department_name, d.color AS department_color, e.estimate_number,
                o.order_number, o.title AS order_title, oi.title AS item_title, oi.description AS item_description,
                wo.title AS work_order_title, wo.work_order_number, u.display_name AS assigned_user_name
         FROM calendar_events ce
         LEFT JOIN schedule_departments d ON d.id = ce.department_id AND d.tenant_id = ce.tenant_id
         LEFT JOIN estimates e ON e.id = ce.estimate_id AND e.tenant_id = ce.tenant_id
         LEFT JOIN orders o ON o.id = ce.order_id AND o.tenant_id = ce.tenant_id
         LEFT JOIN order_items oi ON oi.id = ce.order_item_id AND oi.tenant_id = ce.tenant_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id AND wo.tenant_id = ce.tenant_id
         LEFT JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY ce.start_at, ce.title`,
      )
      .all(...values)
      .map((row) => this.attachCalendarScheduleDetails(actor, mapCalendarEvent(row, tenant)));
    const derived = this.derivedCalendarEntries(actor, { ...filters, start_at: start, end_at: end }, tenant);
    return {
      items: [...rows, ...derived].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)) || String(a.title).localeCompare(String(b.title))),
      users: this.users(actor).filter((user) => user.active),
      departments: this.listDepartments(actor).items,
      resources: this.listResources(actor).items,
      views: this.listScheduleViews(actor).items.filter((view) => view.active),
      selected_view: filters.selected_view || null,
      can_manage_schedule: MANAGER_ROLES.has(actor.role),
      timezone: tenant.shop_timezone,
    };
  }

  derivedCalendarEntries(actor, filters, tenant) {
    if (filters.status && !["all", "scheduled"].includes(filters.status)) return [];
    const start = filters.start_at;
    const end = filters.end_at;
    const linked = filters.linked_record_type || "all";
    const type = filters.entry_type || "all";
    const assigned = filters.assigned_user_id || "all";
    const entryTypes = filters.entry_types || [];
    const includeDeadline = ["all", "deadline"].includes(type) && (!entryTypes.length || entryTypes.includes("deadline"));
    const includeProduction = ["all", "production"].includes(type) && (!entryTypes.length || entryTypes.includes("production"));
    const rows = [];
    const matchesLinked = (recordType) => linked === "all" || linked === recordType;
    const matchesDate = (date) => date && date >= start && date < end;
    const matchesCategory = (category) => !filters.schedule_categories?.length || filters.schedule_categories.includes(category);
    const base = (overrides) => mapCalendarEvent({
      portable_id: null,
      tenant_id: actor.tenant_id,
      end_at: addDays(overrides.start_at, 1),
      all_day: 1,
      assigned_user_id: null,
      status: "scheduled",
      internal_note: null,
      created_by_user_id: null,
      created_at: null,
      updated_at: null,
      assigned_user_name: null,
      source_type: overrides.source_type,
      entry_type: overrides.source_type,
      derived: true,
      ...overrides,
    }, tenant);

    if (includeDeadline && matchesCategory("deadline") && matchesLinked("order") && assigned === "all" && !filters.order_item_id && !filters.estimate_id) {
      const orderRows = this.db
        .prepare(
          `SELECT o.id, o.order_number, o.due_date, c.contact_name, c.business_name
           FROM orders o
           JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
           WHERE o.tenant_id = ? AND o.due_date IS NOT NULL AND o.status NOT IN ('complete', 'cancelled')`,
        )
        .all(actor.tenant_id);
      for (const row of orderRows.filter((row) => matchesDate(row.due_date) && (!filters.order_id || filters.order_id === row.id))) {
        rows.push(base({
          id: `derived-order-due-${row.id}`,
          source_type: "deadline",
          title: `Order due: ${row.order_number}`,
          start_at: row.due_date,
          order_id: row.id,
          order_item_id: null,
          order_number: row.order_number,
          customer_name: row.business_name || row.contact_name,
        }));
      }
    }

    if ((includeDeadline || includeProduction) && matchesLinked("order_item") && !filters.estimate_id) {
      const completedPredicate = activeProductionWorkOrderCompletionPredicate("oi");
      const itemRows = this.db
        .prepare(
          `SELECT oi.id, oi.order_id, oi.description, oi.due_date, oi.assigned_user_id, oi.production_required,
                  CASE
                    WHEN oi.production_required = 0 THEN 0
                    WHEN ${completedPredicate} THEN 1
                    ELSE 0
                  END AS derived_completed,
                  o.order_number, u.display_name AS assigned_user_name
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
           LEFT JOIN users u ON u.id = oi.assigned_user_id AND u.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = ? AND oi.due_date IS NOT NULL AND o.status NOT IN ('complete', 'cancelled')`,
        )
        .all(actor.tenant_id);
      for (const row of itemRows) {
        if (!matchesDate(row.due_date)) continue;
        if (filters.order_id && filters.order_id !== row.order_id) continue;
        if (filters.order_item_id && filters.order_item_id !== row.id) continue;
        if (assigned === "unassigned" && row.assigned_user_id) continue;
        if (assigned !== "all" && assigned !== "unassigned" && assigned !== row.assigned_user_id) continue;
        const sourceType = row.production_required && !row.derived_completed ? "production" : "deadline";
        if ((sourceType === "production" && !includeProduction) || (sourceType === "deadline" && !includeDeadline)) continue;
        if (!matchesCategory(sourceType)) continue;
        rows.push(base({
          id: `derived-item-${sourceType}-${row.id}`,
          source_type: sourceType,
          title: `${sourceType === "production" ? "Production due" : "Item due"}: ${row.description}`,
          start_at: row.due_date,
          order_id: row.order_id,
          order_item_id: row.id,
          order_number: row.order_number,
          item_description: row.description,
          assigned_user_id: row.assigned_user_id,
          assigned_user_name: row.assigned_user_name,
        }));
      }
    }

    return rows;
  }

  createCalendarEvent(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = calendarEventSchema.parse(payload);
    const departmentId = this.validateDepartmentId(actor, input.department_id);
    const linked = this.validateCalendarLinks(actor, input);
    const range = this.validateCalendarRange(input, actor);
    const assignees = this.normalizeCalendarAssignees(actor, input);
    const resources = this.validateCalendarResources(actor, input.resource_reservations || []);
    return this.transaction(() => {
      const override = this.enforceCalendarConflicts(actor, input, range, assignees, resources);
      const conflicts = override.conflicts || [];
      const id = randomUUID();
      const pid = portable("calendar_event");
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO calendar_events
           (id, portable_id, tenant_id, entry_type, schedule_category, department_id, title, task_priority, appointment_type, customer_name, customer_contact, location, estimate_id, order_id, order_item_id, work_order_id, start_at, end_at, all_day, assigned_user_id, status, internal_note, conflict_override_reason, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, input.entry_type, input.schedule_category, departmentId, input.title, input.task_priority || null, input.appointment_type || null, input.customer_name || null, input.customer_contact || null, input.location || null, linked.estimate_id, linked.order_id, linked.order_item_id, linked.work_order_id, range.start_at, range.end_at, bool(input.all_day), assignees.primary, input.status || "scheduled", input.internal_note || null, conflicts.length ? override.reason : null, actor.id, timestamp, timestamp);
      this.writeCalendarAssignees(actor, id, assignees);
      this.writeCalendarResources(actor, id, resources);
      this.audit(actor, "calendar.create", "calendar_event", id, pid, `Calendar ${input.entry_type} ${input.title} scheduled`, { entry_type: input.entry_type, schedule_category: input.schedule_category, department_id: departmentId, estimate_id: linked.estimate_id, order_id: linked.order_id, order_item_id: linked.order_item_id, work_order_id: linked.work_order_id, assignee_user_ids: assignees.assigneeIds, resource_ids: resources.map((resource) => resource.resource_id), conflicts, conflict_override_reason: conflicts.length ? override.reason : null });
      return this.calendarEvent(actor, id);
    });
  }

  updateCalendarEvent(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.calendarEvent(actor, id);
    const input = calendarEventSchema.parse({ ...existing, ...payload });
    const departmentId = this.validateDepartmentId(actor, input.department_id, { allowInactive: true });
    const linked = this.validateCalendarLinks(actor, input);
    const range = this.validateCalendarRange(input, actor);
    const assignees = this.normalizeCalendarAssignees(actor, input);
    const resources = this.validateCalendarResources(actor, input.resource_reservations || []);
    return this.transaction(() => {
      const override = this.enforceCalendarConflicts(actor, input, range, assignees, resources, id);
      const conflicts = override.conflicts || [];
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE calendar_events
           SET entry_type = ?, schedule_category = ?, department_id = ?, title = ?, task_priority = ?, appointment_type = ?, customer_name = ?, customer_contact = ?, location = ?, estimate_id = ?, order_id = ?, order_item_id = ?, work_order_id = ?, start_at = ?, end_at = ?, all_day = ?, assigned_user_id = ?, status = ?, internal_note = ?, conflict_override_reason = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?`,
        )
        .run(input.entry_type, input.schedule_category, departmentId, input.title, input.task_priority || null, input.appointment_type || null, input.customer_name || null, input.customer_contact || null, input.location || null, linked.estimate_id, linked.order_id, linked.order_item_id, linked.work_order_id, range.start_at, range.end_at, bool(input.all_day), assignees.primary, input.status || existing.status, input.internal_note || null, conflicts.length ? override.reason : existing.conflict_override_reason || null, timestamp, id, actor.tenant_id);
      this.writeCalendarAssignees(actor, id, assignees);
      this.writeCalendarResources(actor, id, resources);
      const action = existing.start_at !== range.start_at || existing.end_at !== range.end_at ? "calendar.reschedule" : "calendar.update";
      this.audit(actor, action, "calendar_event", id, existing.portable_id, `Calendar ${input.entry_type} ${input.title} ${action === "calendar.reschedule" ? "rescheduled" : "updated"}`, { from: { start_at: existing.start_at, end_at: existing.end_at }, to: range, entry_type: input.entry_type, schedule_category: input.schedule_category, department_id: departmentId, assignee_user_ids: assignees.assigneeIds, resource_ids: resources.map((resource) => resource.resource_id), conflicts, conflict_override_reason: conflicts.length ? override.reason : null });
      return this.calendarEvent(actor, id);
    });
  }

  setCalendarStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!CALENDAR_STATUSES.includes(status)) throw error("invalid_calendar_status", 400);
    return this.transaction(() => {
      const existing = this.calendarEvent(actor, id);
      const timestamp = now();
      this.db.prepare("UPDATE calendar_events SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, timestamp, id, actor.tenant_id);
      const action = status === "complete" ? "calendar.complete" : status === "cancelled" ? "calendar.cancel" : "calendar.reopen";
      this.audit(actor, action, "calendar_event", id, existing.portable_id, `Calendar event ${existing.title} ${status}`, { from: existing.status, to: status });
      return this.calendarEvent(actor, id);
    });
  }

}

export const calendarMethods = methodsFromClass(CalendarDomainMethods);
