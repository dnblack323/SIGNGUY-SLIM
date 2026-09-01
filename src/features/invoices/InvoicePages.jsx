import {
  useMemo,
  useState,
} from "react";
import {
  Download,
  ReceiptText,
  Save,
} from "lucide-react";
import {
  cents,
  money,
} from "../../api.js";
import {
  BundleEditor,
  EmailAction,
} from "../orders/OrderWorkspace.jsx";
import {
  centsToDollars,
  useLoad,
  Toolbar,
  AsyncState,
} from "../general/GeneralPages.jsx";

function InvoicesPage({ api, session }) {
  const invoices = useLoad(() => api.get("/invoices"), []);
  const [payment, setPayment] = useState({});
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  const canRecordPayment = ["owner", "admin", "manager"].includes(session.user.role);
  async function record(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/invoices/${id}/payment`, { amount_paid_cents: cents(payment[id] || 0), note: "Payment information is manually recorded." });
      invoices.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setDocumentStatus(id, document_status) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/invoices/${id}/document-status`, { document_status });
      invoices.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function downloadInvoice(id, number) {
    setAction({ busy: true, error: "" });
    try {
      await api.download(`/invoices/${id}/pdf`, `${number}.pdf`);
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function editBundles(id) {
    setAction({ busy: true, error: "" });
    try {
      setEditingInvoice(await api.get(`/invoices/${id}`));
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  return (
    <section className="panel">
      <Toolbar title="Invoices" />
      <div className="notice">Payment information is manually recorded.</div>
      {action.error && <div className="error-state">{action.error}</div>}
      <AsyncState state={invoices} empty="No invoices found">
        <div className="record-list">
          {(invoices.data?.items || []).map((invoice) => (
            <article className="record-row" key={invoice.id}>
              <div><strong>{invoice.invoice_number}</strong><span>{invoice.document_status} / {invoice.payment_status}</span></div>
              <span>{money(invoice.balance_due_cents)}</span>
              <select value={invoice.document_status} disabled={action.busy} onChange={(event) => setDocumentStatus(invoice.id, event.target.value)}>
                {["draft", "issued", "void"].map((status) => <option key={status}>{status}</option>)}
              </select>
              {canRecordPayment && <input className="money-input" value={payment[invoice.id] || ""} onChange={(event) => setPayment({ ...payment, [invoice.id]: event.target.value })} placeholder="Amount paid" />}
              {canRecordPayment && <button disabled={action.busy} onClick={() => record(invoice.id)}><Save size={14} />Record</button>}
              <button disabled={action.busy} onClick={() => editBundles(invoice.id)}><ReceiptText size={14} />Bundles</button>
              <EmailAction api={api} endpoint={`/invoices/${invoice.id}/send-email`} title={`Send ${invoice.invoice_number}`} defaultSubject={`Invoice ${invoice.invoice_number}`} defaultBody="Please review the attached invoice.">Email</EmailAction>
              <button disabled={action.busy} onClick={() => downloadInvoice(invoice.id, invoice.invoice_number)}><Download size={14} />PDF</button>
            </article>
          ))}
        </div>
      </AsyncState>
      {editingInvoice && <BundleEditor api={api} documentType="invoice" documentId={editingInvoice.id} items={editingInvoice.items || []} bundles={editingInvoice.bundles || []} locked={editingInvoice.document_status !== "draft"} onSaved={async () => setEditingInvoice(await api.get(`/invoices/${editingInvoice.id}`))} />}
    </section>
  );
}

function PaymentsPage({ api, session }) {
  const invoices = useLoad(() => api.get("/invoices"), []);
  const [payment, setPayment] = useState({});
  const [filter, setFilter] = useState("open");
  const [action, setAction] = useState({ busy: false, error: "" });
  const canRecordPayment = ["owner", "admin", "manager"].includes(session.user.role);
  const rows = useMemo(() => {
    const items = invoices.data?.items || [];
    if (filter === "paid") return items.filter((invoice) => invoice.payment_status === "paid");
    if (filter === "partial") return items.filter((invoice) => invoice.payment_status === "partial");
    if (filter === "open") return items.filter((invoice) => invoice.payment_status !== "paid" && invoice.document_status !== "void");
    return items;
  }, [filter, invoices.data]);
  function associationFor(invoice) {
    const customer = invoice.customer_summary?.business_name || invoice.customer_summary?.contact_name || "";
    const order = invoice.order_number || invoice.order_title || "";
    if (customer && order) return `${customer} / ${order}`;
    return customer || order || "No linked customer/order";
  }
  function paymentInputValue(invoice) {
    return payment[invoice.id] ?? centsToDollars(invoice.amount_paid_cents);
  }
  function paymentValidation(invoice) {
    const raw = String(paymentInputValue(invoice)).trim();
    if (!raw) return "Enter total amount paid.";
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return "Enter a valid total amount paid.";
    const amountCents = cents(raw);
    if (amountCents < 0) return "Total amount paid cannot be negative.";
    if (amountCents > invoice.total_cents) return "Total amount paid cannot exceed invoice total.";
    if ((invoice.amount_paid_cents || 0) > 0 && amountCents < invoice.amount_paid_cents) return "Total amount paid cannot be less than the current paid amount.";
    return "";
  }
  async function record(invoice) {
    const validation = paymentValidation(invoice);
    if (validation) {
      setAction({ busy: false, error: validation });
      return;
    }
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/invoices/${invoice.id}/payment`, { amount_paid_cents: cents(paymentInputValue(invoice)), note: "Payment information is manually recorded as the cumulative paid-to-date amount." });
      invoices.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <section className="panel">
      <Toolbar title="Payments">
        <select aria-label="Payment status filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="open">Open balances</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="all">All invoices</option>
        </select>
      </Toolbar>
      <div className="notice">Payment information is manually recorded against invoices. Total amount paid is cumulative paid-to-date, not a new transaction amount.</div>
      {action.error && <div className="error-state">{action.error}</div>}
      <AsyncState state={invoices} empty="No invoices found">
        {rows.length === 0 ? <div className="empty-state">No payments match the current filter</div> : (
          <div className="record-list">
            {rows.map((invoice) => (
              <article className="record-row" key={invoice.id}>
                <div><strong>{invoice.invoice_number}</strong><span>{associationFor(invoice)}</span></div>
                <span>Balance {money(invoice.balance_due_cents)}</span>
                <span>Total {money(invoice.total_cents)}</span>
                <span>Paid {money(invoice.amount_paid_cents)}</span>
                <span>Payment {invoice.payment_status}</span>
                {canRecordPayment && <input className="money-input" aria-label={`Total amount paid for ${invoice.invoice_number}`} type="number" min="0" step="0.01" value={paymentInputValue(invoice)} onChange={(event) => setPayment({ ...payment, [invoice.id]: event.target.value })} placeholder="Total amount paid" />}
                {canRecordPayment && <button disabled={action.busy || Boolean(paymentValidation(invoice))} onClick={() => record(invoice)}><Save size={14} />Record Payment</button>}
                <a href="#/invoices"><ReceiptText size={14} />Invoices</a>
              </article>
            ))}
          </div>
        )}
      </AsyncState>
    </section>
  );
}

export {
  InvoicesPage,
  PaymentsPage,
};
