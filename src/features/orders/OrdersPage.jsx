import {
  useMemo,
  useState,
} from "react";
import {
  FileText,
  ReceiptText,
} from "lucide-react";
import { money } from "../../api.js";
import {
  formatDate,
  formatProgress,
  useLoad,
  Toolbar,
  AsyncState,
} from "../general/GeneralPages.jsx";

function OrdersPage({ api, filters }) {
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
      <section className="panel orders-list-page">
        <Toolbar title="Orders" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={orders} empty="No orders found">
          {filteredOrders.length === 0 ? <div className="empty-state">No orders match the current filters</div> : (
            <div className="orders-table" role="table" aria-label="Orders">
              <div className="orders-table-row orders-table-head" role="row">
                <span role="columnheader">Order</span>
                <span role="columnheader">Customer</span>
                <span role="columnheader">Order Date</span>
                <span role="columnheader">Due Date</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Production</span>
                <span role="columnheader">Total</span>
                <span role="columnheader">Invoice</span>
                <span role="columnheader">Actions</span>
              </div>
              {filteredOrders.map((order) => (
                <article className="orders-table-row" role="row" key={order.id}>
                  <a role="cell" href={`#/orders/${order.id}`} data-focus-target={`order-open-${order.id}`}><strong>{order.order_number}</strong></a>
                  <span role="cell">{order.customer_summary?.business_name || order.customer_summary?.contact_name || order.customer_id}</span>
                  <span role="cell">{formatDate(order.document_date)}</span>
                  <span role="cell">{order.due_date ? formatDate(order.due_date) : "No due date"}</span>
                  <span role="cell">
                    <select aria-label={`Status for ${order.order_number}`} value={order.status} disabled={action.busy} onChange={(event) => setOrderStatus(order.id, event.target.value)}>
                      {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </span>
                  <span role="cell">{formatProgress(order.production_progress)}</span>
                  <span role="cell">{money(order.total_cents)}</span>
                  <span role="cell">{order.invoice?.payment_status || "No invoice"}</span>
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
  );
}

export {
  OrdersPage,
};
