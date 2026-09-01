import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  PRODUCTION_STAGES,
  activeProductionWorkOrderCompletionPredicate,
  addDays,
  today,
  todayInTimeZone,
} = shared;

class DashboardDomainMethods {
  dashboard(actor) {
    const tenant = this.tenant(actor.tenant_id);
    const todayLocal = todayInTimeZone(tenant.shop_timezone);
    const endLocal = addDays(todayLocal, 14);
    const board = this.productionBoard(actor);
    const stages = PRODUCTION_STAGES.map((stage) => {
      const stageItems = board.items.filter((item) => item.production_stage === stage && !["complete", "cancelled"].includes(item.order_status));
      return {
        stage,
        label: stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        count: stageItems.length,
        items: stageItems.slice(0, 3),
      };
    });
    const events = this.listCalendarEvents(actor, { start_at: todayLocal, end_at: endLocal, status: "scheduled" }).items;
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = addDays(todayLocal, index);
      return { date, today: index === 0, events: events.filter((event) => event.local_start_date === date) };
    });
    return {
      timezone: tenant.shop_timezone,
      production: { stages },
      calendar: { start_date: todayLocal, end_date: addDays(todayLocal, 13), days },
      attention: this.attentionItems(actor, todayLocal),
    };
  }

  attentionItems(actor, todayLocal = today()) {
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

}

export const dashboardMethods = methodsFromClass(DashboardDomainMethods);
