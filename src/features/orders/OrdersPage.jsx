import {
  useMemo,
  useState,
} from "react";
import {
  CheckCircle2,
  Clock,
  FileText,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import {
  formatDate,
  useLoad,
  Toolbar,
  AsyncState,
} from "../general/GeneralPages.jsx";

function orderProductionStage(order) {
  const items = order.items || [];
  if (items.some((item) => item.production_required && item.production_stage === "waiting")) return "waiting";
  if (items.some((item) => item.production_required && item.production_stage === "in_progress")) return "in_progress";
  if (items.some((item) => item.production_required && item.production_stage === "ready")) return "ready";
  if (items.some((item) => item.production_required && item.production_stage === "complete")) return "complete";
  return "not_started";
}

function OrdersSnapshot({ orders = [], onWaitingApproval }) {
  const openOrders = orders.filter((order) => !["complete", "cancelled"].includes(order.status)).length;
  const inProduction = orders.filter((order) => ["in_progress", "waiting"].includes(orderProductionStage(order))).length;
  const ready = orders.filter((order) => orderProductionStage(order) === "ready").length;
  const waitingApproval = orders.filter((order) => ["draft", "on_hold"].includes(order.status)).length;
  const today = new Date();
  const through = new Date(today);
  through.setDate(today.getDate() + 14);
  const throughLabel = through.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <section className="panel orders-snapshot">
      <div className="orders-snapshot-title">
        <span>Orders Snapshot</span>
        <strong>Today through {throughLabel}</strong>
      </div>
      <a href="#/orders" className="orders-snapshot-card">
        <span><ShoppingBag size={22} /></span>
        <strong>{openOrders}</strong>
        <small>Open Orders</small>
      </a>
      <a href="#/production" className="orders-snapshot-card production">
        <span><FileText size={22} /></span>
        <strong>{inProduction}</strong>
        <small>In Production</small>
      </a>
      <a href="#/production" className="orders-snapshot-card ready">
        <span><CheckCircle2 size={22} /></span>
        <strong>{ready}</strong>
        <small>Ready for Pickup</small>
      </a>
      <button type="button" className="orders-snapshot-card waiting" onClick={onWaitingApproval}>
        <span><Clock size={22} /></span>
        <strong>{waitingApproval}</strong>
        <small>Waiting Approval</small>
      </button>
    </section>
  );
}

function OrdersPage({ api, filters, setFilters }) {
  const orders = useLoad(() => api.get("/orders"), []);
  const [action, setAction] = useState({ busy: false, error: "" });
  async function invoice(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/orders/${id}/invoice`, {});
      orders.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setOrderStatus(id, status) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/orders/${id}/status`, { status });
      orders.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }

  const filteredOrders = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const rows = [...(orders.data?.items || [])].filter((order) => {
      const text = [order.order_number, order.status, order.customer_summary?.contact_name, order.customer_summary?.business_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const statusMatch = filters.status === "all" || order.status === filters.status;
      const stageMatch = filters.production_stage === "all" || order.items?.some((item) => item.production_required && item.production_stage === filters.production_stage);
      const fromMatch = !filters.date_from || order.document_date >= filters.date_from;
      const toMatch = !filters.date_to || order.document_date <= filters.date_to;
      return (!search || text.includes(search)) && statusMatch && stageMatch && fromMatch && toMatch;
    });
    rows.sort((a, b) => {
      if (filters.sort === "due_date_asc") return String(a.due_date || "9999-12-31").localeCompare(String(b.due_date || "9999-12-31"));
      if (filters.sort === "total_desc") return (b.total_cents || 0) - (a.total_cents || 0);
      return String(b.order_number || "").localeCompare(String(a.order_number || ""));
    });
    return rows;
  }, [orders.data, filters]);

  return (
    <section className="shop-operations-page">
      <OrdersSnapshot orders={orders.data?.items || []} onWaitingApproval={() => setFilters?.({ ...filters, status: "on_hold", production_stage: "all" })} />
      <section className="panel orders-list-page">
        <Toolbar title="Orders" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={orders} empty="No orders found">
          {filteredOrders.length === 0 ? <div className="empty-state">No orders match the current filters</div> : (
            <div className="orders-table" role="table" aria-label="Orders">
              <div className="orders-table-row orders-table-head" role="row">
                <span role="columnheader">Order #</span>
                <span role="columnheader">Customer</span>
                <span role="columnheader">Project</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Created</span>
                <span role="columnheader">Due</span>
                <span role="columnheader">Actions</span>
              </div>
              {filteredOrders.map((order) => (
                <article className="orders-table-row" role="row" key={order.id}>
                  <a role="cell" href={`#/orders/${order.id}`} data-focus-target={`order-open-${order.id}`}><strong>{order.order_number}</strong></a>
                  <span role="cell">{order.customer_summary?.business_name || order.customer_summary?.contact_name || order.customer_id}</span>
                  <span role="cell">{order.title || order.items?.[0]?.title || order.items?.[0]?.description || "Order"}</span>
                  <span role="cell">
                    <select className={`status-select ${order.status}`} aria-label={`Status for ${order.order_number}`} value={order.status} disabled={action.busy} onChange={(event) => setOrderStatus(order.id, event.target.value)}>
                      {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </span>
                  <span role="cell">{formatDate(order.document_date)}</span>
                  <span role="cell">{order.due_date ? formatDate(order.due_date) : "No due date"}</span>
                  <span role="cell" className="row-actions">
                    <button data-focus-target={`order-open-${order.id}`} onClick={() => { window.location.hash = `#/orders/${order.id}`; }}><FileText size={14} />Open</button>
                    <button disabled={action.busy} onClick={() => invoice(order.id)}><ReceiptText size={14} />Create/Open Invoice</button>
                  </span>
                </article>
              ))}
            </div>
          )}
        </AsyncState>
      </section>
    </section>
  );
}

export {
  OrdersPage,
};
