import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  ADMIN_ROLES,
  MANAGER_ROLES,
  PRODUCTION_STAGES,
  activeProductionWorkOrderCompletionPredicate,
  addDays,
  localTimeFor,
  today,
  todayInTimeZone,
} = shared;

const SAMPLE_CUSTOMER_EMAIL = "sample-dashboard@signguy.example";

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
    return Boolean(this.db.prepare("SELECT id FROM customers WHERE tenant_id = ? AND email = ? LIMIT 1").get(actor.tenant_id, SAMPLE_CUSTOMER_EMAIL));
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
      const customer = this.createCustomer(actor, {
        contact_name: "Riley Sample",
        business_name: "Canyon Coffee Sample",
        email: SAMPLE_CUSTOMER_EMAIL,
        phone: "555-0190",
        billing_address: {
          line1: "120 Market St",
          line2: null,
          city: "Raleigh",
          state: "NC",
          postal_code: "27601",
          country: "US",
        },
        internal_notes: "Sample dashboard data. Replace before commercial use.",
      });
      const activeOrder = this.createOrder(actor, {
        title: "Sample Lobby Sign Package",
        customer_id: customer.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 4),
        status: "active",
        items: [
          {
            title: "Acrylic lobby sign",
            description: "Dimensional acrylic wall logo",
            quantity_decimal: "1.0000",
            unit_price_cents: 145000,
            taxable: true,
            production_required: true,
            due_date: addDays(sampleWeekStart, 3),
            assigned_user_id: null,
            internal_note: "Route and polish acrylic letters.",
          },
          {
            title: "Install labor",
            description: "On-site lobby install",
            quantity_decimal: "1.0000",
            unit_price_cents: 35000,
            taxable: false,
            production_required: false,
            due_date: addDays(sampleWeekStart, 4),
            assigned_user_id: null,
            internal_note: null,
          },
        ],
      });
      const workOrder = this.sendOrderToProduction(actor, activeOrder.id, { mode: "whole_order" }).work_orders[0];
      this.setWorkOrderStage(actor, workOrder.id, "in_progress");
      const invoice = this.createOrOpenInvoice(actor, activeOrder.id, { document_date: todayLocal, due_date: addDays(sampleWeekStart, 8) }).invoice;
      this.setInvoiceDocumentStatus(actor, invoice.id, "issued");
      this.recordInvoicePayment(actor, invoice.id, { amount_paid_cents: 50000, note: "Sample deposit" });
      const quote = this.createEstimate(actor, {
        title: "Sample Vehicle Lettering Quote",
        customer_id: customer.id,
        document_date: todayLocal,
        expires_at: addDays(sampleWeekStart, 9),
        follow_up_at: addDays(sampleWeekStart, 2),
        status: "sent",
        items: [{
          title: "Truck door lettering",
          description: "Two-color vinyl lettering set",
          quantity_decimal: "2.0000",
          unit_price_cents: 28500,
          taxable: true,
          production_required: true,
          due_date: addDays(sampleWeekStart, 9),
          assigned_user_id: null,
          internal_note: null,
        }],
      });
      this.createCalendarEvent(actor, {
        title: "Sample site survey",
        entry_type: "appointment",
        schedule_category: "site_survey",
        appointment_type: "Site survey",
        customer_name: customer.business_name || customer.contact_name,
        customer_contact: customer.email,
        order_id: activeOrder.id,
        start_at: dayAt(addDays(sampleWeekStart, 1), "10:00"),
        end_at: dayAt(addDays(sampleWeekStart, 1), "10:45"),
        all_day: false,
      });
      this.createCalendarEvent(actor, {
        title: "Sample production block",
        entry_type: "event",
        schedule_category: "production",
        order_id: activeOrder.id,
        work_order_id: workOrder.id,
        start_at: dayAt(addDays(sampleWeekStart, 2), "09:00"),
        end_at: dayAt(addDays(sampleWeekStart, 2), "11:00"),
        all_day: false,
      });
      this.createCalendarEvent(actor, {
        title: "Sample quote follow-up",
        entry_type: "task",
        schedule_category: "sales",
        task_priority: "high",
        estimate_id: quote.id,
        start_at: addDays(sampleWeekStart, 2),
        end_at: addDays(sampleWeekStart, 3),
        all_day: true,
      });
      this.createManualCommunication(actor, {
        customer_id: customer.id,
        direction: "inbound",
        channel: "email",
        subject: "Sample customer proof question",
        body_text: "Can you confirm the acrylic color before production?",
        related_entity_type: "order",
        related_entity_id: activeOrder.id,
      });
      const waitingOrder = this.createOrder(actor, {
        title: "Sample Permit Panel",
        customer_id: customer.id,
        document_date: todayLocal,
        due_date: addDays(sampleWeekStart, 4),
        status: "active",
        items: [{
          title: "Exterior panel",
          description: "Aluminum panel awaiting permit release",
          quantity_decimal: "1.0000",
          unit_price_cents: 72500,
          taxable: true,
          production_required: true,
          due_date: addDays(sampleWeekStart, 4),
          assigned_user_id: null,
          internal_note: "Hold production until permit approval.",
        }],
      });
      const waitingWorkOrder = this.sendOrderToProduction(actor, waitingOrder.id, { mode: "individual_items" }).work_orders[0];
      this.setWorkOrderStage(actor, waitingWorkOrder.id, "waiting");
      this.createExpense(actor, {
        expense_date: todayLocal,
        vendor: "Sample Vinyl Supply",
        category: "Materials",
        description: "Roll stock for sample dashboard jobs",
        amount_cents: 18675,
        payment_method: "credit_card",
      });
      this.audit(actor, "dashboard.sample_data_seed", "tenant", actor.tenant_id, tenant.portable_id, "Dashboard sample data added", {
        customer_id: customer.id,
        order_ids: [activeOrder.id, waitingOrder.id],
        quote_id: quote.id,
      });
      return { seeded: true, dashboard: this.dashboard(actor) };
    });
  }

  removeDashboardSampleData(actor) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.transaction(() => {
      const customer = this.db.prepare("SELECT id, portable_id FROM customers WHERE tenant_id = ? AND email = ? LIMIT 1").get(actor.tenant_id, SAMPLE_CUSTOMER_EMAIL);
      if (!customer) return { removed: false, dashboard: this.dashboard(actor) };
      this.db
        .prepare(
          `DELETE FROM calendar_events
           WHERE tenant_id = ? AND (
             customer_contact = ?
             OR order_id IN (SELECT id FROM orders WHERE tenant_id = ? AND customer_id = ?)
             OR estimate_id IN (SELECT id FROM estimates WHERE tenant_id = ? AND customer_id = ?)
             OR work_order_id IN (
               SELECT wo.id FROM work_orders wo
               JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
               WHERE wo.tenant_id = ? AND o.customer_id = ?
             )
           )`,
        )
        .run(actor.tenant_id, SAMPLE_CUSTOMER_EMAIL, actor.tenant_id, customer.id, actor.tenant_id, customer.id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM sendgrid_events WHERE tenant_id = ? AND outbound_email_send_id IN (SELECT id FROM outbound_email_sends WHERE tenant_id = ? AND customer_id = ?)").run(actor.tenant_id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM customer_communications WHERE tenant_id = ? AND customer_id = ?").run(actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM outbound_email_sends WHERE tenant_id = ? AND customer_id = ?").run(actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM commercial_bundle_items WHERE tenant_id = ? AND bundle_id IN (SELECT id FROM commercial_bundles WHERE tenant_id = ? AND ((document_type = 'estimate' AND document_id IN (SELECT id FROM estimates WHERE tenant_id = ? AND customer_id = ?)) OR (document_type = 'order' AND document_id IN (SELECT id FROM orders WHERE tenant_id = ? AND customer_id = ?)) OR (document_type = 'invoice' AND document_id IN (SELECT id FROM invoices WHERE tenant_id = ? AND customer_id = ?))))").run(actor.tenant_id, actor.tenant_id, actor.tenant_id, customer.id, actor.tenant_id, customer.id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM commercial_bundles WHERE tenant_id = ? AND ((document_type = 'estimate' AND document_id IN (SELECT id FROM estimates WHERE tenant_id = ? AND customer_id = ?)) OR (document_type = 'order' AND document_id IN (SELECT id FROM orders WHERE tenant_id = ? AND customer_id = ?)) OR (document_type = 'invoice' AND document_id IN (SELECT id FROM invoices WHERE tenant_id = ? AND customer_id = ?)))").run(actor.tenant_id, actor.tenant_id, customer.id, actor.tenant_id, customer.id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM order_attachments WHERE tenant_id = ? AND order_id IN (SELECT id FROM orders WHERE tenant_id = ? AND customer_id = ?)").run(actor.tenant_id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM invoices WHERE tenant_id = ? AND customer_id = ?").run(actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM work_order_items WHERE tenant_id = ? AND work_order_id IN (SELECT wo.id FROM work_orders wo JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id WHERE wo.tenant_id = ? AND o.customer_id = ?)").run(actor.tenant_id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM work_orders WHERE tenant_id = ? AND order_id IN (SELECT id FROM orders WHERE tenant_id = ? AND customer_id = ?)").run(actor.tenant_id, actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM orders WHERE tenant_id = ? AND customer_id = ?").run(actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM estimates WHERE tenant_id = ? AND customer_id = ?").run(actor.tenant_id, customer.id);
      this.db.prepare("DELETE FROM expenses WHERE tenant_id = ? AND vendor = 'Sample Vinyl Supply' AND description = 'Roll stock for sample dashboard jobs'").run(actor.tenant_id);
      this.db.prepare("DELETE FROM customers WHERE tenant_id = ? AND id = ?").run(actor.tenant_id, customer.id);
      this.audit(actor, "dashboard.sample_data_remove", "tenant", actor.tenant_id, this.tenant(actor.tenant_id).portable_id, "Dashboard sample data removed", {
        sample_customer_portable_id: customer.portable_id,
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
