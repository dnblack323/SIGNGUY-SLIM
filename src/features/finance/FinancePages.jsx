import { useMemo, useState } from "react";
import { Download, FileText, Paperclip, Save, Trash2 } from "lucide-react";
import { cents, money } from "../../api.js";
import { AsyncState, Field, Toolbar, useLoad } from "../general/GeneralPages.jsx";

const today = () => new Date().toISOString().slice(0, 10);

const blankExpense = {
  expense_date: today(),
  vendor: "",
  category: "Materials",
  description: "",
  amount: "",
  payment_method: "credit_card",
};

function queryString(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function ExpensesPage({ api }) {
  const [filters, setFilters] = useState({ from: today().slice(0, 7) + "-01", to: today(), category: "", payment_method: "", search: "" });
  const [form, setForm] = useState(blankExpense);
  const [editing, setEditing] = useState(null);
  const [receiptFiles, setReceiptFiles] = useState({});
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const path = useMemo(() => `/expenses${queryString(filters)}`, [filters]);
  const state = useLoad(() => api.get(path), [path]);
  const rows = state.data?.items || [];

  async function saveExpense(event) {
    event.preventDefault();
    setAction({ busy: true, error: "", saved: "" });
    const payload = {
      expense_date: form.expense_date,
      vendor: form.vendor,
      category: form.category,
      description: form.description || null,
      amount_cents: cents(form.amount),
      payment_method: form.payment_method,
    };
    try {
      if (editing) {
        await api.patch(`/expenses/${editing.id}`, payload);
        setEditing(null);
      } else {
        await api.post("/expenses", payload);
      }
      setForm(blankExpense);
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Expense saved" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  function startEdit(expense) {
    setEditing(expense);
    setForm({
      expense_date: expense.expense_date,
      vendor: expense.vendor,
      category: expense.category,
      description: expense.description || "",
      amount: ((expense.amount_cents || 0) / 100).toFixed(2),
      payment_method: expense.payment_method,
    });
  }

  async function archive(expense) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.delete(`/expenses/${expense.id}`);
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Expense archived" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function uploadReceipt(expense) {
    const file = receiptFiles[expense.id];
    if (!file) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/expenses/${expense.id}/attachment`, file);
      setReceiptFiles({ ...receiptFiles, [expense.id]: null });
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Receipt uploaded" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function removeReceipt(expense) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.delete(`/expenses/${expense.id}/attachment`);
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Receipt removed" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function downloadReceipt(expense) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.download(`/expenses/${expense.id}/attachment/download`, expense.attachment?.original_filename || "receipt");
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  const categories = state.data?.categories || ["Materials", "Subcontractor", "Equipment", "Vehicle", "Rent", "Utilities", "Software", "Marketing", "Office", "Insurance", "Payroll", "Taxes", "Other"];
  const paymentMethods = state.data?.payment_methods || ["cash", "check", "credit_card", "debit_card", "ach", "bank_transfer", "other"];
  return (
    <section className="panel">
      <Toolbar title="Expenses" />
      <div className="notice">Expenses are simple internal bookkeeping records. Slim does not connect to bank or card accounts.</div>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <form className="form-grid" onSubmit={saveExpense}>
        <h2>{editing ? "Edit Expense" : "New Expense"}</h2>
        <Field label="Expense date" type="date" value={form.expense_date} onChange={(expense_date) => setForm({ ...form, expense_date })} />
        <Field label="Vendor" value={form.vendor} onChange={(vendor) => setForm({ ...form, vendor })} />
        <label className="field">
          <span>Category</span>
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Amount</span>
          <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </label>
        <label className="field">
          <span>Payment method</span>
          <select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}>
            {paymentMethods.map((method) => <option value={method} key={method}>{method.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <Field label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        <button className="primary-button" disabled={action.busy || !form.vendor.trim() || cents(form.amount) <= 0}><Save size={16} />{editing ? "Save Expense" : "Add Expense"}</button>
        {editing && <button type="button" disabled={action.busy} onClick={() => { setEditing(null); setForm(blankExpense); }}>Cancel</button>}
      </form>
      <section className="form-grid">
        <h2>Filters</h2>
        <Field label="From" type="date" value={filters.from} onChange={(from) => setFilters({ ...filters, from })} />
        <Field label="To" type="date" value={filters.to} onChange={(to) => setFilters({ ...filters, to })} />
        <label className="field"><span>Category</span><select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">All</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="field"><span>Payment method</span><select value={filters.payment_method} onChange={(event) => setFilters({ ...filters, payment_method: event.target.value })}><option value="">All</option>{paymentMethods.map((method) => <option value={method} key={method}>{method.replace(/_/g, " ")}</option>)}</select></label>
        <Field label="Search" value={filters.search} onChange={(search) => setFilters({ ...filters, search })} />
      </section>
      <AsyncState state={state} empty="No expenses found">
        <div className="dashboard-grid">
          <article className="metric-card"><span>Total</span><strong>{money(state.data?.summary?.total_cents)}</strong></article>
          <article className="metric-card"><span>Records</span><strong>{state.data?.summary?.count || 0}</strong></article>
        </div>
        <div className="record-list">
          {rows.map((expense) => (
            <article className="record-row" key={expense.id}>
              <div><strong>{expense.vendor}</strong><span>{expense.expense_date} / {expense.category}</span></div>
              <span>{money(expense.amount_cents)}</span>
              <span>{expense.payment_method.replace(/_/g, " ")}</span>
              <button type="button" disabled={action.busy} onClick={() => startEdit(expense)}><FileText size={14} />Edit</button>
              {expense.attachment ? (
                <>
                  <button type="button" disabled={action.busy} onClick={() => downloadReceipt(expense)}><Download size={14} />Receipt</button>
                  <button type="button" disabled={action.busy} onClick={() => removeReceipt(expense)}><Trash2 size={14} />Remove Receipt</button>
                </>
              ) : (
                <>
                  <label className="field compact-field"><span>Receipt</span><input aria-label={`Receipt for ${expense.vendor}`} type="file" onChange={(event) => setReceiptFiles({ ...receiptFiles, [expense.id]: event.target.files?.[0] || null })} /></label>
                  <button type="button" disabled={action.busy || !receiptFiles[expense.id]} onClick={() => uploadReceipt(expense)}><Paperclip size={14} />Attach</button>
                </>
              )}
              <button type="button" disabled={action.busy} onClick={() => archive(expense)}><Trash2 size={14} />Archive</button>
            </article>
          ))}
        </div>
      </AsyncState>
    </section>
  );
}

function SalesTaxPage({ api }) {
  const [filters, setFilters] = useState({ period: "month", year: today().slice(0, 4), month: today().slice(5, 7), quarter: "1", from: today().slice(0, 7) + "-01", to: today() });
  const path = useMemo(() => `/sales-tax${queryString(filters)}`, [filters]);
  const state = useLoad(() => api.get(path), [path]);
  const summary = state.data?.summary || {};
  return (
    <section className="panel">
      <Toolbar title="Sales Tax" />
      <div className="notice">{state.data?.disclaimer || "Sales tax reporting is for internal tracking only. Slim does not file, remit, or provide tax advice."}</div>
      <section className="form-grid">
        <label className="field">
          <span>Period</span>
          <select value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })}>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="year">Yearly</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {filters.period !== "custom" && <label className="field"><span>Year</span><input type="number" min="2000" max="2100" value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} /></label>}
        {filters.period === "month" && <label className="field"><span>Month</span><input type="number" min="1" max="12" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} /></label>}
        {filters.period === "quarter" && <label className="field"><span>Quarter</span><input type="number" min="1" max="4" value={filters.quarter} onChange={(event) => setFilters({ ...filters, quarter: event.target.value })} /></label>}
        {filters.period === "custom" && <Field label="From" type="date" value={filters.from} onChange={(from) => setFilters({ ...filters, from })} />}
        {filters.period === "custom" && <Field label="To" type="date" value={filters.to} onChange={(to) => setFilters({ ...filters, to })} />}
      </section>
      <AsyncState state={state} empty="No issued invoices in this period">
        <div className="dashboard-grid">
          <article className="metric-card"><span>Taxable Sales</span><strong>{money(summary.taxable_sales_cents)}</strong></article>
          <article className="metric-card"><span>Non-taxable Sales</span><strong>{money(summary.non_taxable_sales_cents)}</strong></article>
          <article className="metric-card"><span>Tax Collected</span><strong>{money(summary.tax_collected_cents)}</strong></article>
          <article className="metric-card"><span>Gross Sales</span><strong>{money(summary.gross_sales_cents)}</strong></article>
          <article className="metric-card"><span>Included Docs</span><strong>{summary.document_count || 0}</strong></article>
        </div>
        {summary.unknown_sales_cents > 0 && <div className="notice">Some invoice item splits could not be derived; affected sales are listed as unknown and should be reviewed before filing.</div>}
        <div className="record-list">
          {(state.data?.documents || []).map((invoice) => (
            <article className="record-row" key={invoice.id}>
              <div><strong>{invoice.invoice_number}</strong><span>{invoice.document_date} / {invoice.customer_summary?.business_name || invoice.customer_summary?.contact_name || "Customer"}</span></div>
              <span>Taxable {invoice.taxable_sales_cents === null ? "Unknown" : money(invoice.taxable_sales_cents)}</span>
              <span>Non-taxable {invoice.non_taxable_sales_cents === null ? "Unknown" : money(invoice.non_taxable_sales_cents)}</span>
              <span>Tax {money(invoice.tax_cents)}</span>
              <span>Total {money(invoice.total_cents)}</span>
            </article>
          ))}
        </div>
      </AsyncState>
    </section>
  );
}

export {
  ExpensesPage,
  SalesTaxPage,
};
