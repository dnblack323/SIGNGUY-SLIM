import {
  AlertCircle,
  CalendarDays,
  Clock,
  CreditCard,
  Factory,
  MessageSquare,
  ShoppingBag,
} from "lucide-react";
import { money } from "../../api.js";
import {
  formatDate,
  useLoad,
  Toolbar,
  AsyncState,
} from "../general/GeneralPages.jsx";

function displayDateParts(date) {
  const [year, month, day] = String(date || "").split("-").map(Number);
  if (!year || !month || !day) return { weekday: "", day: date || "" };
  const value = new Date(Date.UTC(year, month - 1, day));
  return {
    weekday: value.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    day: value.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

function readableReason(value = "") {
  return String(value).replace(/_/g, " ");
}

function readableStatus(value = "") {
  return String(value || "active").replace(/_/g, " ");
}

function todayDisplay(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZone || undefined,
  }).format(new Date());
}

function cardValue(card) {
  if (Object.prototype.hasOwnProperty.call(card, "value_cents")) return money(card.value_cents);
  return card.value ?? 0;
}

function ShopSnapshot({ dashboard = {} }) {
  return (
    <section className="home-hero panel">
      <div>
        <span>Shop Snapshot</span>
        <h2>{todayDisplay(dashboard.timezone)}</h2>
      </div>
      <p>Let's get it done.</p>
      <div className="home-hero-actions">
        <a href="#/orders">Open Orders</a>
        <a href="#/calendar">Open Calendar</a>
      </div>
    </section>
  );
}

function SummaryCards({ cards = [] }) {
  return (
    <div className="home-summary-grid" aria-label="Home summary">
      {cards.map((card) => (
        <a className="home-summary-card" href={card.href || "#/"} key={card.key || card.label}>
          <span>{card.label}</span>
          <strong>{cardValue(card)}</strong>
        </a>
      ))}
    </div>
  );
}

function ImportantWeekCalendar({ calendar = {} }) {
  const days = (calendar.days || []).slice(0, 5);
  return (
    <div className="home-important-week" aria-label="What's important this week">
      {days.map((day) => {
        const parts = displayDateParts(day.date);
        const entries = (day.entries || []).slice(0, 2);
        const extraCount = Math.max(0, (day.entries || []).length - entries.length);
        const dayLink = day.link || `#/calendar?view=day&date=${day.date}`;
        return (
          <article className={day.today ? "home-calendar-day today" : "home-calendar-day"} key={day.date}>
            <header>
              <span>{day.today ? "Today" : parts.weekday}</span>
              <strong>{parts.day}</strong>
            </header>
            <div className="home-calendar-entries">
              {entries.length === 0 ? <span className="home-calendar-open">No high priority items</span> : entries.map((entry) => (
                <a href={entry.link || dayLink} key={entry.id || `${entry.source_type}-${entry.source_id}-${entry.reason}`}>
                  <small>{readableReason(entry.reason || entry.kind || "important")}</small>
                  <span>{entry.title || entry.display_title}</span>
                </a>
              ))}
              {extraCount > 0 && <a href={dayLink} className="home-calendar-more">+ {extraCount} more</a>}
            </div>
            <a href={dayLink} className="home-calendar-day-link">Open Day</a>
          </article>
        );
      })}
    </div>
  );
}

function ClockedInWidget({ clock = {} }) {
  const entries = clock.entries || [];
  return (
    <section className="panel home-clock-widget">
      <div>
        <span>{clock.mode === "personal" ? "Time Clock" : "Team Time Clock"}</span>
        <strong>{clock.count || 0}</strong>
        <small>{clock.count === 1 ? "person clocked in" : "people clocked in"}</small>
      </div>
      <div className="home-clock-list">
        {entries.length === 0 ? <span>No one is clocked in</span> : entries.map((entry) => (
          <span key={entry.id}>{entry.employee_name}<small>Since {entry.clock_in_time || entry.clock_in_at}</small></span>
        ))}
      </div>
      <a href={clock.href || "#/time"}><Clock size={16} />Open Time Clock</a>
    </section>
  );
}

function MessagesWidget({ messages = {} }) {
  const shortcuts = [messages.customer, messages.employee].filter((entry) => entry?.available);
  return (
    <section className="panel dashboard-panel home-messages-widget">
      <Toolbar title="Messages" />
      <div className="home-message-shortcuts">
        {shortcuts.length === 0 ? <div className="empty-state">No message shortcuts available</div> : shortcuts.map((entry) => (
          <a href={entry.href} key={entry.label}>
            <MessageSquare size={18} aria-hidden="true" />
            <span>{entry.label}</span>
            <strong>{entry.count || 0}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}

function CompactList({ title, icon: Icon, items = [], empty, action }) {
  return (
    <section className="panel dashboard-panel home-list-panel">
      <Toolbar title={title}>{action}</Toolbar>
      {items.length === 0 ? <div className="empty-state">{empty}</div> : (
        <div className="home-compact-list">
          {items.map((item) => (
            <a href={item.link || "#/"} key={item.id}>
              {Icon && <Icon size={16} aria-hidden="true" />}
              <span>
                <strong>{item.title}</strong>
                <small>{[item.order_number, item.stage ? readableReason(item.stage) : null, item.time, item.due_date ? `Due ${formatDate(item.due_date)}` : item.date ? formatDate(item.date) : null].filter(Boolean).join(" / ")}</small>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentOrdersWidget({ orders = [] }) {
  return (
    <section className="panel dashboard-panel home-recent-orders">
      <Toolbar title="Recent Orders"><a href="#/orders">View All</a></Toolbar>
      {orders.length === 0 ? <div className="empty-state">No recent orders</div> : (
        <div className="home-orders-table" role="table" aria-label="Recent orders">
          <div className="home-orders-row home-orders-head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Customer</span>
            <span role="columnheader">Project</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Due</span>
          </div>
          {orders.map((order) => (
            <a href={order.link || "#/orders"} className="home-orders-row" role="row" key={order.id}>
              <span role="cell">{order.order_number}</span>
              <span role="cell">{order.customer}</span>
              <span role="cell">{order.project}</span>
              <span role="cell"><mark>{readableStatus(order.status)}</mark></span>
              <span role="cell">{order.due_date ? formatDate(order.due_date) : "No due date"}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function PaymentsWidget({ payments = {} }) {
  return (
    <section className="panel dashboard-panel home-payments-widget">
      <Toolbar title="Payments"><a href="#/payments">View All</a></Toolbar>
      <div className="home-payment-summary">
        <div>
          <CreditCard size={22} aria-hidden="true" />
          <strong>{money(payments.balance_due_cents || 0)}</strong>
          <span>Balance due</span>
        </div>
        <div>
          <ShoppingBag size={22} aria-hidden="true" />
          <strong>{payments.open_invoice_count || 0}</strong>
          <span>Open invoices</span>
        </div>
      </div>
      <a className="home-payment-action" href={payments.href || "#/payments"}><CreditCard size={16} />Collect Payment</a>
    </section>
  );
}

function HomePage({ api }) {
  const state = useLoad(() => api.get("/dashboard"), []);
  const dashboard = state.data || {};
  const widgets = dashboard.widgets || {};
  return (
    <section className="home-dashboard" aria-label="Home dashboard">
      <AsyncState state={state} empty="No dashboard data">
        <ShopSnapshot dashboard={dashboard} />

        {widgets.summary_cards !== false && <SummaryCards cards={dashboard.summary?.cards || []} />}

        {widgets.important_week !== false && (
          <section className="panel dashboard-panel home-calendar-panel">
            <Toolbar title="What's Important This Week"><a href="#/calendar">Open Full Calendar</a></Toolbar>
            <ImportantWeekCalendar calendar={dashboard.calendar || {}} />
          </section>
        )}

        {(widgets.clocked_in !== false || widgets.messages !== false) && (
          <section className="home-top-widget-grid">
            {widgets.clocked_in !== false && <ClockedInWidget clock={dashboard.clock || {}} />}
            {widgets.messages !== false && <MessagesWidget messages={dashboard.messages || {}} />}
          </section>
        )}

        {(widgets.production_focus !== false || widgets.next_up !== false) && (
          <section className="home-work-grid">
            {widgets.production_focus !== false && <CompactList title="Production Focus" icon={Factory} items={dashboard.summary?.production_focus || []} empty="No active production work" action={<a href="#/production">Production</a>} />}
            {widgets.next_up !== false && <CompactList title="Next Up" icon={CalendarDays} items={dashboard.summary?.upcoming_events || []} empty="No upcoming events" action={<a href="#/calendar">Calendar</a>} />}
          </section>
        )}

        {(widgets.recent_orders !== false || widgets.payments !== false || widgets.attention !== false) && (
          <section className="home-bottom-grid">
            {widgets.recent_orders !== false && dashboard.summary?.recent_orders && <RecentOrdersWidget orders={dashboard.summary.recent_orders} />}
            {widgets.payments !== false && dashboard.summary?.payments && <PaymentsWidget payments={dashboard.summary.payments} />}
            {widgets.attention !== false && (
              <section className="panel dashboard-panel attention-panel">
                <Toolbar title="Attention Panel"><a href="#/">View All</a></Toolbar>
                {(dashboard.attention || []).length === 0 ? <div className="empty-state">No attention items</div> : (
                  <div className="record-list">
                    {dashboard.attention.map((item) => (
                      <a className={`attention-item ${item.severity.replace(/\s+/g, "-")}`} href={item.link} key={`${item.source_type}-${item.source_id}-${item.reason}`}>
                        <AlertCircle size={16} aria-hidden="true" />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{readableReason(item.reason)} / {item.severity}{item.date ? ` / ${item.date}` : ""}</small>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
        )}
      </AsyncState>
    </section>
  );
}

export {
  HomePage,
};
