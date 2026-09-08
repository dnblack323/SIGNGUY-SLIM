import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  ADMIN_ROLES,
  MANAGER_ROLES,
  PRODUCTION_STAGES,
  activeProductionWorkOrderCompletionPredicate,
  addDays,
  createHash,
  localTimeFor,
  now,
  portable,
  randomUUID,
  today,
  todayInTimeZone,
} = shared;

const DEMO_DATA_SET = "local_review_v1";
const DEMO_SEQUENCE_NAMES = ["customer", "estimate", "order", "work_order", "invoice"];
const DEMO_SEQUENCE_SOURCES = [
  ["customer", "customers", "customer_number", "C"],
  ["estimate", "estimates", "estimate_number", "E"],
  ["order", "orders", "order_number", "O"],
  ["work_order", "work_orders", "work_order_number", "WO"],
  ["invoice", "invoices", "invoice_number", "I"],
];

function dayAt(date, time) {
  return `${date}T${time}`;
}

function workweekStartFor(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function calendarDayLink(date) {
  return `#/calendar?view=day&date=${date}`;
}

function eventDayEntry(event) {
  return {
    id: `calendar-${event.id}`,
    source_type: "calendar_event",
    source_id: event.id,
    kind: event.entry_type || "event",
    reason: event.task_priority === "urgent" ? "urgent_calendar" : "high_priority",
    priority: event.task_priority || (event.schedule_category === "deadline" ? "high" : "normal"),
    title: event.display_title || event.title,
    date: event.local_start_date,
    time: event.local_start_time || null,
    link: calendarDayLink(event.local_start_date),
  };
}

function highPriorityCalendarEvent(event) {
  return ["high", "urgent"].includes(event.task_priority) || event.schedule_category === "deadline";
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function nextSequenceFromRows(rows, column, prefix) {
  let max = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const row of rows || []) {
    const match = pattern.exec(String(row[column] || ""));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function parseSequenceSnapshot(value) {
  try {
    const snapshot = JSON.parse(value);
    if (!Number.isInteger(snapshot.next_value) || snapshot.next_value < 1) return null;
    return { next_value: snapshot.next_value, existed: snapshot.existed === true };
  } catch {
    return null;
  }
}

class DashboardDomainMethods {
  dashboard(actor) {
    const tenant = this.tenant(actor.tenant_id);
    const todayLocal = todayInTimeZone(tenant.shop_timezone);
    const currentWeekStart = workweekStartFor(todayLocal);
    const endLocal = addDays(currentWeekStart, 5);
    const board = this.productionBoard(actor);
    const manager = MANAGER_ROLES.has(actor.role);
    const widgets = tenant.dashboard_widgets;
    const stages = PRODUCTION_STAGES.map((stage) => {
      const stageItems = board.items.filter((item) => item.production_stage === stage && !["complete", "cancelled"].includes(item.order_status));
      return {
        stage,
        label: stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        count: stageItems.length,
        items: stageItems.slice(0, 3),
      };
    });
    const events = this.listCalendarEvents(actor, { start_at: currentWeekStart, end_at: endLocal, status: "scheduled", ...(manager ? {} : { my_schedule: true }) }).items;
    const workweekDates = Array.from({ length: 5 }, (_, index) => addDays(currentWeekStart, index));
    const days = workweekDates.map((date) => {
      const dayEvents = events.filter((event) => event.local_start_date === date);
      const dueItems = this.dashboardDueItems(actor, date, manager, board);
      const highPriorityEvents = dayEvents.filter(highPriorityCalendarEvent);
      const entries = [...highPriorityEvents.map(eventDayEntry), ...dueItems]
        .sort((a, b) => [a.date, a.time || "", a.title].join("|").localeCompare([b.date, b.time || "", b.title].join("|")));
      return { date, today: date === todayLocal, link: calendarDayLink(date), events: highPriorityEvents.map(eventDayEntry), due_items: dueItems, entries };
    });
    return {
      timezone: tenant.shop_timezone,
      widgets,
      summary: this.dashboardSummary(actor, todayLocal, manager, board, events),
      clock: this.dashboardClock(actor, tenant, manager),
      messages: this.dashboardMessages(actor, manager),
      production: { stages },
      calendar: {
        start_date: currentWeekStart,
        end_date: addDays(currentWeekStart, 4),
        days,
      },
      attention: manager ? this.attentionItems(actor, todayLocal) : this.staffAttentionItems(actor, todayLocal, board),
      sample_data: {
        available: ADMIN_ROLES.has(actor.role),
        seeded: this.dashboardSampleDataSeeded(actor),
      },
    };
  }

  dashboardSampleDataSeeded(actor) {
    return Boolean(this.db.prepare("SELECT id FROM demo_data_records WHERE tenant_id = ? AND demo_set = ? LIMIT 1").get(actor.tenant_id, DEMO_DATA_SET));
  }

  markDemoDataRecord(actor, entityType, entityId, createdAt = now()) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO demo_data_records (id, tenant_id, demo_set, entity_type, entity_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), actor.tenant_id, DEMO_DATA_SET, entityType, entityId, createdAt);
  }

  markDemoEntity(actor, entityType, entity, createdAt) {
    this.markDemoDataRecord(actor, entityType, entity.id, createdAt);
    return entity;
  }

  markedDemoIds(actor, entityType) {
    return this.db
      .prepare("SELECT entity_id FROM demo_data_records WHERE tenant_id = ? AND demo_set = ? AND entity_type = ? ORDER BY created_at, id")
      .all(actor.tenant_id, DEMO_DATA_SET, entityType)
      .map((row) => row.entity_id);
  }

  deleteMarkedRows(actor, table, entityType, column = "id") {
    const ids = this.markedDemoIds(actor, entityType);
    if (!ids.length) return 0;
    return this.db
      .prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND ${column} IN (${placeholders(ids)})`)
      .run(actor.tenant_id, ...ids).changes;
  }

  deleteMarkedRowsById(actor, table, ids, column = "id") {
    if (!ids.length) return 0;
    return this.db
      .prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND ${column} IN (${placeholders(ids)})`)
      .run(actor.tenant_id, ...ids).changes;
  }

  safeMarkedCustomerIds(actor) {
    const ids = this.markedDemoIds(actor, "customer");
    if (!ids.length) return [];
    return this.db
      .prepare(
        `SELECT c.id
         FROM customers c
         WHERE c.tenant_id = ? AND c.id IN (${placeholders(ids)})
           AND NOT EXISTS (
             SELECT 1 FROM orders o
             LEFT JOIN demo_data_records d
               ON d.tenant_id = o.tenant_id AND d.demo_set = ? AND d.entity_type = 'order' AND d.entity_id = o.id
             WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id AND d.id IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM estimates e
             LEFT JOIN demo_data_records d
               ON d.tenant_id = e.tenant_id AND d.demo_set = ? AND d.entity_type = 'estimate' AND d.entity_id = e.id
             WHERE e.tenant_id = c.tenant_id AND e.customer_id = c.id AND d.id IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM invoices i
             LEFT JOIN demo_data_records d
               ON d.tenant_id = i.tenant_id AND d.demo_set = ? AND d.entity_type = 'invoice' AND d.entity_id = i.id
             WHERE i.tenant_id = c.tenant_id AND i.customer_id = c.id AND d.id IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM customer_communications cc
             LEFT JOIN demo_data_records d
               ON d.tenant_id = cc.tenant_id AND d.demo_set = ? AND d.entity_type = 'communication' AND d.entity_id = cc.id
             WHERE cc.tenant_id = c.tenant_id AND cc.customer_id = c.id AND d.id IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM outbound_email_sends oes
             WHERE oes.tenant_id = c.tenant_id AND oes.customer_id = c.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM order_intake_items oi
             LEFT JOIN demo_data_records d
               ON d.tenant_id = oi.tenant_id AND d.demo_set = ? AND d.entity_type = 'order_intake_item' AND d.entity_id = oi.id
             WHERE oi.tenant_id = c.tenant_id AND oi.customer_id = c.id AND d.id IS NULL
           )`,
      )
      .all(actor.tenant_id, ...ids, DEMO_DATA_SET, DEMO_DATA_SET, DEMO_DATA_SET, DEMO_DATA_SET, DEMO_DATA_SET)
      .map((row) => row.id);
  }

  snapshotDemoSequences(actor, createdAt) {
    for (const sequenceName of DEMO_SEQUENCE_NAMES) {
      const row = this.db
        .prepare("SELECT next_value FROM tenant_sequences WHERE tenant_id = ? AND sequence_name = ?")
        .get(actor.tenant_id, sequenceName);
      this.markDemoDataRecord(actor, `tenant_sequence:${sequenceName}`, JSON.stringify({
        next_value: row?.next_value || 1,
        existed: Boolean(row),
      }), createdAt);
    }
  }

  restoreDemoSequences(actor) {
    for (const [sequenceName, table, column, prefix] of DEMO_SEQUENCE_SOURCES) {
      const marker = this.db
        .prepare("SELECT entity_id FROM demo_data_records WHERE tenant_id = ? AND demo_set = ? AND entity_type = ? ORDER BY created_at, id LIMIT 1")
        .get(actor.tenant_id, DEMO_DATA_SET, `tenant_sequence:${sequenceName}`);
      const snapshot = parseSequenceSnapshot(marker?.entity_id);
      if (!snapshot) continue;
      const liveNext = nextSequenceFromRows(
        this.db.prepare(`SELECT ${column} FROM ${table} WHERE tenant_id = ?`).all(actor.tenant_id),
        column,
        prefix,
      );
      const nextValue = Math.max(snapshot.next_value, liveNext);
      if (!snapshot.existed && nextValue <= 1) {
        this.db.prepare("DELETE FROM tenant_sequences WHERE tenant_id = ? AND sequence_name = ?").run(actor.tenant_id, sequenceName);
      } else {
        this.db.prepare(
          `INSERT INTO tenant_sequences (tenant_id, sequence_name, next_value)
           VALUES (?, ?, ?)
           ON CONFLICT(tenant_id, sequence_name) DO UPDATE SET next_value = excluded.next_value`,
        ).run(actor.tenant_id, sequenceName, nextValue);
      }
    }
  }

  dashboardSummary(actor, todayLocal, manager, board, events) {
    const activeProduction = (board.items || []).filter((item) => item.production_stage !== "complete" && !["complete", "cancelled"].includes(item.order_status || "")).length;
    const todayEvents = events.filter((event) => event.local_start_date === todayLocal).length;
    const upcomingEvents = events
      .flatMap((event) => event.local_start_date >= todayLocal ? [event] : [])
      .slice(0, 5)
      .map((event) => ({
        id: event.id,
        title: event.display_title || event.title,
        date: event.local_start_date,
        time: event.local_start_time,
        link: calendarDayLink(event.local_start_date),
      }));
    const productionFocus = (board.items || [])
      .filter((item) => item.production_stage !== "complete" && !["complete", "cancelled"].includes(item.order_status || ""))
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title || item.description || item.order_title || "Production work",
        order_id: item.order_id,
        order_number: item.order_number,
        stage: item.production_stage,
        due_date: item.due_date || item.item_due_date || item.order_due_date || null,
        link: item.order_id ? `#/orders/${item.order_id}` : "#/production",
      }));
    if (!manager) {
      return {
        cards: [
          { key: "my_production", label: "My Production", value: activeProduction, href: "#/production" },
          { key: "today_schedule", label: "Today", value: todayEvents, href: "#/calendar" },
          { key: "attention", label: "Attention", value: this.staffAttentionItems(actor, todayLocal, board).length, href: "#/" },
        ],
        production_focus: productionFocus,
        upcoming_events: upcomingEvents,
      };
    }
    const activeOrders = this.db.prepare("SELECT COUNT(*) AS count FROM orders WHERE tenant_id = ? AND status NOT IN ('complete', 'cancelled')").get(actor.tenant_id).count;
    const openQuotes = this.db.prepare("SELECT COUNT(*) AS count FROM estimates WHERE tenant_id = ? AND status IN ('draft', 'sent')").get(actor.tenant_id).count;
    const pendingIntake = this.db.prepare("SELECT COUNT(*) AS count FROM order_intake_items WHERE tenant_id = ? AND status NOT IN ('converted_to_order', 'attached_to_existing_order', 'closed_not_an_order')").get(actor.tenant_id).count;
    const invoiceBalance = this.db.prepare("SELECT COALESCE(SUM(balance_due_cents), 0) AS cents FROM invoices WHERE tenant_id = ? AND document_status = 'issued' AND balance_due_cents > 0").get(actor.tenant_id).cents;
    const openInvoiceCount = this.db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ? AND document_status = 'issued' AND balance_due_cents > 0").get(actor.tenant_id).count;
    const monthStart = `${todayLocal.slice(0, 8)}01`;
    const expenseMonth = this.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM expenses WHERE tenant_id = ? AND archived_at IS NULL AND expense_date >= ? AND expense_date <= ?").get(actor.tenant_id, monthStart, todayLocal).cents;
    const recentOrders = this.db.prepare(
      `SELECT o.id, o.order_number, o.title, o.status, o.document_date, o.due_date, c.business_name, c.contact_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
       WHERE o.tenant_id = ?
       ORDER BY o.created_at DESC, o.order_number DESC
       LIMIT 4`,
    ).all(actor.tenant_id).map((order) => ({
      id: order.id,
      order_number: order.order_number,
      customer: order.business_name || order.contact_name || "Customer",
      project: order.title || "Order",
      status: order.status,
      created: order.document_date,
      due_date: order.due_date,
      link: `#/orders/${order.id}`,
    }));
    const attention = this.attentionItems(actor, todayLocal);
    return {
      cards: [
        { key: "active_orders", label: "Active Orders", value: activeOrders, href: "#/orders" },
        { key: "production", label: "In Production", value: activeProduction, href: "#/production" },
        { key: "open_quotes", label: "Open Quotes", value: openQuotes, href: "#/estimates" },
        { key: "today_schedule", label: "Today", value: todayEvents, href: "#/calendar" },
        { key: "invoice_balance", label: "Balance Due", value_cents: invoiceBalance, href: "#/invoices" },
        { key: "month_expenses", label: "Month Expenses", value_cents: expenseMonth, href: "#/expenses" },
        { key: "incoming", label: "Incoming", value: pendingIntake, href: "#/orders/incoming" },
        { key: "attention", label: "Attention", value: attention.length, href: "#/" },
      ],
      production_focus: productionFocus,
      upcoming_events: upcomingEvents,
      recent_orders: recentOrders,
      payments: {
        balance_due_cents: invoiceBalance,
        open_invoice_count: openInvoiceCount,
        href: "#/payments",
      },
    };
  }

  dashboardDueItems(actor, date, manager, board) {
    const seen = new Set();
    const items = [];
    const push = (entry) => {
      const key = `${entry.source_type}:${entry.source_id}:${entry.reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        kind: "due",
        date,
        ...entry,
      });
    };
    for (const item of board.items || []) {
      const dueDate = item.due_date || item.item_due_date || item.order_due_date || null;
      if (dueDate !== date || item.production_stage === "complete" || ["complete", "cancelled"].includes(item.order_status || "")) continue;
      push({
        id: `production-due-${item.id}`,
        source_type: item.record_type || "production",
        source_id: item.id,
        reason: "production_due",
        title: item.title || item.description || item.order_number || "Production due",
        link: item.order_id ? `#/orders/${item.order_id}` : "#/production",
      });
    }
    if (!manager) return items;
    this.db
      .prepare("SELECT id, order_number FROM orders WHERE tenant_id = ? AND due_date = ? AND status NOT IN ('complete', 'cancelled') ORDER BY order_number")
      .all(actor.tenant_id, date)
      .forEach((row) => push({
        id: `order-due-${row.id}`,
        source_type: "order",
        source_id: row.id,
        reason: "order_due",
        title: row.order_number,
        link: `#/orders/${row.id}`,
      }));
    this.db
      .prepare(
        "SELECT id, estimate_number, follow_up_at, expires_at FROM estimates WHERE tenant_id = ? AND status IN ('draft', 'sent') AND (follow_up_at = ? OR expires_at = ?) ORDER BY estimate_number",
      )
      .all(actor.tenant_id, date, date)
      .forEach((row) => {
        if (row.follow_up_at === date) push({
          id: `estimate-follow-up-${row.id}`,
          source_type: "estimate",
          source_id: row.id,
          reason: "estimate_follow_up",
          title: row.estimate_number,
          link: "#/estimates",
        });
        if (row.expires_at === date) push({
          id: `estimate-expiration-${row.id}`,
          source_type: "estimate",
          source_id: row.id,
          reason: "estimate_expiration",
          title: row.estimate_number,
          link: "#/estimates",
        });
      });
    this.db
      .prepare("SELECT id, invoice_number, due_date FROM invoices WHERE tenant_id = ? AND document_status = 'issued' AND balance_due_cents > 0 AND due_date = ? ORDER BY invoice_number")
      .all(actor.tenant_id, date)
      .forEach((row) => push({
        id: `invoice-due-${row.id}`,
        source_type: "invoice",
        source_id: row.id,
        reason: "payment_due",
        title: row.invoice_number,
        link: "#/invoices",
      }));
    return items;
  }

  dashboardClock(actor, tenant, manager) {
    if (manager) {
      const entries = this.db
        .prepare(
          `SELECT t.id, t.employee_id, t.clock_in_at, e.name AS employee_name
           FROM employee_time_entries t
           JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
           WHERE t.tenant_id = ? AND t.status = 'open'
           ORDER BY t.clock_in_at, e.name`,
        )
        .all(actor.tenant_id)
        .map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          clock_in_at: row.clock_in_at,
          clock_in_time: localTimeFor(row.clock_in_at, tenant),
        }));
      return {
        mode: "team",
        label: "Clocked In",
        count: entries.length,
        href: "#/time",
        entries: entries.slice(0, 4),
      };
    }
    const employee = this.db
      .prepare(
        `SELECT e.id, e.name
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, actor.id);
    if (!employee) return { mode: "personal", label: "Clocked In", count: 0, href: "#/employee-portal/time-clock", entries: [] };
    const open = this.db
      .prepare("SELECT id, employee_id, clock_in_at FROM employee_time_entries WHERE tenant_id = ? AND employee_id = ? AND status = 'open' ORDER BY clock_in_at DESC LIMIT 1")
      .get(actor.tenant_id, employee.id);
    return {
      mode: "personal",
      label: open ? "Clocked In" : "Clocked Out",
      count: open ? 1 : 0,
      href: "#/employee-portal/time-clock",
      entries: open ? [{
        id: open.id,
        employee_id: employee.id,
        employee_name: employee.name,
        clock_in_at: open.clock_in_at,
        clock_in_time: localTimeFor(open.clock_in_at, tenant),
      }] : [],
    };
  }

  dashboardMessages(actor, manager) {
    const customerCount = manager
      ? this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM order_intake_items WHERE tenant_id = ? AND status NOT IN ('converted_to_order', 'attached_to_existing_order', 'closed_not_an_order')) +
             (SELECT COUNT(*) FROM customer_communications WHERE tenant_id = ? AND direction = 'inbound') AS count`,
        )
        .get(actor.tenant_id, actor.tenant_id).count
      : 0;
    const employee = this.db
      .prepare(
        `SELECT e.id
         FROM employees e
         JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.user_id = ? AND e.active = 1 AND e.portal_access_enabled = 1 AND u.active = 1
         ORDER BY e.created_at DESC LIMIT 1`,
      )
      .get(actor.tenant_id, actor.id);
    const employeeUnread = employee
      ? this.db
        .prepare("SELECT COUNT(*) AS count FROM employee_direct_messages WHERE tenant_id = ? AND recipient_user_id = ? AND recipient_read_at IS NULL")
        .get(actor.tenant_id, actor.id).count
      : 0;
    return {
      customer: {
        available: manager,
        label: "Customer Messages",
        count: customerCount,
        href: "#/orders/incoming",
      },
      employee: {
        available: Boolean(employee),
        label: "Employee Messages",
        count: employeeUnread,
        href: "#/employee-portal/messages",
      },
    };
  }

  seedDashboardSampleData(actor) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.transaction(() => {
      if (this.dashboardSampleDataSeeded(actor)) {
        return { seeded: false, dashboard: this.dashboard(actor) };
      }
      const tenant = this.tenant(actor.tenant_id);
      const todayLocal = todayInTimeZone(tenant.shop_timezone);
      const sampleWeekStart = workweekStartFor(todayLocal);
      const timestamp = now();
      this.snapshotDemoSequences(actor, timestamp);
      const createdOrders = [];
      const createdQuotes = [];
      const createdWorkOrders = [];
      const createdInvoices = [];
      const createdEvents = [];
      const createdIntakeItems = [];
      const mark = (type, entity) => this.markDemoEntity(actor, type, entity, timestamp);
      const markOrder = (order) => {
        mark("order", order);
        for (const item of order.items || []) mark("order_item", item);
        createdOrders.push(order);
        return order;
      };
      const markEstimate = (estimate) => {
        mark("estimate", estimate);
        for (const item of estimate.items || []) mark("estimate_item", item);
        createdQuotes.push(estimate);
        return estimate;
      };
      const markWorkOrderSet = (result) => {
        for (const workOrder of result.work_orders || []) {
          mark("work_order", workOrder);
          createdWorkOrders.push(workOrder);
          this.db
            .prepare("SELECT id FROM work_order_items WHERE tenant_id = ? AND work_order_id = ?")
            .all(actor.tenant_id, workOrder.id)
            .forEach((row) => this.markDemoDataRecord(actor, "work_order_item", row.id, timestamp));
        }
        return result;
      };
      const customers = Object.fromEntries([
        ["brightpath", ["Avery Lane", "BrightPath Preschool", "demo+brightpath@signguy.example", "125 Schoolhouse Rd"]],
        ["metro", ["Mina Patel", "Metro Pet Clinic", "demo+metro-pet@signguy.example", "820 Market Ave"]],
        ["peak", ["Jon Meyer", "Peak Adventure Rentals", "demo+peak-rentals@signguy.example", "44 Ridge Trail"]],
        ["harbor", ["Sofia Torres", "Harbor House Realty", "demo+harbor-house@signguy.example", "210 Harbor St"]],
        ["cedar", ["Evan Brooks", "Cedar Grove Church", "demo+cedar-grove@signguy.example", "78 Chapel Way"]],
        ["oak", ["Quinn Harper", "Oak & Iron Brewery", "demo+oak-iron@signguy.example", "13 Foundry Ln"]],
        ["precision", ["Luis Romero", "Precision Auto", "demo+precision-auto@signguy.example", "455 Service Dr"]],
      ].map(([key, [contact, business, email, line1]]) => [key, mark("customer", this.createCustomer(actor, {
        contact_name: contact,
        business_name: business,
        email,
        phone: "555-0190",
        billing_address: { line1, line2: null, city: "Raleigh", state: "NC", postal_code: "27601", country: "US" },
        internal_notes: "Local demo data record created by the Settings demo loader.",
      }))]));

      const brightpathOrder = markOrder(this.createOrder(actor, {
        title: "Perforated window graphics",
        customer_id: customers.brightpath.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 4),
        status: "active",
        items: [
          { title: "Window film", description: "Perforated window graphics", quantity_decimal: "6.0000", unit_price_cents: 18500, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 3), assigned_user_id: null, internal_note: "High priority for Friday pickup." },
          { title: "Install labor", description: "Window graphics install", quantity_decimal: "1.0000", unit_price_cents: 32500, taxable: false, production_required: false, due_date: addDays(sampleWeekStart, 4), assigned_user_id: null, internal_note: null },
        ],
      }));
      const brightpathWork = markWorkOrderSet(this.sendOrderToProduction(actor, brightpathOrder.id, { mode: "whole_order" })).work_orders[0];
      this.setWorkOrderStage(actor, brightpathWork.id, "in_progress");
      const brightpathInvoice = mark("invoice", this.createOrOpenInvoice(actor, brightpathOrder.id, { document_date: todayLocal, due_date: addDays(sampleWeekStart, 10) }).invoice);
      createdInvoices.push(brightpathInvoice);
      this.setInvoiceDocumentStatus(actor, brightpathInvoice.id, "issued");
      this.recordInvoicePayment(actor, brightpathInvoice.id, { amount_paid_cents: 50000, note: "Demo deposit" });

      const metroOrder = markOrder(this.createOrder(actor, {
        title: "Contour-cut decals",
        customer_id: customers.metro.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 3),
        status: "active",
        items: [{ title: "Contour decals", description: "Contour-cut clinic decals", quantity_decimal: "50.0000", unit_price_cents: 850, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 2), assigned_user_id: null, internal_note: "Proof approved." }],
      }));
      markWorkOrderSet(this.sendOrderToProduction(actor, metroOrder.id, { mode: "individual_items" }));

      const peakOrder = markOrder(this.createOrder(actor, {
        title: "Partial vehicle wrap",
        customer_id: customers.peak.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 8),
        status: "active",
        items: [{ title: "Van wrap", description: "Partial vehicle wrap", quantity_decimal: "1.0000", unit_price_cents: 245000, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 4), assigned_user_id: null, internal_note: "Waiting on final art approval." }],
      }));
      const peakWork = markWorkOrderSet(this.sendOrderToProduction(actor, peakOrder.id, { mode: "whole_order" })).work_orders[0];
      this.setWorkOrderStage(actor, peakWork.id, "waiting");

      const harborOrder = markOrder(this.createOrder(actor, {
        title: "Vehicle lettering",
        customer_id: customers.harbor.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 2),
        status: "active",
        items: [{ title: "Door lettering", description: "Vehicle lettering", quantity_decimal: "2.0000", unit_price_cents: 24000, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 2), assigned_user_id: null, internal_note: null }],
      }));
      const harborWork = markWorkOrderSet(this.sendOrderToProduction(actor, harborOrder.id, { mode: "whole_order" })).work_orders[0];
      this.setWorkOrderStage(actor, harborWork.id, "in_progress");

      markOrder(this.createOrder(actor, {
        title: "Channel letter service",
        customer_id: customers.cedar.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 9),
        status: "active",
        items: [{ title: "Service call", description: "Channel letter service", quantity_decimal: "1.0000", unit_price_cents: 47500, taxable: false, production_required: false, due_date: addDays(sampleWeekStart, 9), assigned_user_id: null, internal_note: null }],
      }));
      markOrder(this.createOrder(actor, {
        title: "Aluminum panel",
        customer_id: customers.oak.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 5),
        status: "draft",
        items: [{ title: "Aluminum panel", description: "Painted aluminum panel", quantity_decimal: "1.0000", unit_price_cents: 67500, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 5), assigned_user_id: null, internal_note: null }],
      }));
      markOrder(this.createOrder(actor, {
        title: "Wall sign install",
        customer_id: customers.precision.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 6),
        status: "on_hold",
        items: [{ title: "Wall sign", description: "Interior wall sign", quantity_decimal: "1.0000", unit_price_cents: 89500, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 6), assigned_user_id: null, internal_note: "Waiting on landlord approval." }],
      }));

      markEstimate(this.createEstimate(actor, {
        title: "Yard sign reorder",
        customer_id: customers.brightpath.id,
        document_date: todayLocal,
        expires_at: addDays(sampleWeekStart, 12),
        follow_up_at: addDays(sampleWeekStart, 2),
        status: "sent",
        items: [{ title: "Yard signs", description: "Double-sided yard signs", quantity_decimal: "24.0000", unit_price_cents: 1850, taxable: true, production_required: true, due_date: addDays(sampleWeekStart, 12), assigned_user_id: null, internal_note: null }],
      }));
      markEstimate(this.createEstimate(actor, {
        title: "Brewery taproom shirts",
        customer_id: customers.oak.id,
        document_date: todayLocal,
        status: "draft",
        items: [{ title: "Printed shirts", description: "One-color staff shirts", quantity_decimal: "36.0000", unit_price_cents: 1450, taxable: true, production_required: false, due_date: null, assigned_user_id: null, internal_note: null }],
      }));

      const eventSpecs = [
        { title: "Site survey: Metro Pet Clinic", entry_type: "appointment", schedule_category: "site_survey", appointment_type: "Site survey", customer_name: customers.metro.business_name, customer_contact: customers.metro.email, order_id: metroOrder.id, start_at: dayAt(addDays(sampleWeekStart, 1), "08:00"), end_at: dayAt(addDays(sampleWeekStart, 1), "08:45"), all_day: false, task_priority: "high" },
        { title: "Production: Harbor House Realty", entry_type: "event", schedule_category: "production", order_id: harborOrder.id, work_order_id: harborWork.id, start_at: dayAt(addDays(sampleWeekStart, 2), "09:00"), end_at: dayAt(addDays(sampleWeekStart, 2), "11:00"), all_day: false, task_priority: "high" },
        { title: "Pickup: BrightPath Preschool", entry_type: "task", schedule_category: "deadline", order_id: brightpathOrder.id, start_at: addDays(sampleWeekStart, 4), end_at: addDays(sampleWeekStart, 5), all_day: true, task_priority: "urgent" },
        { title: "Client art approval call", entry_type: "task", schedule_category: "sales", order_id: peakOrder.id, start_at: addDays(sampleWeekStart, 3), end_at: addDays(sampleWeekStart, 4), all_day: true, task_priority: "high" },
      ];
      for (const spec of eventSpecs) createdEvents.push(mark("calendar_event", this.createCalendarEvent(actor, spec)));

      for (const spec of [
        { vendor: "Demo Vinyl Supply", category: "Materials", description: "Cast vinyl roll for demo jobs", amount_cents: 18675 },
        { vendor: "Demo Panel Supply", category: "Materials", description: "Aluminum blanks", amount_cents: 9425 },
        { vendor: "Demo Shirt Vendor", category: "Subcontractor", description: "Screen print blanks", amount_cents: 12840 },
      ]) {
        mark("expense", this.createExpense(actor, { expense_date: todayLocal, payment_method: "credit_card", ...spec }));
      }

      const note = mark("communication", this.createManualCommunication(actor, {
        customer_id: customers.brightpath.id,
        direction: "inbound",
        channel: "email",
        subject: "Proof question",
        body_text: "Can you confirm the perforated vinyl proof before production?",
        related_entity_type: "order",
        related_entity_id: brightpathOrder.id,
      }));
      const address = this.ensureIntakeAddress(actor);
      for (const [index, entry] of [
        [customers.precision, "Need pricing on two service van magnets."],
        [customers.harbor, "Can you quote rider panels for our open house signs?"],
      ].entries()) {
        const sourceId = randomUUID();
        const itemId = randomUUID();
        const received = `${todayLocal}T12:0${index}:00.000Z`;
        const body = entry[1];
        this.db
          .prepare(
            `INSERT INTO intake_source_messages
             (id, portable_id, tenant_id, provider, provider_message_id, intake_address, sender_name, sender_email, recipients_json, subject, sent_at, received_at, text_body, payload_hash, receipt_status, created_at)
             VALUES (?, ?, ?, 'dashboard_demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
          )
          .run(sourceId, portable("intake_source_message"), actor.tenant_id, `demo-${actor.tenant_id}-${timestamp}-${index}`, address.full_address, entry[0].contact_name, entry[0].email, JSON.stringify([address.full_address]), `Demo request ${index + 1}`, received, received, body, createHash("sha256").update(`${entry[0].email}|${body}|${timestamp}`).digest("hex"), timestamp);
        this.db
          .prepare(
            `INSERT INTO order_intake_items
             (id, portable_id, tenant_id, source_message_id, customer_id, assigned_user_id, status, summary, follow_up_at, internal_notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
          )
          .run(itemId, portable("order_intake_item"), actor.tenant_id, sourceId, entry[0].id, actor.id, body, addDays(sampleWeekStart, index + 2), "Local demo data record.", timestamp, timestamp);
        this.markDemoDataRecord(actor, "intake_source_message", sourceId, timestamp);
        this.markDemoDataRecord(actor, "order_intake_item", itemId, timestamp);
        createdIntakeItems.push(itemId);
      }

      mark("employee_announcement", this.createAnnouncement(actor, {
        title: "Demo shop priority",
        body: "Keep Friday pickups and high-priority proofs at the top of the queue.",
        publish_at: dayAt(todayLocal, "08:00"),
        audience_role: "all",
      }));
      mark("employee_announcement", this.createAnnouncement(actor, {
        title: "Demo install reminder",
        body: "Confirm hardware kits before each install leaves the shop.",
        publish_at: dayAt(todayLocal, "08:15"),
        audience_role: "manager",
      }));
      this.audit(actor, "dashboard.sample_data_seed", "tenant", actor.tenant_id, tenant.portable_id, "Dashboard sample data added", {
        demo_set: DEMO_DATA_SET,
        customer_count: Object.keys(customers).length,
        order_ids: createdOrders.map((order) => order.id),
        quote_ids: createdQuotes.map((quote) => quote.id),
        work_order_ids: createdWorkOrders.map((workOrder) => workOrder.id),
        invoice_ids: createdInvoices.map((invoice) => invoice.id),
        calendar_event_ids: createdEvents.map((event) => event.id),
        communication_id: note.id,
        intake_item_ids: createdIntakeItems,
      });
      return { seeded: true, dashboard: this.dashboard(actor) };
    });
  }

  removeDashboardSampleData(actor) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.transaction(() => {
      if (!this.dashboardSampleDataSeeded(actor)) return { removed: false, dashboard: this.dashboard(actor) };
      const removed = {
        calendar_events: this.deleteMarkedRows(actor, "calendar_events", "calendar_event"),
        employee_announcement_reads: this.deleteMarkedRows(actor, "employee_announcement_reads", "employee_announcement", "announcement_id"),
        employee_announcements: this.deleteMarkedRows(actor, "employee_announcements", "employee_announcement"),
        customer_communications: this.deleteMarkedRows(actor, "customer_communications", "communication"),
        intake_attachments: this.deleteMarkedRows(actor, "intake_attachments", "intake_source_message", "source_message_id"),
        order_intake_items: this.deleteMarkedRows(actor, "order_intake_items", "order_intake_item"),
        intake_source_messages: this.deleteMarkedRows(actor, "intake_source_messages", "intake_source_message"),
        commercial_bundle_items: this.deleteMarkedRows(actor, "commercial_bundle_items", "estimate_item", "item_id")
          + this.deleteMarkedRows(actor, "commercial_bundle_items", "order_item", "item_id"),
        invoices: this.deleteMarkedRows(actor, "invoices", "invoice"),
        work_order_items: this.deleteMarkedRows(actor, "work_order_items", "work_order_item"),
        work_orders: this.deleteMarkedRows(actor, "work_orders", "work_order"),
        order_items: this.deleteMarkedRows(actor, "order_items", "order_item"),
        orders: this.deleteMarkedRows(actor, "orders", "order"),
        estimate_items: this.deleteMarkedRows(actor, "estimate_items", "estimate_item"),
        estimates: this.deleteMarkedRows(actor, "estimates", "estimate"),
        expenses: this.deleteMarkedRows(actor, "expenses", "expense"),
        customers: this.deleteMarkedRowsById(actor, "customers", this.safeMarkedCustomerIds(actor)),
      };
      this.restoreDemoSequences(actor);
      this.db.prepare("DELETE FROM demo_data_records WHERE tenant_id = ? AND demo_set = ?").run(actor.tenant_id, DEMO_DATA_SET);
      this.audit(actor, "dashboard.sample_data_remove", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Dashboard sample data removed", {
        demo_set: DEMO_DATA_SET,
        removed,
      });
      return { removed: true, dashboard: this.dashboard(actor) };
    });
  }

  attentionItems(actor, todayLocal = today()) {
    if (!MANAGER_ROLES.has(actor.role)) return this.staffAttentionItems(actor, todayLocal);
    const seen = new Set();
    const items = [];
    const push = (entry) => {
      const key = `${entry.source_type}:${entry.source_id}:${entry.reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(entry);
    };
    const severityFor = (date) => (date < todayLocal ? "overdue" : date === todayLocal ? "due today" : "reminder");
    this.db
      .prepare("SELECT id, order_number, due_date FROM orders WHERE tenant_id = ? AND due_date IS NOT NULL AND due_date <= ? AND status NOT IN ('complete', 'cancelled') ORDER BY due_date, order_number")
      .all(actor.tenant_id, todayLocal)
      .forEach((row) => push({ source_type: "order", source_id: row.id, reason: "order_due", title: row.order_number, date: row.due_date, severity: severityFor(row.due_date), link: `#/orders/${row.id}` }));
    this.db
      .prepare(
        `SELECT oi.id, oi.order_id, oi.description, COALESCE(oi.due_date, o.due_date) AS effective_due_date, o.order_number
         FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ? AND oi.production_required = 1
           AND NOT ${activeProductionWorkOrderCompletionPredicate("oi")}
           AND COALESCE(oi.due_date, o.due_date) IS NOT NULL AND COALESCE(oi.due_date, o.due_date) <= ? AND o.status NOT IN ('complete', 'cancelled')
         ORDER BY effective_due_date, o.order_number, oi.position`,
      )
      .all(actor.tenant_id, todayLocal)
      .forEach((row) => push({ source_type: "order_item", source_id: row.id, reason: "production_due", title: row.description, date: row.effective_due_date, severity: severityFor(row.effective_due_date), link: `#/orders/${row.order_id}` }));
    this.db
      .prepare(
        "SELECT id, estimate_number, follow_up_at, expires_at FROM estimates WHERE tenant_id = ? AND status IN ('draft', 'sent') AND ((follow_up_at IS NOT NULL AND follow_up_at <= ?) OR (expires_at IS NOT NULL AND expires_at <= ?)) ORDER BY COALESCE(follow_up_at, expires_at), estimate_number",
      )
      .all(actor.tenant_id, todayLocal, todayLocal)
      .forEach((row) => {
        if (row.follow_up_at && row.follow_up_at <= todayLocal) push({ source_type: "estimate", source_id: row.id, reason: "estimate_follow_up", title: row.estimate_number, date: row.follow_up_at, severity: severityFor(row.follow_up_at), link: "#/estimates" });
        if (row.expires_at && row.expires_at <= todayLocal) push({ source_type: "estimate", source_id: row.id, reason: "estimate_expiration", title: row.estimate_number, date: row.expires_at, severity: severityFor(row.expires_at), link: "#/estimates" });
      });
    this.listCalendarEvents(actor, { start_at: addDays(todayLocal, -30), end_at: addDays(todayLocal, 1), status: "scheduled" }).items
      .filter((event) => event.local_start_date <= todayLocal)
      .forEach((event) => push({ source_type: "calendar_event", source_id: event.id, reason: "calendar_due", title: event.title, date: event.local_start_date, severity: event.local_start_date < todayLocal ? "overdue" : "due today", link: "#/calendar" }));
    this.db
      .prepare("SELECT id, invoice_number, due_date, balance_due_cents FROM invoices WHERE tenant_id = ? AND document_status = 'issued' AND balance_due_cents > 0 ORDER BY COALESCE(due_date, document_date), invoice_number")
      .all(actor.tenant_id)
      .forEach((row) => {
        const severity = row.due_date ? severityFor(row.due_date) : "payment attention";
        push({ source_type: "invoice", source_id: row.id, reason: "payment_attention", title: row.invoice_number, date: row.due_date, severity, link: "#/invoices", balance_due_cents: row.balance_due_cents });
      });
    return items;
  }

  staffAttentionItems(actor, todayLocal = today(), board = null, events = null) {
    const seen = new Set();
    const items = [];
    const push = (entry) => {
      const key = `${entry.source_type}:${entry.source_id}:${entry.reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(entry);
    };
    const severityFor = (date) => (date < todayLocal ? "overdue" : date === todayLocal ? "due today" : "reminder");
    const scopedBoard = board || this.productionBoard(actor);
    for (const entry of scopedBoard.items || []) {
      const dueDate = entry.due_date || entry.order_due_date || entry.item_due_date || null;
      if (!dueDate || dueDate > todayLocal || entry.production_stage === "complete" || ["complete", "cancelled"].includes(entry.order_status)) continue;
      push({
        source_type: entry.record_type || "production",
        source_id: entry.id,
        reason: "production_due",
        title: entry.title || entry.description || entry.order_number || "Production work",
        date: dueDate,
        severity: severityFor(dueDate),
        link: entry.order_id ? `#/orders/${entry.order_id}` : "#/production",
      });
    }
    const scopedEvents = events || this.listCalendarEvents(actor, { start_at: addDays(todayLocal, -30), end_at: addDays(todayLocal, 1), status: "scheduled", my_schedule: true }).items;
    for (const event of scopedEvents.filter((event) => event.local_start_date <= todayLocal)) {
      push({ source_type: "calendar_event", source_id: event.id, reason: "calendar_due", title: event.title, date: event.local_start_date, severity: event.local_start_date < todayLocal ? "overdue" : "due today", link: "#/calendar" });
    }
    return items;
  }

}

export const dashboardMethods = methodsFromClass(DashboardDomainMethods);
