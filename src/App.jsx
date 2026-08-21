import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Copy,
  Delete,
  Download,
  FileText,
  KeyRound,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Upload,
  XCircle,
  UserPlus,
} from "lucide-react";
import { apiRequest, blobApiFile, cents, downloadApiFile, money, uploadApiFile } from "./api.js";
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
const PRODUCTION_STAGES = ["not_started", "ready", "in_progress", "waiting", "complete"];
const STAGE_LABELS = {
  not_started: "Not Started",
  ready: "Ready",
  in_progress: "In Progress",
  waiting: "Waiting",
  complete: "Complete",
};
const CALENDAR_STATUSES = ["scheduled", "complete", "cancelled"];
const LINKED_RECORD_TYPES = ["all", "none", "order", "order_item"];

function dateOnly(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(dateString) {
  return `${dateString.slice(0, 8)}01`;
}

function monthEndExclusive(dateString) {
  const date = new Date(`${monthStart(dateString)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function weekStart(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
}

function formatEventTime(event) {
  if (event.all_day) return "All day";
  return `${event.local_start_time || String(event.start_at).slice(11, 16)}-${event.local_end_time || String(event.end_at).slice(11, 16)}`;
}

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
  const routeRef = useRef(route);
  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash.replace("#", "") || "/";
      const nextHash = `#${next}`;
      if (window.__signguyWorkspaceBypassHash === nextHash) {
        delete window.__signguyWorkspaceBypassHash;
      } else if (next !== routeRef.current && window.__signguyWorkspaceCanLeave && !window.__signguyWorkspaceCanLeave()) {
        window.setTimeout(() => {
          window.location.hash = `#${routeRef.current}`;
        }, 0);
        return;
      }
      routeRef.current = next;
      setRoute(next);
    };
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
      delete: (path) => apiRequest(path, { token: session?.access_token, method: "DELETE" }),
      upload: (path, file, fields) => uploadApiFile(path, { token: session?.access_token, file, fields }),
      blob: (path) => blobApiFile(path, { token: session?.access_token }),
      download: (path, filename, options = {}) => downloadApiFile(path, { token: session?.access_token, filename, ...options }),
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
  const routeParts = route.split("/").filter(Boolean);
  const pageKey = routeParts[0] || "home";
  const workspaceOrderId = pageKey === "orders" && routeParts[1] ? routeParts[1] : "";
  const workspaceReturnRoute = workspaceOrderId && routeParts[2] === "from-production" ? "production" : "orders";
  const workspaceReturnItemId = workspaceReturnRoute === "production" ? routeParts[3] || "" : "";

  useEffect(() => {
    if (workspaceOrderId || !window.__signguyWorkspaceFocusTarget) return;
    const target = window.__signguyWorkspaceFocusTarget;
    delete window.__signguyWorkspaceFocusTarget;
    let attempts = 0;
    const restore = () => {
      attempts += 1;
      const preferred = target.selector ? document.querySelector(target.selector) : null;
      const fallback = document.querySelector(".topbar h1") || document.querySelector(".ribbon-button") || document.querySelector("main");
      const node = preferred || (attempts > 10 ? fallback : null);
      if (node?.focus) {
        node.focus();
        return;
      }
      window.setTimeout(restore, 25);
    };
    window.setTimeout(restore, 0);
  }, [route, workspaceOrderId]);

  if (!sessionChecked) return <main className="auth-screen"><div className="loading-state">Loading</div></main>;
  if (!session) return <AuthScreen onSession={setSession} />;

  const visibleNav = enabledNavigationItems();
  const ribbonActions = enabledRibbonActions();
  const title = visibleNav.find((item) => item.key === pageKey)?.label || "Home";

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation" inert={workspaceOrderId ? true : undefined} aria-hidden={workspaceOrderId ? "true" : undefined}>
        <div className="brand"><LogoMark /><div><strong>SignGuy Slim</strong><span>{session.tenant.company_name}</span></div></div>
        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return <a href={item.href} className={pageKey === item.key ? "nav-link active" : "nav-link"} key={item.key}><Icon size={18} /><span>{item.label}</span></a>;
          })}
        </nav>
      </aside>
      <section className="workspace" inert={workspaceOrderId ? true : undefined} aria-hidden={workspaceOrderId ? "true" : undefined}>
        <header className="topbar">
          <div><p>Shop Operations</p><h1 tabIndex="-1">{title}</h1></div>
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
        {pageKey === "production" && <ProductionPage api={api} />}
        {pageKey === "calendar" && <CalendarPage api={api} />}
        {pageKey === "invoices" && <InvoicesPage api={api} session={session} />}
        {pageKey === "settings" && <SettingsPage api={api} session={session} onSession={setSession} />}
        {pageKey === "home" && <HomePage api={api} />}
      </section>
      {workspaceOrderId && <OrderWorkspace orderId={workspaceOrderId} api={api} returnRoute={workspaceReturnRoute} returnItemId={workspaceReturnItemId} onClose={() => {
        const targetHash = workspaceReturnRoute === "production" ? "#/production" : "#/orders";
        window.__signguyWorkspaceBypassHash = targetHash;
        window.__signguyWorkspaceFocusTarget = {
          selector: workspaceReturnRoute === "production" && workspaceReturnItemId
            ? `[data-focus-target="production-open-order-${workspaceReturnItemId}"]`
            : `[data-focus-target="order-open-${workspaceOrderId}"]`,
        };
        window.location.hash = targetHash;
      }} />}
      {calculatorOpen && <CalculatorModal onClose={() => setCalculatorOpen(false)} />}
    </main>
  );
}

function formatProgress(progress) {
  if (!progress || !progress.total) return "No production items";
  return `${progress.completed}/${progress.total} complete (${progress.percent}%)`;
}

function itemFromApi(entry) {
  return newQuickItem({
    id: entry.id,
    description: entry.description,
    quantity_decimal: entry.quantity_decimal,
    unit_price: String((entry.unit_price_cents || 0) / 100),
    taxable: entry.taxable,
    production_required: entry.production_required,
    production_stage: entry.production_stage || "not_started",
    completed: entry.completed,
    due_date: entry.due_date || "",
    assigned_user_id: entry.assigned_user_id || "",
    internal_note: entry.internal_note || "",
  });
}

function HomePage({ api }) {
  const state = useLoad(() => api.get("/dashboard"), []);
  return (
    <section className="dashboard-grid" aria-label="Home dashboard">
      <AsyncState state={state} empty="No dashboard data">
        <section className="panel dashboard-panel">
          <Toolbar title="Mini Production Board"><a href="#/production">Open Production</a></Toolbar>
          <div className="mini-board">
            {(state.data?.production?.stages || []).map((stage) => (
              <article className="mini-stage" key={stage.stage}>
                <h3>{stage.label}</h3>
                <strong>{stage.count}</strong>
                {stage.items.length === 0 ? <span>No active items</span> : stage.items.map((item) => (
                  <a href={`#/orders/${item.order_id}`} key={item.id}>{item.order_number} / {item.description}<small>{item.due_date ? `Due ${item.due_date}` : "No due date"}</small></a>
                ))}
              </article>
            ))}
          </div>
        </section>
        <section className="panel dashboard-panel">
          <Toolbar title="Rolling Two-Week Calendar"><a href="#/calendar">Open Full Calendar</a></Toolbar>
          <div className="rolling-calendar">
            {(state.data?.calendar?.days || []).map((day) => (
              <article className={day.today ? "day-strip today" : "day-strip"} key={day.date}>
                <strong>{day.today ? "Today" : formatDate(day.date)}</strong>
                {day.events.length === 0 ? <span>Open</span> : day.events.slice(0, 3).map((event) => <a href="#/calendar" key={event.id}>{event.title}</a>)}
              </article>
            ))}
          </div>
        </section>
        <section className="panel dashboard-panel attention-panel">
          <Toolbar title="Attention Panel" />
          {(state.data?.attention || []).length === 0 ? <div className="empty-state">No attention items</div> : (
            <div className="record-list">
              {state.data.attention.map((item) => (
                <a className={`attention-item ${item.severity.replace(/\s+/g, "-")}`} href={item.link} key={`${item.source_type}-${item.source_id}-${item.reason}`}>
                  <strong>{item.title}</strong>
                  <span>{item.reason.replace(/_/g, " ")} / {item.severity}{item.date ? ` / ${item.date}` : ""}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      </AsyncState>
    </section>
  );
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
          <RecordList items={orders.data?.items || []} primary="order_number" secondary={(item) => `${item.status} / ${formatProgress(item.production_progress)}`} amount={(item) => money(item.total_cents)} actions={(item) => (
            <>
              <button data-focus-target={`order-open-${item.id}`} onClick={() => { window.location.hash = `#/orders/${item.id}`; }}><FileText size={14} />Open</button>
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

function OrderWorkspace({ orderId, api, returnRoute, returnItemId, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const [preview, setPreview] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const dialogRef = useRef(null);
  const previewRef = useRef(null);

  async function load() {
    setState({ loading: true, error: "", data: null });
    try {
      const data = await api.get(`/orders/${orderId}/workspace`);
      setState({ loading: false, error: "", data });
      setForm({
        expected_updated_at: data.order.updated_at,
        document_date: data.order.document_date,
        due_date: data.order.due_date || "",
        status: data.order.status,
        discount: String((data.order.discount_cents || 0) / 100),
        internal_notes: data.order.internal_notes || "",
        items: data.order.items.map(itemFromApi),
      });
      setDirty(false);
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }

  useEffect(() => { load(); }, [orderId]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    const guard = () => !dirty || window.confirm("Discard unsaved Order Workspace changes?");
    window.__signguyWorkspaceCanLeave = guard;
    return () => {
      if (window.__signguyWorkspaceCanLeave === guard) delete window.__signguyWorkspaceCanLeave;
    };
  }, [dirty]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url);
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const keydown = (event) => {
      if (event.key === "Escape") requestClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", keydown);
    };
  }, [dirty]);
  useEffect(() => {
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
  }, [state.loading, state.error, action.saved]);

  function update(changes) {
    setDirty(true);
    setForm((current) => ({ ...current, ...changes }));
  }

  function requestClose() {
    if (window.__signguyWorkspaceCanLeave && !window.__signguyWorkspaceCanLeave()) return;
    onClose();
  }

  function replacePreview(next) {
    setPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return next;
    });
  }

  function setItem(index, changes) {
    update({ items: form.items.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  }

  function moveItem(index, delta) {
    const copy = [...form.items];
    const target = index + delta;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    update({ items: copy });
  }

  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const payload = {
        expected_updated_at: form.expected_updated_at,
        document_date: form.document_date,
        due_date: form.due_date || null,
        status: form.status,
        discount_cents: cents(form.discount),
        internal_notes: form.internal_notes || null,
        items: form.items.map((item) => ({
          id: item.id,
          description: item.description,
          quantity_decimal: item.quantity_decimal,
          unit_price_cents: cents(item.unit_price),
          taxable: item.taxable,
          production_required: item.production_required,
          production_stage: item.production_stage || "not_started",
          completed: item.completed || item.production_stage === "complete",
          due_date: item.due_date || null,
          assigned_user_id: item.assigned_user_id || null,
          internal_note: item.internal_note || null,
        })),
      };
      const data = await api.patch(`/orders/${orderId}/workspace`, payload);
      setState({ loading: false, error: "", data });
      setForm({ ...form, expected_updated_at: data.order.updated_at, items: data.order.items.map(itemFromApi) });
      setDirty(false);
      setAction({ busy: false, error: "", saved: "Saved" });
    } catch (err) {
      setAction({ busy: false, error: err.status === 409 ? "Order changed elsewhere. Reload before saving again." : err.message, saved: "" });
    }
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/orders/${orderId}/attachments`, file);
      const attachments = await api.get(`/orders/${orderId}/attachments`);
      setState((current) => ({ ...current, data: { ...current.data, attachments: attachments.items } }));
      setAction({ busy: false, error: "", saved: "Attachment uploaded" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    } finally {
      event.target.value = "";
    }
  }

  async function openAttachment(attachment, mode) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.blob(`/orders/${orderId}/attachments/${attachment.id}/${mode}`);
      const url = URL.createObjectURL(result.blob);
      if (mode === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.original_filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } else {
        replacePreview({ url, mime_type: attachment.mime_type, name: attachment.original_filename });
      }
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function deleteAttachment(attachment) {
    if (!window.confirm(`Delete ${attachment.original_filename}?`)) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.delete(`/orders/${orderId}/attachments/${attachment.id}`);
      setState((current) => ({ ...current, data: { ...current.data, attachments: current.data.attachments.filter((entry) => entry.id !== attachment.id) } }));
      if (preview?.name === attachment.original_filename) replacePreview(null);
      setAction({ busy: false, error: "", saved: "Attachment deleted" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  if (state.loading) return <div className="workspace-overlay"><section className="order-workspace" role="dialog" aria-modal="true" aria-label="Order Workspace" tabIndex="-1" ref={dialogRef}><div className="loading-state">Loading</div></section></div>;
  if (state.error) return <div className="workspace-overlay"><section className="order-workspace" role="dialog" aria-modal="true" aria-label="Order Workspace" tabIndex="-1" ref={dialogRef}><Toolbar title="Order Workspace"><button onClick={requestClose}>Close</button></Toolbar><div className="error-state">{state.error}</div></section></div>;

  const { order, customer, users, attachments } = state.data;
  const invoiced = Boolean(order.invoice);
  const activeUsers = users || [];
  return (
    <div className="workspace-overlay" aria-label="Order Workspace backdrop">
      <form className="order-workspace" role="dialog" aria-modal="true" aria-label={`Order Workspace ${order.order_number}`} tabIndex="-1" ref={dialogRef} onSubmit={save}>
        <header className="workspace-header">
          <div>
            <p>Order Workspace</p>
            <h2>{order.order_number}</h2>
          </div>
          <div className="workspace-header-grid">
            <span>Status: {order.status}</span>
            <span>Order date: {order.document_date}</span>
            <span>Due: {order.due_date || "None"}</span>
            <span>Customer: {customer.contact_name}</span>
            <span>Total: {money(order.total_cents)}</span>
            <span>Production: {formatProgress(order.production_progress)}</span>
            <span>Save state: {action.busy ? "Saving" : action.saved || (dirty ? "Unsaved" : "Current")}</span>
            <span>Return: {returnRoute === "production" ? "Production" : "Orders"}</span>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => setScheduleTarget({ type: "order", order })}><CalendarDays size={14} />Schedule Order</button>
            <button type="button" onClick={requestClose}>Close</button>
          </div>
        </header>
        {action.error && <div className="error-state">{action.error} {action.error.includes("Reload") && <button type="button" onClick={load}>Reload</button>}</div>}
        {invoiced && <div className="notice">Invoice {order.invoice.invoice_number} exists. Financial fields and item order are locked to keep invoice totals and PDFs consistent.</div>}
        <section className="workspace-section customer-summary">
          <h3>Customer Summary</h3>
          <span>{customer.contact_name}</span>
          <span>{customer.business_name || "No business name"}</span>
          <span>{customer.tax_exempt ? "Tax exempt" : "Taxable"}</span>
          {customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : <span>No email</span>}
          {customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : <span>No phone</span>}
          <span>{customer.billing_address.line1}, {customer.billing_address.city}, {customer.billing_address.state} {customer.billing_address.postal_code}</span>
        </section>
        <section className="workspace-section form-grid">
          <h3>Order Fields</h3>
          <Field label="Document date" type="date" value={form.document_date} onChange={(document_date) => update({ document_date })} />
          <Field label="Due date" type="date" value={form.due_date} onChange={(due_date) => update({ due_date })} />
          <SelectField label="Order status" value={form.status} onChange={(status) => update({ status })}>
            {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
          </SelectField>
          <Field label="Discount" value={form.discount} disabled={invoiced} onChange={(discount) => update({ discount })} />
          <Field label="Internal notes" value={form.internal_notes} onChange={(internal_notes) => update({ internal_notes })} />
        </section>
        <section className="workspace-section">
          <Toolbar title="Order Item Tasks">
            {!invoiced && <button type="button" onClick={() => update({ items: [...form.items, newQuickItem({ production_stage: "not_started", completed: false })] })}><Plus size={14} />Item</button>}
          </Toolbar>
          <div className="workspace-item-list">
            {form.items.map((item, index) => (
              <article className="workspace-item" key={item.client_id}>
                <Field label="Description" value={item.description} disabled={invoiced} onChange={(description) => setItem(index, { description })} />
                <Field label="Qty" value={item.quantity_decimal} disabled={invoiced} onChange={(quantity_decimal) => setItem(index, { quantity_decimal })} />
                <Field label="Unit price" value={item.unit_price} disabled={invoiced} onChange={(unit_price) => setItem(index, { unit_price })} />
                <span>Line: {money(cents(item.unit_price) * Number(item.quantity_decimal || 0))}</span>
                <label className="check-row"><input type="checkbox" checked={item.taxable} disabled={invoiced} onChange={(event) => setItem(index, { taxable: event.target.checked })} />Taxable</label>
                <label className="check-row"><input type="checkbox" checked={item.production_required} onChange={(event) => setItem(index, { production_required: event.target.checked })} />Production</label>
                <Field label="Due date" type="date" value={item.due_date} onChange={(due_date) => setItem(index, { due_date })} />
                <SelectField label="Assigned user" value={item.assigned_user_id} onChange={(assigned_user_id) => setItem(index, { assigned_user_id })}>
                  <option value="">Unassigned</option>
                  {activeUsers.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
                </SelectField>
                <SelectField label="Production stage" value={item.production_stage || "not_started"} onChange={(production_stage) => setItem(index, { production_stage, completed: production_stage === "complete" })}>
                  {PRODUCTION_STAGES.map((stage) => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}
                </SelectField>
                <label className="check-row"><input type="checkbox" checked={item.completed} onChange={(event) => setItem(index, { completed: event.target.checked, production_stage: event.target.checked ? "complete" : "in_progress" })} />Done</label>
                <Field label="Item note" value={item.internal_note} onChange={(internal_note) => setItem(index, { internal_note })} />
                <button type="button" onClick={() => setScheduleTarget({ type: "order_item", order, item })}><CalendarDays size={14} />Schedule</button>
                {!invoiced && <div className="item-actions">
                  <button type="button" title="Move up" onClick={() => moveItem(index, -1)}><ArrowUp size={14} /></button>
                  <button type="button" title="Move down" onClick={() => moveItem(index, 1)}><ArrowDown size={14} /></button>
                  <button type="button" title="Duplicate" onClick={() => update({ items: [...form.items.slice(0, index + 1), { ...item, id: undefined, client_id: clientSideId() }, ...form.items.slice(index + 1)] })}><Copy size={14} /></button>
                  <button type="button" title="Remove" onClick={() => window.confirm("Remove this item?") && update({ items: form.items.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
                </div>}
              </article>
            ))}
          </div>
        </section>
        <section className="workspace-section attachments">
          <Toolbar title="Attachments">
            <input aria-label="Upload attachment" type="file" onChange={upload} disabled={action.busy} />
          </Toolbar>
          {attachments.length === 0 ? <div className="empty-state">No attachments</div> : attachments.map((attachment) => (
            <article className="record-row" key={attachment.id}>
              <div><strong>{attachment.original_filename}</strong><span>{attachment.mime_type} / {attachment.byte_size} bytes</span></div>
              <span>{attachment.sha256.slice(0, 12)}</span>
              <div className="row-actions">
                {attachment.previewable && <button type="button" onClick={() => openAttachment(attachment, "preview")}>Preview</button>}
                <button type="button" onClick={() => openAttachment(attachment, "download")}><Download size={14} />Download</button>
                <button type="button" onClick={() => deleteAttachment(attachment)}><Trash2 size={14} />Delete</button>
              </div>
            </article>
          ))}
          {preview && <div className="attachment-preview">
            <Toolbar title={preview.name}><button type="button" onClick={() => replacePreview(null)}>Close Preview</button></Toolbar>
            {preview.mime_type.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : <iframe title={preview.name} src={preview.url} sandbox="" />}
          </div>}
        </section>
        <button className="primary-button" disabled={action.busy}><Save size={16} />Save Workspace</button>
      </form>
      {scheduleTarget && <ScheduleFromWorkspaceModal api={api} target={scheduleTarget} users={activeUsers} onClose={() => setScheduleTarget(null)} />}
    </div>
  );
}

function ScheduleFromWorkspaceModal({ api, target, users, onClose }) {
  const todayText = dateOnly();
  const linkedDate = target.item?.due_date || target.order.due_date || todayText;
  const [form, setForm] = useState({
    title: target.type === "order_item" ? target.item.description : target.order.order_number,
    start_at: `${linkedDate}T09:00`,
    end_at: `${linkedDate}T10:00`,
    all_day: false,
    assigned_user_id: target.item?.assigned_user_id || "",
    internal_note: "",
  });
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      await api.post("/calendar", {
        title: form.title,
        order_id: target.order.id,
        order_item_id: target.type === "order_item" ? target.item.id : null,
        start_at: form.start_at,
        end_at: form.end_at,
        all_day: form.all_day,
        assigned_user_id: form.assigned_user_id || null,
        internal_note: form.internal_note || null,
      });
      onClose();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  return (
    <div className="modal-backdrop">
      <form className="calendar-modal form-grid" role="dialog" aria-modal="true" aria-label="Schedule from Order Workspace" onSubmit={save}>
        <Toolbar title="Schedule"><button type="button" onClick={onClose}>Close</button></Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        <Field label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} />
        <label className="check-row"><input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked, start_at: event.target.checked ? String(form.start_at).slice(0, 10) : `${String(form.start_at).slice(0, 10)}T09:00`, end_at: event.target.checked ? addDays(String(form.end_at).slice(0, 10), 1) : `${String(form.end_at).slice(0, 10)}T10:00` })} />All day</label>
        <Field label="Start" type={form.all_day ? "date" : "datetime-local"} value={form.start_at} onChange={(start_at) => setForm({ ...form, start_at })} />
        <Field label="End" type={form.all_day ? "date" : "datetime-local"} value={form.end_at} onChange={(end_at) => setForm({ ...form, end_at })} />
        <SelectField label="Assigned user" value={form.assigned_user_id} onChange={(assigned_user_id) => setForm({ ...form, assigned_user_id })}>
          <option value="">Unassigned</option>
          {users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
        </SelectField>
        <Field label="Internal note" value={form.internal_note} onChange={(internal_note) => setForm({ ...form, internal_note })} />
        <button className="primary-button" disabled={action.busy}><CalendarDays size={16} />Create Event</button>
      </form>
    </div>
  );
}

function ProductionPage({ api }) {
  const [filters, setFilters] = useState({ stage: "all", assigned_user_id: "all", due_state: "all" });
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [action, setAction] = useState({ busy: false, error: "" });
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== "all")).toString();
  async function load() {
    setState({ loading: true, error: "", data: null });
    try {
      setState({ loading: false, error: "", data: await api.get(`/production/board${query ? `?${query}` : ""}`) });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }
  useEffect(() => { load(); }, [filters.stage, filters.assigned_user_id, filters.due_state]);
  async function move(item, stage) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/items/${item.id}/stage`, { stage });
      await load();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setDone(item, completed) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/items/${item.id}/completion`, { completed });
      await load();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  function shift(item, delta) {
    const current = PRODUCTION_STAGES.indexOf(item.production_stage);
    const next = PRODUCTION_STAGES[current + delta];
    if (next) move(item, next);
  }
  if (state.loading) return <div className="loading-state">Loading</div>;
  if (state.error) return <div className="error-state">{state.error}<button onClick={load}>Retry</button></div>;
  const items = state.data?.items || [];
  const users = state.data?.users || [];
  return (
    <section className="panel production-page">
      <Toolbar title="Production">
        <select aria-label="Filter stage" value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value })}>
          <option value="all">All stages</option>
          {PRODUCTION_STAGES.map((stage) => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}
        </select>
        <select aria-label="Filter assigned user" value={filters.assigned_user_id} onChange={(event) => setFilters({ ...filters, assigned_user_id: event.target.value })}>
          <option value="all">All users</option>
          <option value="unassigned">Unassigned</option>
          {users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
        </select>
        <select aria-label="Filter due state" value={filters.due_state} onChange={(event) => setFilters({ ...filters, due_state: event.target.value })}>
          <option value="all">All due states</option>
          <option value="late">Late</option>
        </select>
      </Toolbar>
      {action.error && <div className="error-state">{action.error}</div>}
      <div className="production-board">
        {PRODUCTION_STAGES.map((stage) => (
          <section className="production-column" key={stage} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            const item = items.find((entry) => entry.id === event.dataTransfer.getData("text/plain"));
            if (item) move(item, stage);
          }}>
            <h3>{STAGE_LABELS[stage]}</h3>
            {items.filter((item) => item.production_stage === stage).map((item) => (
              <article className={item.late ? "production-card late" : "production-card"} key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}>
                <strong>{item.order_number}</strong>
                <span>{item.customer_name}</span>
                <p>{item.description}</p>
                <span>Due: {item.due_date || "None"} {item.late ? "Late" : ""}</span>
                <span>{item.assigned_user?.display_name || "Unassigned"}</span>
                <span>{formatProgress(item.production_progress)}</span>
                <div className="row-actions">
                  <button type="button" aria-label={`Move ${item.description} left`} disabled={action.busy || PRODUCTION_STAGES.indexOf(item.production_stage) === 0} onClick={() => shift(item, -1)}><ArrowUp size={14} /></button>
                  <button type="button" aria-label={`Move ${item.description} right`} disabled={action.busy || PRODUCTION_STAGES.indexOf(item.production_stage) === PRODUCTION_STAGES.length - 1} onClick={() => shift(item, 1)}><ArrowDown size={14} /></button>
                  <select aria-label={`Move ${item.description} to stage`} value={item.production_stage} disabled={action.busy} onChange={(event) => move(item, event.target.value)}>
                    {PRODUCTION_STAGES.map((option) => <option value={option} key={option}>{STAGE_LABELS[option]}</option>)}
                  </select>
                  {item.completed ? <button type="button" onClick={() => setDone(item, false)}>Reopen</button> : <button type="button" onClick={() => setDone(item, true)}>Done</button>}
                  <button type="button" data-focus-target={`production-open-order-${item.id}`} onClick={() => { window.location.hash = `#/orders/${item.order_id}/from-production/${item.id}`; }}>Open Order</button>
                </div>
              </article>
            ))}
            {items.filter((item) => item.production_stage === stage).length === 0 && <div className="empty-state">No items</div>}
          </section>
        ))}
      </div>
    </section>
  );
}

function calendarRange(view, anchor) {
  if (view === "month") return { start: monthStart(anchor), end: monthEndExclusive(anchor), label: `${formatDate(monthStart(anchor))} - ${formatDate(addDays(monthEndExclusive(anchor), -1))}` };
  if (view === "week") {
    const start = weekStart(anchor);
    return { start, end: addDays(start, 7), label: `${formatDate(start)} - ${formatDate(addDays(start, 6))}` };
  }
  if (view === "day") return { start: anchor, end: addDays(anchor, 1), label: formatDate(anchor) };
  return { start: anchor, end: addDays(anchor, 14), label: `${formatDate(anchor)} - ${formatDate(addDays(anchor, 13))}` };
}

function emptyEventForm(anchor = dateOnly()) {
  return {
    id: "",
    title: "",
    order_id: "",
    order_item_id: "",
    all_day: false,
    start_at: `${anchor}T09:00`,
    end_at: `${anchor}T10:00`,
    assigned_user_id: "",
    status: "scheduled",
    internal_note: "",
  };
}

function eventToForm(event) {
  return {
    id: event.id,
    title: event.title,
    order_id: event.order_id || "",
    order_item_id: event.order_item_id || "",
    all_day: event.all_day,
    start_at: event.all_day ? event.start_at : String(event.start_at).slice(0, 16),
    end_at: event.all_day ? event.end_at : String(event.end_at).slice(0, 16),
    assigned_user_id: event.assigned_user_id || "",
    status: event.status,
    internal_note: event.internal_note || "",
  };
}

function CalendarPage({ api }) {
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(dateOnly());
  const [filters, setFilters] = useState({ assigned_user_id: "all", status: "all", linked_record_type: "all" });
  const [form, setForm] = useState(emptyEventForm());
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState({ busy: false, error: "" });
  const range = calendarRange(view, anchor);
  const query = new URLSearchParams({ start_at: range.start, end_at: range.end, ...filters }).toString();
  const events = useLoad(() => api.get(`/calendar?${query}`), [query]);
  const orders = useLoad(() => api.get("/orders"), []);
  function move(delta) {
    const amount = view === "month" ? 32 * delta : view === "week" ? 7 * delta : view === "day" ? delta : 14 * delta;
    setAnchor(view === "month" ? monthStart(addDays(anchor, amount)) : addDays(anchor, amount));
  }
  const linkedOrder = (orders.data?.items || []).find((order) => order.id === form.order_id);
  const orderItems = linkedOrder?.items || [];
  function payload() {
    return {
      title: form.title,
      order_id: form.order_id || null,
      order_item_id: form.order_item_id || null,
      all_day: form.all_day,
      start_at: form.start_at,
      end_at: form.end_at,
      assigned_user_id: form.assigned_user_id || null,
      status: form.status,
      internal_note: form.internal_note || null,
    };
  }
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      if (editing) await api.patch(`/calendar/${form.id}`, payload());
      else await api.post("/calendar", payload());
      setForm(emptyEventForm(anchor));
      setEditing(false);
      events.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setStatus(event, status) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/calendar/${event.id}/${status === "complete" ? "complete" : status === "scheduled" ? "reopen" : "cancel"}`, {});
      events.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  const days = view === "month"
    ? Array.from({ length: Math.ceil((new Date(`${range.end}T00:00:00Z`) - new Date(`${range.start}T00:00:00Z`)) / 86400000) }, (_, index) => addDays(range.start, index))
    : view === "week"
      ? Array.from({ length: 7 }, (_, index) => addDays(range.start, index))
      : view === "day"
        ? [range.start]
        : Array.from({ length: 14 }, (_, index) => addDays(range.start, index));
  return (
    <TwoColumn wide>
      <section className="panel calendar-page">
        <Toolbar title="Calendar">
          <div className="segmented calendar-view-tabs">
            {["month", "week", "day", "agenda"].map((option) => <button type="button" className={view === option ? "active" : ""} key={option} onClick={() => setView(option)}>{option}</button>)}
          </div>
          <button type="button" onClick={() => move(-1)}>Previous</button>
          <button type="button" onClick={() => setAnchor(dateOnly())}>Today</button>
          <button type="button" onClick={() => move(1)}>Next</button>
        </Toolbar>
        <div className="calendar-toolbar">
          <strong>{range.label}</strong>
          <select aria-label="Assigned user filter" value={filters.assigned_user_id} onChange={(event) => setFilters({ ...filters, assigned_user_id: event.target.value })}>
            <option value="all">All users</option>
            <option value="unassigned">Unassigned</option>
            {(events.data?.users || []).map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
          </select>
          <select aria-label="Status filter" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="all">All statuses</option>
            {CALENDAR_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
          <select aria-label="Linked record filter" value={filters.linked_record_type} onChange={(event) => setFilters({ ...filters, linked_record_type: event.target.value })}>
            {LINKED_RECORD_TYPES.map((type) => <option value={type} key={type}>{type.replace("_", " ")}</option>)}
          </select>
        </div>
        <div className="notice">Scheduled events are separate from Order and Order Item due dates.</div>
        <AsyncState state={events} empty="No calendar events">
          <div className={view === "agenda" ? "agenda-list" : "calendar-grid"}>
            {days.map((day) => {
              const dayEvents = (events.data?.items || []).filter((event) => event.local_start_date === day);
              return (
                <section className="calendar-day" key={day}>
                  <h3>{formatDate(day)}</h3>
                  {dayEvents.length === 0 ? <div className="empty-state">No scheduled events</div> : dayEvents.map((event) => (
                    <article className={`calendar-event ${event.status}`} key={event.id}>
                      <button type="button" onClick={() => { setForm(eventToForm(event)); setEditing(true); }}>{event.title}</button>
                      <span>{formatEventTime(event)} / {event.status}</span>
                      {event.order_id && <a href={`#/orders/${event.order_id}`}>{event.order_number || "Open Order"}</a>}
                      <div className="row-actions">
                        {event.status !== "complete" ? <button type="button" onClick={() => setStatus(event, "complete")}><CheckCircle2 size={14} />Complete</button> : <button type="button" onClick={() => setStatus(event, "scheduled")}><RotateCcw size={14} />Reopen</button>}
                        {event.status !== "cancelled" && <button type="button" onClick={() => setStatus(event, "cancelled")}><XCircle size={14} />Cancel</button>}
                      </div>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </AsyncState>
      </section>
      <form className="panel form-grid" onSubmit={save}>
        <Toolbar title={editing ? "Edit Event" : "Create Event"}>
          {editing && <button type="button" onClick={() => { setEditing(false); setForm(emptyEventForm(anchor)); }}>New</button>}
        </Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        <Field label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} />
        <SelectField label="Linked Order" value={form.order_id} onChange={(order_id) => setForm({ ...form, order_id, order_item_id: "" })}>
          <option value="">No linked order</option>
          {(orders.data?.items || []).map((order) => <option value={order.id} key={order.id}>{order.order_number}</option>)}
        </SelectField>
        <SelectField label="Linked Order Item" value={form.order_item_id} disabled={!form.order_id} onChange={(order_item_id) => setForm({ ...form, order_item_id })}>
          <option value="">No linked item</option>
          {orderItems.map((item) => <option value={item.id} key={item.id}>{item.description}</option>)}
        </SelectField>
        <label className="check-row"><input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked, start_at: event.target.checked ? String(form.start_at).slice(0, 10) : `${String(form.start_at).slice(0, 10)}T09:00`, end_at: event.target.checked ? addDays(String(form.end_at).slice(0, 10), 1) : `${String(form.end_at).slice(0, 10)}T10:00` })} />All day</label>
        <Field label="Start" type={form.all_day ? "date" : "datetime-local"} value={form.start_at} onChange={(start_at) => setForm({ ...form, start_at })} />
        <Field label="End" type={form.all_day ? "date" : "datetime-local"} value={form.end_at} onChange={(end_at) => setForm({ ...form, end_at })} />
        <SelectField label="Assigned user" value={form.assigned_user_id} onChange={(assigned_user_id) => setForm({ ...form, assigned_user_id })}>
          <option value="">Unassigned</option>
          {(events.data?.users || []).map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
        </SelectField>
        <SelectField label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })}>
          {CALENDAR_STATUSES.map((status) => <option key={status}>{status}</option>)}
        </SelectField>
        <Field label="Internal note" value={form.internal_note} onChange={(internal_note) => setForm({ ...form, internal_note })} />
        <button className="primary-button" disabled={action.busy}><CalendarDays size={16} />{editing ? "Save Event" : "Create Event"}</button>
      </form>
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
      <BackupRestorePanel api={api} session={session} />
    </TwoColumn>
  );
}

function BackupRestorePanel({ api, session }) {
  const canUseBackup = ["owner", "admin"].includes(session.user.role);
  const [exportForm, setExportForm] = useState({ passphrase: "", confirm: "" });
  const [restoreForm, setRestoreForm] = useState({ passphrase: "", confirmation: session.tenant.company_name, policy: false });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });

  async function loadHistory() {
    if (!canUseBackup) return;
    try {
      const data = await api.get("/backup/history");
      setHistory(data.items || []);
    } catch {
      setHistory([]);
    }
  }

  useEffect(() => { loadHistory(); }, [canUseBackup]);

  async function createBackup(event) {
    event.preventDefault();
    setAction({ busy: true, error: "", saved: "" });
    try {
      if (exportForm.passphrase !== exportForm.confirm) throw new Error("backup_passphrase_mismatch");
      await api.download("/backup/export", `${session.tenant.company_name}.signguy-backup`, {
        method: "POST",
        body: { passphrase: exportForm.passphrase, passphrase_confirmation: exportForm.confirm },
      });
      setExportForm({ passphrase: "", confirm: "" });
      setAction({ busy: false, error: "", saved: "Encrypted backup downloaded" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function previewBackup(event) {
    event.preventDefault();
    if (!file) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const data = await api.upload("/backup/preview", file, { passphrase: restoreForm.passphrase });
      setPreview(data);
      setAction({ busy: false, error: "", saved: data.restore_permitted ? "Preview ready" : "Preview blocked" });
    } catch (err) {
      setPreview(null);
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function restore(event) {
    event.preventDefault();
    if (!file || !preview?.restore_permitted || !window.confirm("Restore this backup into the current empty tenant?")) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload("/backup/restore", file, {
        passphrase: restoreForm.passphrase,
        confirmation_phrase: restoreForm.confirmation,
        unmatched_assignment_policy: restoreForm.policy ? "restore_unassigned" : "",
      });
      setAction({ busy: false, error: "", saved: "Restore completed" });
      setPreview(null);
      setFile(null);
      await loadHistory();
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  if (!canUseBackup) {
    return <section className="panel"><Toolbar title="Backup & Restore" /><div className="notice">Backup and restore are available to owners and admins.</div></section>;
  }

  const counts = preview?.counts || {};
  return (
    <section className="panel backup-panel">
      <Toolbar title="Backup & Restore" />
      <div className="notice">Backups include Slim V1 operational records and attachments, encrypted with a passphrase. Passwords, sessions, tokens, keys, logs, temporary URLs, and external credentials are excluded.</div>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <form className="form-grid" onSubmit={createBackup}>
        <h3>Create Backup</h3>
        <Field label="Backup passphrase" type="password" value={exportForm.passphrase} onChange={(passphrase) => setExportForm({ ...exportForm, passphrase })} />
        <Field label="Confirm passphrase" type="password" value={exportForm.confirm} onChange={(confirm) => setExportForm({ ...exportForm, confirm })} />
        <button className="primary-button" disabled={action.busy}><KeyRound size={16} />Create Backup</button>
      </form>
      <form className="form-grid" onSubmit={previewBackup}>
        <h3>Validate Backup</h3>
        <label className="field">
          <span>Backup file</span>
          <input type="file" accept=".signguy-backup,application/vnd.signguy.backup" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} />
        </label>
        <Field label="Backup passphrase" type="password" value={restoreForm.passphrase} onChange={(passphrase) => setRestoreForm({ ...restoreForm, passphrase })} />
        <button className="primary-button" disabled={action.busy || !file}><Upload size={16} />Validate Backup</button>
      </form>
      {preview && (
        <form className="form-grid restore-preview" onSubmit={restore}>
          <h3>Restore Preview</h3>
          <div className="backup-counts">
            {["customers", "estimates", "orders", "order_items", "invoices", "calendar_events", "attachments"].map((key) => <span key={key}>{key.replace(/_/g, " ")}: {counts[key] || 0}</span>)}
          </div>
          <span>Created: {preview.created_at_utc}</span>
          <span>Source: {preview.source_product} / {preview.source_application_version}</span>
          <span>Schema: {preview.source_schema_version}</span>
          <span>Attachment bytes: {preview.total_attachment_bytes || 0}</span>
          {preview.user_mapping?.map((entry) => <span key={entry.source_user_portable_id}>{entry.source_email_label}: {entry.matched ? `matched ${entry.matched_target_display_name}` : "unmatched"}</span>)}
          {preview.warnings?.map((warning) => <div className="notice" key={warning}>{warning}</div>)}
          {preview.blocking_errors?.map((blocking) => <div className="error-state" key={blocking}>{blocking}</div>)}
          {preview.required_unmatched_assignment_policy && <label className="check-row"><input type="checkbox" checked={restoreForm.policy} onChange={(event) => setRestoreForm({ ...restoreForm, policy: event.target.checked })} />Restore unmatched assignments as unassigned</label>}
          <Field label="Type target shop name" value={restoreForm.confirmation} onChange={(confirmation) => setRestoreForm({ ...restoreForm, confirmation })} />
          <button className="primary-button" disabled={action.busy || !preview.restore_permitted || (preview.required_unmatched_assignment_policy && !restoreForm.policy)}><RotateCcw size={16} />Restore Into Empty Tenant</button>
        </form>
      )}
      <section>
        <h3>Restore History</h3>
        {history.length === 0 ? <div className="empty-state">No restores recorded</div> : history.map((entry) => (
          <article className="record-row" key={entry.id}>
            <div><strong>{entry.backup_id}</strong><span>{entry.status} / {entry.completed_at || entry.started_at}</span></div>
            <span>{Object.entries(entry.restored_counts || {}).map(([key, value]) => `${key}:${value}`).slice(0, 3).join(" ")}</span>
          </article>
        ))}
      </section>
    </section>
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
