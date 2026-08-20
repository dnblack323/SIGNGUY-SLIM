import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Delete,
  Download,
  FileText,
  Plus,
  ReceiptText,
  Save,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserPlus,
} from "lucide-react";
import { apiRequest, cents, downloadApiFile, money } from "./api.js";
import { enabledNavigationItems, enabledRibbonActions } from "./navigation.js";

const blankAddress = { line1: "", line2: "", city: "", state: "", postal_code: "", country: "US" };
const blankItem = {
  description: "",
  quantity_decimal: "1",
  unit_price: "0.00",
  taxable: true,
  production_required: false,
  due_date: "",
  assigned_user_id: "",
  internal_note: "",
};
const SESSION_KEY = "signguySlimSession";

function clientSideId() {
  return globalThis.crypto?.randomUUID?.() || `quick-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newQuickItem(overrides = {}) {
  return { ...blankItem, client_id: clientSideId(), ...overrides };
}

function readStoredSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.access_token !== "string" ||
      typeof parsed?.user?.role !== "string" ||
      typeof parsed?.tenant?.company_name !== "string"
    ) throw new Error("Invalid stored session");
    return parsed;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function LogoMark() {
  return <div className="logo-mark" aria-hidden="true">SG</div>;
}

function useRoute() {
  const [route, setRoute] = useState(() => window.location.hash.replace("#", "") || "/");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace("#", "") || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function Field({ label, value, onChange, type = "text", disabled = false, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input type={type} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}

function SelectField({ label, value, onChange, disabled = false, describedBy = "", children }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ""} disabled={disabled} aria-describedby={describedBy || undefined} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

function AuthScreen({ onSession }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    tenant_name: "Acme Signs",
    tenant_slug: "acme-signs",
    owner_name: "Owner",
    owner_email: "owner@example.com",
    owner_password: "",
    email: "owner@example.com",
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session =
        mode === "register"
          ? await apiRequest("/auth/register", {
              method: "POST",
              body: {
                tenant_name: form.tenant_name,
                tenant_slug: form.tenant_slug,
                owner_name: form.owner_name,
                owner_email: form.owner_email,
                owner_password: form.owner_password,
              },
            })
          : await apiRequest("/auth/login", {
              method: "POST",
              body: { tenant_slug: form.tenant_slug, email: form.email, password: form.password },
            });
      onSession(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={submit}>
        <LogoMark />
        <h1>SignGuy Slim</h1>
        <div className="segmented">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register</button>
        </div>
        {mode === "register" && (
          <>
            <Field label="Company" value={form.tenant_name} onChange={(tenant_name) => setForm({ ...form, tenant_name })} />
            <Field label="Owner name" value={form.owner_name} onChange={(owner_name) => setForm({ ...form, owner_name })} />
            <Field label="Owner email" type="email" value={form.owner_email} onChange={(owner_email) => setForm({ ...form, owner_email })} />
            <Field label="Owner password" type="password" value={form.owner_password} onChange={(owner_password) => setForm({ ...form, owner_password })} />
          </>
        )}
        <Field label="Shop slug" value={form.tenant_slug} onChange={(tenant_slug) => setForm({ ...form, tenant_slug })} />
        {mode === "login" && (
          <>
            <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <Field label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          </>
        )}
        {error && <div className="error-state">{error}</div>}
        <button className="primary-button" disabled={busy}><ShieldCheck size={16} />{busy ? "Working" : "Continue"}</button>
      </form>
    </main>
  );
}

function App() {
  const route = useRoute();
  const [session, setSessionState] = useState(readStoredSession);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  function setSession(next) {
    setSessionState(next);
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  }
  const api = useMemo(
    () => ({
      get: (path) => apiRequest(path, { token: session?.access_token }),
      post: (path, body) => apiRequest(path, { token: session?.access_token, method: "POST", body }),
      patch: (path, body) => apiRequest(path, { token: session?.access_token, method: "PATCH", body }),
      download: (path, filename) => downloadApiFile(path, { token: session?.access_token, filename }),
    }),
    [session],
  );
  useEffect(() => {
    async function restore() {
      if (!session?.access_token) {
        setSessionChecked(true);
        return;
      }
      try {
        const restored = await apiRequest("/auth/me", { token: session.access_token });
        setSessionState({ ...session, ...restored, access_token: session.access_token });
      } catch {
        setSession(null);
      } finally {
        setSessionChecked(true);
      }
    }
    restore();
  }, []);
  async function logout() {
    try {
      if (session?.access_token) await apiRequest("/auth/logout", { token: session.access_token, method: "POST" });
    } finally {
      setSession(null);
    }
  }
  if (!sessionChecked) return <main className="auth-screen"><div className="loading-state">Loading</div></main>;
  if (!session) return <AuthScreen onSession={setSession} />;

  const visibleNav = enabledNavigationItems();
  const ribbonActions = enabledRibbonActions();
  const pageKey = route.split("/")[1] || "home";
  const title = visibleNav.find((item) => item.key === pageKey)?.label || "Home";

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand"><LogoMark /><div><strong>SignGuy Slim</strong><span>{session.tenant.company_name}</span></div></div>
        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return <a href={item.href} className={pageKey === item.key ? "nav-link active" : "nav-link"} key={item.key}><Icon size={18} /><span>{item.label}</span></a>;
          })}
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p>Shop Operations</p><h1>{title}</h1></div>
          <div className="topbar-actions">
            <span className="status-pill"><ShieldCheck size={16} />{session.user.role}</span>
            <button onClick={logout}>Logout</button>
          </div>
        </header>
        <div className="ribbon" aria-label="Quick access ribbon">
          {ribbonActions.map((action) => {
            const Icon = action.icon;
            if (action.key === "calculator") {
              return <button className="ribbon-button" key={action.key} onClick={() => setCalculatorOpen(true)}><Icon size={18} /><span>{action.label}</span></button>;
            }
            return <a href={`#/${action.requiresRoute}`} className="ribbon-button" key={action.key}><Icon size={18} /><span>{action.label}</span></a>;
          })}
        </div>
        {pageKey === "customers" && <CustomersPage api={api} />}
        {pageKey === "estimates" && <EstimatesPage api={api} />}
        {pageKey === "orders" && <OrdersPage api={api} />}
        {pageKey === "invoices" && <InvoicesPage api={api} session={session} />}
        {pageKey === "settings" && <SettingsPage api={api} session={session} onSession={setSession} />}
        {pageKey === "home" && <HomePage />}
      </section>
      {calculatorOpen && <CalculatorModal onClose={() => setCalculatorOpen(false)} />}
    </main>
  );
}

function HomePage() {
  return (
    <section className="metrics-grid" aria-label="Home summary">
      <Metric icon={UserPlus} label="Customers" value="Active records" />
      <Metric icon={FileText} label="Estimates" value="Quick Entry" />
      <Metric icon={ShoppingBag} label="Orders" value="Direct and converted" />
      <Metric icon={ReceiptText} label="Invoices" value="Manual payment status" />
    </section>
  );
}

function Metric({ icon: Icon, label, value }) {
  return <article className="panel metric"><Icon size={22} /><span>{label}</span><strong>{value}</strong></article>;
}

function useLoad(loader, deps) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  async function refresh() {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      setState({ loading: false, error: "", data: await loader() });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }
  useEffect(() => { refresh(); }, deps);
  return { ...state, refresh };
}

function CustomersPage({ api }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [form, setForm] = useState({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
  const [editingId, setEditingId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  const state = useLoad(() => api.get(`/customers?search=${encodeURIComponent(search)}&status=${status}`), [search, status]);
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      const payload = { ...form, email: form.email || null, phone: form.phone || null, tax_exemption_note: form.tax_exemption_note || null, internal_notes: form.internal_notes || null };
      if (editingId) await api.patch(`/customers/${editingId}`, payload);
      else await api.post("/customers", payload);
      setEditingId("");
      setSelectedCustomer(null);
      setForm({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function edit(id) {
    setAction({ busy: true, error: "" });
    try {
      const customer = await api.get(`/customers/${id}`);
      setSelectedCustomer(customer);
      setEditingId(id);
      setForm({
        contact_name: customer.contact_name,
        business_name: customer.business_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
        billing_address: customer.billing_address,
        active: customer.active,
        tax_exempt: customer.tax_exempt,
        tax_exemption_note: customer.tax_exemption_note || "",
        internal_notes: customer.internal_notes || "",
      });
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <TwoColumn>
      <section className="panel">
        <Toolbar title="Customers">
          <input placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={state} empty="No customers found">
          <RecordList items={state.data?.items || []} primary="contact_name" secondary={(item) => item.business_name || item.customer_number} amount={(item) => item.tax_exempt ? "Tax exempt" : "Taxable"} actions={(item) => (
            <button onClick={() => edit(item.id)}><Save size={14} />Edit</button>
          )} />
        </AsyncState>
      </section>
      <form className="panel form-grid" onSubmit={save}>
        <Toolbar title={editingId ? "Edit Customer" : "Customer"}>
          {editingId && <button type="button" onClick={() => { setEditingId(""); setSelectedCustomer(null); setForm({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" }); }}>New</button>}
        </Toolbar>
        <Field label="Contact name" value={form.contact_name} onChange={(contact_name) => setForm({ ...form, contact_name })} />
        <Field label="Business name" value={form.business_name} onChange={(business_name) => setForm({ ...form, business_name })} />
        <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        {form.email && <a className="inline-link" href={`mailto:${form.email}`}>{form.email}</a>}
        <Field label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
        {form.phone && <a className="inline-link" href={`tel:${form.phone}`}>{form.phone}</a>}
        <AddressFields address={form.billing_address} setAddress={(billing_address) => setForm({ ...form, billing_address })} />
        <label className="check-row"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Active</label>
        <label className="check-row"><input type="checkbox" checked={form.tax_exempt} onChange={(event) => setForm({ ...form, tax_exempt: event.target.checked })} />Tax exempt</label>
        <Field label="Tax note" value={form.tax_exemption_note} onChange={(tax_exemption_note) => setForm({ ...form, tax_exemption_note })} />
        <Field label="Internal notes" value={form.internal_notes} onChange={(internal_notes) => setForm({ ...form, internal_notes })} />
        {selectedCustomer && <RelatedRecords customer={selectedCustomer} />}
        <button className="primary-button" disabled={action.busy}><Save size={16} />{editingId ? "Update Customer" : "Save Customer"}</button>
      </form>
    </TwoColumn>
  );
}

function RelatedRecords({ customer }) {
  return (
    <section className="related-records">
      <h3>Related Estimates</h3>
      {(customer.related_estimates || []).map((item) => <span key={item.id}>{item.estimate_number} {item.status}</span>)}
      <h3>Related Orders</h3>
      {(customer.related_orders || []).map((item) => <span key={item.id}>{item.order_number} {item.status}</span>)}
    </section>
  );
}

function AddressFields({ address, setAddress, disabled = false }) {
  return (
    <>
      <Field label="Address line 1" value={address.line1} disabled={disabled} onChange={(line1) => setAddress({ ...address, line1 })} />
      <Field label="Address line 2" value={address.line2 || ""} disabled={disabled} onChange={(line2) => setAddress({ ...address, line2 })} />
      <Field label="City" value={address.city} disabled={disabled} onChange={(city) => setAddress({ ...address, city })} />
      <Field label="State" value={address.state} disabled={disabled} onChange={(state) => setAddress({ ...address, state })} />
      <Field label="Postal code" value={address.postal_code} disabled={disabled} onChange={(postal_code) => setAddress({ ...address, postal_code })} />
      <Field label="Country" value={address.country} disabled={disabled} onChange={(country) => setAddress({ ...address, country })} />
    </>
  );
}

function EstimatesPage({ api }) {
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const estimates = useLoad(() => api.get("/estimates"), []);
  const [form, setForm] = useState({ customer_id: "", document_date: new Date().toISOString().slice(0, 10), expires_at: "", follow_up_at: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] });
  const [editingId, setEditingId] = useState("");
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      if (editingId) await api.patch(`/estimates/${editingId}`, documentPayload(form));
      else await api.post("/estimates", documentPayload(form));
      setEditingId("");
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function edit(id) {
    setAction({ busy: true, error: "" });
    try {
      const estimate = await api.get(`/estimates/${id}`);
      setEditingId(id);
      setForm({
        customer_id: estimate.customer_id,
        document_date: estimate.document_date,
        expires_at: estimate.expires_at || "",
        follow_up_at: estimate.follow_up_at || "",
        status: estimate.status,
        discount: String((estimate.discount_cents || 0) / 100),
        internal_notes: estimate.internal_notes || "",
        items: estimate.items.map((entry) => newQuickItem({
          description: entry.description,
          quantity_decimal: entry.quantity_decimal,
          unit_price: String(entry.unit_price_cents / 100),
          taxable: entry.taxable,
          production_required: entry.production_required,
          due_date: entry.due_date || "",
          assigned_user_id: entry.assigned_user_id || "",
          internal_note: entry.internal_note || "",
        })),
      });
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function convert(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/estimates/${id}/convert`, {});
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function duplicate(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/estimates/${id}/duplicate`, {});
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function downloadEstimate(id, number) {
    setAction({ busy: true, error: "" });
    try {
      await api.download(`/estimates/${id}/pdf`, `${number}.pdf`);
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <TwoColumn wide>
      <section className="panel">
        <Toolbar title="Estimates" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={estimates} empty="No estimates found">
          <RecordList items={estimates.data?.items || []} primary="estimate_number" secondary={(item) => item.status} amount={(item) => money(item.total_cents)} actions={(item) => (
            <>
              <button disabled={action.busy} onClick={() => duplicate(item.id)}><Copy size={14} />Duplicate</button>
              <button disabled={action.busy} onClick={() => edit(item.id)}><Save size={14} />Edit</button>
              <button disabled={action.busy} onClick={() => convert(item.id)}><ShoppingBag size={14} />Convert</button>
              <button disabled={action.busy} onClick={() => downloadEstimate(item.id, item.estimate_number)}><Download size={14} />PDF</button>
            </>
          )} />
        </AsyncState>
      </section>
      <DocumentForm title={editingId ? "Edit Estimate" : "Estimate"} form={form} setForm={setForm} customers={customers.data?.items || []} users={settings.data?.users || []} onSubmit={save} submitLabel={editingId ? "Update Estimate" : "Save Estimate"} disabled={action.busy} includeEstimateStatus customerLocked={Boolean(editingId)} customerLockMessage="Estimate customer is locked after creation." onNew={editingId ? () => { setEditingId(""); setForm({ customer_id: "", document_date: new Date().toISOString().slice(0, 10), expires_at: "", follow_up_at: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] }); } : null} />
    </TwoColumn>
  );
}

function OrdersPage({ api }) {
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const orders = useLoad(() => api.get("/orders"), []);
  const [form, setForm] = useState({ customer_id: "", document_date: new Date().toISOString().slice(0, 10), due_date: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] });
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      await api.post("/orders", documentPayload(form));
      orders.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
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
  return (
    <TwoColumn wide>
      <section className="panel">
        <Toolbar title="Orders" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={orders} empty="No orders found">
          <RecordList items={orders.data?.items || []} primary="order_number" secondary={(item) => item.status} amount={(item) => money(item.total_cents)} actions={(item) => (
            <>
              <select value={item.status} disabled={action.busy} onChange={(event) => setOrderStatus(item.id, event.target.value)}>
                {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
              </select>
              <button disabled={action.busy} onClick={() => invoice(item.id)}><ReceiptText size={14} />Create/Open Invoice</button>
            </>
          )} />
        </AsyncState>
      </section>
      <DocumentForm title="Order" form={form} setForm={setForm} customers={customers.data?.items || []} users={settings.data?.users || []} onSubmit={save} submitLabel="Save Order" includeDue includeStatus disabled={action.busy} />
    </TwoColumn>
  );
}

function InvoicesPage({ api, session }) {
  const invoices = useLoad(() => api.get("/invoices"), []);
  const [payment, setPayment] = useState({});
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
              <button disabled={action.busy} onClick={() => downloadInvoice(invoice.id, invoice.invoice_number)}><Download size={14} />PDF</button>
            </article>
          ))}
        </div>
      </AsyncState>
    </section>
  );
}

function SettingsPage({ api, session, onSession }) {
  const state = useLoad(() => api.get("/settings"), []);
  const [form, setForm] = useState(null);
  const [userForm, setUserForm] = useState({ display_name: "", email: "", password: "", role: "staff", active: true });
  const [action, setAction] = useState({ busy: false, error: "" });
  const canManageUsers = ["owner", "admin"].includes(session.user.role);
  const canEditSettings = ["owner", "admin"].includes(session.user.role);
  const roleOptions = session.user.role === "owner" ? ["staff", "manager", "admin", "owner"] : ["staff", "manager", "admin"];
  useEffect(() => { if (state.data?.tenant && !form) setForm({ ...state.data.tenant, address: state.data.tenant.address }); }, [state.data, form]);
  async function save(event) {
    event.preventDefault();
    if (!canEditSettings) return;
    setAction({ busy: true, error: "" });
    try {
      const updated = await api.patch("/settings", form);
      onSession({ ...session, tenant: updated.tenant });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function saveUser(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      await api.post("/users", userForm);
      setUserForm({ display_name: "", email: "", password: "", role: "staff", active: true });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setRole(id, role) {
    setAction({ busy: true, error: "" });
    try {
      await api.patch(`/users/${id}`, { role });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setActive(id, active) {
    setAction({ busy: true, error: "" });
    try {
      await api.patch(`/users/${id}`, { active });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  if (!form) return <AsyncState state={state} empty="Settings unavailable" />;
  return (
    <TwoColumn>
      <form className="panel form-grid" onSubmit={save}>
        <h2>Company Settings</h2>
        {!canEditSettings && <div className="notice">Company settings are read-only for your role.</div>}
        {action.error && <div className="error-state">{action.error}</div>}
        <Field label="Company name" value={form.company_name} disabled={!canEditSettings} onChange={(company_name) => setForm({ ...form, company_name })} />
        <Field label="Logo reference" value={form.logo_reference || ""} disabled={!canEditSettings} onChange={(logo_reference) => setForm({ ...form, logo_reference })} />
        <AddressFields address={form.address} disabled={!canEditSettings} setAddress={(address) => setForm({ ...form, address })} />
        <Field label="Contact email" value={form.contact_email || ""} disabled={!canEditSettings} onChange={(contact_email) => setForm({ ...form, contact_email })} />
        <Field label="Contact phone" value={form.contact_phone || ""} disabled={!canEditSettings} onChange={(contact_phone) => setForm({ ...form, contact_phone })} />
        <Field label="Sales tax basis points" type="number" value={form.sales_tax_rate_basis_points} disabled={!canEditSettings} onChange={(sales_tax_rate_basis_points) => setForm({ ...form, sales_tax_rate_basis_points: Number(sales_tax_rate_basis_points) })} />
        <Field label="Locale" value={form.locale} disabled={!canEditSettings} onChange={(locale) => setForm({ ...form, locale })} />
        <Field label="Currency" value={form.currency} disabled={!canEditSettings} onChange={(currency) => setForm({ ...form, currency })} />
        <Field label="Timezone" value={form.shop_timezone} disabled={!canEditSettings} onChange={(shop_timezone) => setForm({ ...form, shop_timezone })} />
        {canEditSettings && <button className="primary-button" disabled={action.busy}><Save size={16} />Save Settings</button>}
      </form>
      <section className="panel">
        <Toolbar title="Users" />
        {canManageUsers && <form className="inline-form" onSubmit={saveUser}>
          <input placeholder="Name" value={userForm.display_name} onChange={(event) => setUserForm({ ...userForm, display_name: event.target.value })} />
          <input placeholder="Email" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
          <input placeholder="Password" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
          <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
            {roleOptions.map((role) => <option key={role}>{role}</option>)}
          </select>
          <button disabled={action.busy}><UserPlus size={14} />Add User</button>
        </form>}
        <div className="record-list">
          {(state.data?.users || []).map((user) => (
            <article className="record-row" key={user.id}>
              <div><strong>{user.display_name}</strong><span>{user.email}</span></div>
              {canManageUsers ? (
                <>
                  <select value={user.role} disabled={action.busy || (user.role === "owner" && session.user.role !== "owner")} onChange={(event) => setRole(user.id, event.target.value)}>
                    {(user.role === "owner" && !roleOptions.includes("owner") ? ["owner", ...roleOptions] : roleOptions).map((role) => <option key={role}>{role}</option>)}
                  </select>
                  <label className="check-row"><input type="checkbox" checked={user.active} disabled={action.busy} onChange={(event) => setActive(user.id, event.target.checked)} />Active</label>
                </>
              ) : <span>{user.role}</span>}
            </article>
          ))}
        </div>
      </section>
    </TwoColumn>
  );
}

function DocumentForm({ title, form, setForm, customers, users = [], onSubmit, submitLabel, includeDue = false, includeStatus = false, includeEstimateStatus = false, disabled = false, customerLocked = false, customerLockMessage = "", onNew = null }) {
  const customerMessageId = customerLocked ? "customer-lock-message" : "";
  return (
    <form className="panel form-grid document-form" onSubmit={onSubmit}>
      <Toolbar title={title}>{onNew && <button type="button" onClick={onNew}>New</button>}</Toolbar>
      <SelectField label="Customer" value={form.customer_id} disabled={customerLocked} describedBy={customerMessageId} onChange={(customer_id) => setForm({ ...form, customer_id })}>
        <option value="">Select customer</option>
        {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.contact_name}</option>)}
      </SelectField>
      {customerLocked && <div id={customerMessageId} className="field-note">{customerLockMessage}</div>}
      <Field label="Document date" type="date" value={form.document_date} onChange={(document_date) => setForm({ ...form, document_date })} />
      {includeDue ? <Field label="Due date" type="date" value={form.due_date} onChange={(due_date) => setForm({ ...form, due_date })} /> : (
        <>
          <Field label="Expiration date" type="date" value={form.expires_at} onChange={(expires_at) => setForm({ ...form, expires_at })} />
          <Field label="Follow-up date" type="date" value={form.follow_up_at} onChange={(follow_up_at) => setForm({ ...form, follow_up_at })} />
        </>
      )}
      {includeStatus && (
        <SelectField label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })}>
          {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
        </SelectField>
      )}
      {includeEstimateStatus && (
        <SelectField label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })}>
          {["draft", "sent", "accepted", "declined", "expired"].map((status) => <option key={status}>{status}</option>)}
        </SelectField>
      )}
      <Field label="Discount" value={form.discount} onChange={(discount) => setForm({ ...form, discount })} />
      <QuickEntry items={form.items} users={users} onChange={(items) => setForm({ ...form, items })} />
      <Field label="Internal notes" value={form.internal_notes} onChange={(internal_notes) => setForm({ ...form, internal_notes })} />
      <button className="primary-button" disabled={disabled}><Save size={16} />{submitLabel}</button>
    </form>
  );
}

function QuickEntry({ items, users, onChange }) {
  function setItem(index, changes) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }
  function move(index, delta) {
    const copy = [...items];
    const target = index + delta;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  }
  return (
    <section className="quick-entry">
      <Toolbar title="Quick Entry">
        <button type="button" onClick={() => onChange([...items, newQuickItem()])}><Plus size={14} />Item</button>
      </Toolbar>
      {items.map((item, index) => (
        <article className="item-editor" key={item.client_id}>
          <Field label="Description" value={item.description} onChange={(description) => setItem(index, { description })} />
          <Field label="Qty" value={item.quantity_decimal} onChange={(quantity_decimal) => setItem(index, { quantity_decimal })} />
          <Field label="Unit price" value={item.unit_price} onChange={(unit_price) => setItem(index, { unit_price })} />
          <label className="check-row"><input type="checkbox" checked={item.taxable} onChange={(event) => setItem(index, { taxable: event.target.checked })} />Taxable</label>
          <label className="check-row"><input type="checkbox" checked={item.production_required} onChange={(event) => setItem(index, { production_required: event.target.checked })} />Production</label>
          <Field label="Due date" type="date" value={item.due_date} onChange={(due_date) => setItem(index, { due_date })} />
          <SelectField label="Assigned user" value={item.assigned_user_id} onChange={(assigned_user_id) => setItem(index, { assigned_user_id })}>
            <option value="">Unassigned</option>
            {users.filter((user) => user.active).map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
          </SelectField>
          <Field label="Item note" value={item.internal_note} onChange={(internal_note) => setItem(index, { internal_note })} />
          <div className="item-actions">
            <button type="button" title="Move up" onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
            <button type="button" title="Move down" onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
            <button type="button" title="Duplicate" onClick={() => onChange([...items.slice(0, index + 1), { ...item, client_id: clientSideId() }, ...items.slice(index + 1)])}><Copy size={14} /></button>
            <button type="button" title="Remove" onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
          </div>
        </article>
      ))}
    </section>
  );
}

function documentPayload(form) {
  return {
    customer_id: form.customer_id,
    document_date: form.document_date,
    due_date: form.due_date || null,
    expires_at: form.expires_at || null,
    follow_up_at: form.follow_up_at || null,
    status: form.status || "draft",
    discount_cents: cents(form.discount),
    internal_notes: form.internal_notes || null,
    items: form.items.map((item) => ({
      description: item.description,
      quantity_decimal: item.quantity_decimal,
      unit_price_cents: cents(item.unit_price),
      taxable: item.taxable,
      production_required: item.production_required,
      due_date: item.due_date || null,
      assigned_user_id: item.assigned_user_id || null,
      internal_note: item.internal_note || null,
    })),
  };
}

function Toolbar({ title, children }) {
  return <div className="toolbar"><h2>{title}</h2><div>{children}</div></div>;
}

function TwoColumn({ children, wide = false }) {
  return <section className={wide ? "two-column wide" : "two-column"}>{children}</section>;
}

function AsyncState({ state, empty, children }) {
  if (state.loading) return <div className="loading-state">Loading</div>;
  if (state.error) return <div className="error-state">{state.error}<button onClick={state.refresh}>Retry</button></div>;
  const items = state.data?.items;
  if (Array.isArray(items) && items.length === 0) return <div className="empty-state">{empty}</div>;
  return children;
}

function RecordList({ items, primary, secondary, amount, actions }) {
  return (
    <div className="record-list">
      {items.map((item) => (
        <article className="record-row" key={item.id}>
          <div><strong>{item[primary]}</strong><span>{typeof secondary === "function" ? secondary(item) : item[secondary]}</span></div>
          <span>{typeof amount === "function" ? amount(item) : item[amount]}</span>
          {actions && <div className="row-actions">{actions(item)}</div>}
        </article>
      ))}
    </div>
  );
}

function CalculatorModal({ onClose }) {
  const [display, setDisplay] = useState("0");
  const [left, setLeft] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(false);
  function input(value) {
    if (value === "C") {
      setDisplay("0"); setLeft(null); setOp(null); return;
    }
    if (value === "back") {
      setDisplay((current) => (current.length > 1 ? current.slice(0, -1) : "0")); return;
    }
    if (value === "+/-") {
      setDisplay((current) => (current.startsWith("-") ? current.slice(1) : `-${current}`)); return;
    }
    if (value === "%") {
      setDisplay((current) => String(Number(current) / 100)); return;
    }
    if (["+", "-", "*", "/"].includes(value)) {
      setLeft(Number(display)); setOp(value); setFresh(true); return;
    }
    if (value === "=") {
      const right = Number(display);
      const result = op === "+" ? left + right : op === "-" ? left - right : op === "*" ? left * right : op === "/" ? left / right : right;
      setDisplay(Number.isFinite(result) ? String(result) : "Error");
      setLeft(null); setOp(null); setFresh(true); return;
    }
    setDisplay((current) => {
      if (fresh) {
        setFresh(false);
        return value === "." ? "0." : value;
      }
      if (value === "." && current.includes(".")) return current;
      return current === "0" && value !== "." ? value : `${current}${value}`;
    });
  }
  useEffect(() => {
    const handler = (event) => {
      const key = event.key === "Enter" ? "=" : event.key === "Backspace" ? "back" : event.key;
      if ("0123456789.+-*/=%".includes(key) || key === "back") input(key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const buttons = ["C", "back", "+/-", "/", "7", "8", "9", "*", "4", "5", "6", "-", "1", "2", "3", "+", "%", "0", ".", "="];
  return (
    <div className="modal-backdrop">
      <section className="calculator-modal" role="dialog" aria-modal="true" aria-label="Calculator">
        <div className="toolbar"><h2>Calculator</h2><button onClick={onClose}>Close</button></div>
        <output>{display}</output>
        <div className="calculator-grid">
          {buttons.map((button) => <button key={button} onClick={() => input(button)}>{button === "back" ? <Delete size={16} /> : button}</button>)}
        </div>
        <button className="primary-button" onClick={() => navigator.clipboard?.writeText(display)}><Copy size={16} />Copy Result</button>
      </section>
    </div>
  );
}

export default App;
