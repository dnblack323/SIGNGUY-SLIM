import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Calculator,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Delete,
  DollarSign,
  Download,
  Eraser,
  FileText,
  Filter,
  Inbox,
  KeyRound,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  MousePointer2,
  PenLine,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Square,
  SwitchCamera,
  Trash2,
  Type,
  Undo2,
  Redo2,
  Upload,
  XCircle,
  UserPlus,
  Users,
} from "lucide-react";
import { apiRequest, blobApiFile, cents, downloadApiFile, money, uploadApiFile } from "./api.js";
import {
  AREA_NAVIGATION,
  ADMIN_ROLES,
  enabledOperationalAreas,
  enabledQuickAccess,
  enabledUtilityItems,
  filterNavigationForRole,
  getRouteContext,
  MANAGER_ROLES,
} from "./navigation.js";

const blankAddress = { line1: "", line2: "", city: "", state: "", postal_code: "", country: "US" };
const blankItem = {
  title: "",
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
const INTAKE_STATUS_LABELS = {
  new: "New",
  reviewing: "Reviewing",
  need_information: "Need Information",
  waiting_for_customer: "Waiting for Customer",
  ready_to_create: "Ready to Create",
  converted_to_order: "Converted to Order",
  attached_to_existing_order: "Attached to Existing Order",
  closed_not_an_order: "Closed - Not an Order",
};
const IMAGE_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ANNOTATION_COLORS = ["#d92d20", "#2563eb", "#0f766e", "#111827", "#f59e0b"];
const ANNOTATION_WIDTHS = [2, 4, 6, 10];
const todayInput = () => new Date().toISOString().slice(0, 10);
const localDateTimeInput = (value = new Date().toISOString()) => String(value || new Date().toISOString()).slice(0, 16);

function dollarsToCents(value) {
  return cents(value || 0);
}

function centsToDollars(value) {
  return ((value || 0) / 100).toFixed(2);
}

function minutesLabel(minutes = 0) {
  return `${(Number(minutes || 0) / 60).toFixed(2)} hrs`;
}

function isImageAttachment(attachment) {
  return Boolean(attachment?.annotatable || IMAGE_ATTACHMENT_TYPES.has(attachment?.mime_type));
}

function safeAttachmentStem(name = "attachment") {
  return String(name).replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "attachment";
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function normalizePointer(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = rect.width ? (event.clientX - rect.left) / rect.width : 0;
  const y = rect.height ? (event.clientY - rect.top) / rect.height : 0;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function pointToCanvas(point, canvas) {
  return { x: point.x * canvas.width, y: point.y * canvas.height };
}

function drawArrowHead(ctx, from, to, width) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = Math.max(12, width * 4);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawAnnotationOperation(ctx, canvas, op) {
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.stroke_width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (op.type === "pen") {
    ctx.beginPath();
    op.points.forEach((point, index) => {
      const next = pointToCanvas(point, canvas);
      if (index === 0) ctx.moveTo(next.x, next.y);
      else ctx.lineTo(next.x, next.y);
    });
    ctx.stroke();
  }
  if (op.type === "arrow") {
    const start = pointToCanvas(op.start, canvas);
    const end = pointToCanvas(op.end, canvas);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    drawArrowHead(ctx, start, end, op.stroke_width);
  }
  if (op.type === "rectangle") {
    const start = pointToCanvas(op.start, canvas);
    const end = pointToCanvas(op.end, canvas);
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  }
  if (op.type === "text") {
    const point = pointToCanvas(op.point, canvas);
    ctx.font = `${Math.max(16, op.stroke_width * 5)}px Inter, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(op.text, point.x, point.y);
    ctx.fillStyle = op.color;
    ctx.fillText(op.text, point.x, point.y);
  }
  ctx.restore();
}
const CALENDAR_STATUSES = ["scheduled", "complete", "cancelled"];
const LINKED_RECORD_TYPES = ["all", "none", "estimate", "order", "order_item"];

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

function compactMonthEventTime(event) {
  if (event.all_day) return "All day";
  const start = event.local_start_time || String(event.start_at).slice(11, 16);
  const end = event.local_end_time || String(event.end_at).slice(11, 16);
  const compact = (value) => String(value)
    .replace(/^0/, "")
    .replace(/:00\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const startCompact = compact(start);
  const endCompact = compact(end);
  const startPeriod = startCompact.match(/\b(AM|PM)$/i)?.[1]?.toUpperCase();
  const endPeriod = endCompact.match(/\b(AM|PM)$/i)?.[1]?.toUpperCase();
  const startDisplay = startPeriod && startPeriod === endPeriod ? startCompact.replace(/\s*(AM|PM)$/i, "") : startCompact;
  return `${startDisplay}-${endCompact}`;
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

function AreaSidebar({ context, role, onLogout, drawer = false, onNavigate }) {
  const operationalAreas = enabledOperationalAreas(undefined, role);
  const utilities = enabledUtilityItems(role);
  return (
    <nav className={drawer ? "area-sidebar drawer-sidebar" : "area-sidebar"} aria-label={drawer ? "Mobile area navigation" : "Area navigation"}>
      <div className="sidebar-logo-block"><LogoMark /></div>
      <div className="sidebar-area-list">
        {AREA_NAVIGATION.filter((item) => item.kind === "home").map((item) => <SidebarLink item={item} active={context.areaKey === item.key} key={item.key} onNavigate={onNavigate} />)}
        {operationalAreas.map((item) => <SidebarLink item={item} active={context.areaKey === item.key} key={item.key} operational onNavigate={onNavigate} />)}
      </div>
      <div className="sidebar-utilities">
        {utilities.map((item) => {
          if (item.action === "logout") {
            const Icon = item.icon;
            return <button type="button" className="sidebar-item utility" key={item.key} onClick={onLogout}><Icon size={20} /><span>{item.label}</span></button>;
          }
          return <SidebarLink item={item} active={context.areaKey === item.key} key={item.key} utility onNavigate={onNavigate} />;
        })}
      </div>
    </nav>
  );
}

function SidebarLink({ item, active, operational = false, utility = false, onNavigate }) {
  const Icon = item.icon;
  const style = { "--area-accent": item.accent || "#64748b" };
  return (
    <a
      href={item.href}
      className={active ? "sidebar-item active" : "sidebar-item"}
      aria-current={active ? "page" : undefined}
      data-operational-area={operational ? item.key : undefined}
      data-utility-item={utility ? item.key : undefined}
      style={style}
      onClick={onNavigate}
    >
      <Icon size={20} />
      <span>{item.label}</span>
    </a>
  );
}

function ShellHeader({ context, session, drawerButtonRef, onOpenDrawer, onCalculator }) {
  const quickActions = enabledQuickAccess(session.user.role);
  return (
    <header className="app-header">
      <div className="header-left">
        <button type="button" className="mobile-menu-button" aria-label="Open navigation menu" ref={drawerButtonRef} onClick={onOpenDrawer}><Menu size={20} /></button>
        <div className="quick-access" aria-label="Quick Access">
          {quickActions.map((action) => {
            const Icon = action.icon;
            if (action.key === "calculator") {
              return <button type="button" className="quick-access-button" aria-label={action.label} title={action.label} key={action.key} onClick={onCalculator}><Icon size={18} /></button>;
            }
            return <a className="quick-access-button" aria-label={action.label} title={action.label} href={action.href} key={action.key}><Icon size={18} /></a>;
          })}
        </div>
        <div className="header-title" style={{ "--area-accent": context.accent }}>
          <span>{context.area.label}</span>
          <h1 tabIndex="-1">{context.pageLabel}</h1>
        </div>
      </div>
      <div className="header-right">
        <label className="header-search">
          <Search size={15} />
          <span className="visually-hidden">Search</span>
          <input aria-label="Search" placeholder="Search" />
        </label>
        <span className="status-pill"><ShieldCheck size={16} />{session.user.role}</span>
      </div>
    </header>
  );
}

function ModuleTabs({ context, role }) {
  const modules = filterNavigationForRole(context.area.modules || [], role);
  if (!modules.length) return null;
  const module = modules.find((entry) => entry.key === context.moduleKey) || modules[0];
  const childTabs = filterNavigationForRole(module?.children || [], role);
  return (
    <nav className="module-tabs" aria-label={`${context.area.label} modules`} style={{ "--area-accent": context.accent }}>
      <div className="module-tab-list">
        {modules.map((moduleItem) => (
          <a className={context.moduleKey === moduleItem.key ? "module-tab active" : "module-tab"} aria-current={context.moduleKey === moduleItem.key ? "page" : undefined} href={moduleItem.href} key={moduleItem.key}>{moduleItem.label}</a>
        ))}
      </div>
      {childTabs.length > 0 && (
        <div className="module-child-tabs" aria-label={`${module.label} tabs`}>
          {childTabs.map((child) => (
            <a className={context.childKey === child.key ? "child-tab active" : "child-tab"} aria-current={context.childKey === child.key ? "page" : undefined} href={child.href} key={child.key}>{child.label}</a>
          ))}
        </div>
      )}
    </nav>
  );
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
  const [ordersFilters, setOrdersFilters] = useState({
    search: "",
    status: "all",
    production_stage: "all",
    date_from: "",
    date_to: "",
    sort: "order_number_desc",
  });
  const [ordersFiltersOpen, setOrdersFiltersOpen] = useState(false);
  const [workspaceActions, setWorkspaceActions] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerButtonRef = useRef(null);
  function setSession(next) {
    setSessionState(next);
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  }
  const api = useMemo(
    () => ({
      get: (path) => apiRequest(path, { token: session?.access_token }),
      post: (path, body) => apiRequest(path, { token: session?.access_token, method: "POST", body }),
      put: (path, body) => apiRequest(path, { token: session?.access_token, method: "PUT", body }),
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
  const routeContext = getRouteContext(route);
  const managerRouteBlocked = ["employees", "time", "payroll"].includes(pageKey) && !MANAGER_ROLES.includes(session?.user?.role);
  const adminRouteBlocked = pageKey === "announcements" && !ADMIN_ROLES.includes(session?.user?.role);
  const isOrderIntakeRoute = pageKey === "orders" && routeParts[1] === "intake";
  const workspaceOrderId = pageKey === "orders" && routeParts[1] && !["intake"].includes(routeParts[1]) ? routeParts[1] : "";
  const isNewOrderRoute = pageKey === "orders" && routeParts[1] === "new";
  const existingOrderId = pageKey === "orders" && routeParts[1] && !["new", "intake"].includes(routeParts[1]) ? routeParts[1] : "";
  const workspaceReturnRoute = workspaceOrderId && routeParts[2] === "from-production" ? "production" : "orders";
  const workspaceReturnItemId = workspaceReturnRoute === "production" ? routeParts[3] || "" : "";
  const orderOverlayOpen = isNewOrderRoute || Boolean(existingOrderId);

  useEffect(() => {
    if (existingOrderId || isNewOrderRoute || !window.__signguyWorkspaceFocusTarget) return;
    const target = window.__signguyWorkspaceFocusTarget;
    delete window.__signguyWorkspaceFocusTarget;
    let attempts = 0;
    const restore = () => {
      attempts += 1;
      const preferred = target.selector ? document.querySelector(target.selector) : null;
      const fallback = document.querySelector(".header-title h1") || document.querySelector(".ribbon-button") || document.querySelector("main");
      const node = preferred || (attempts > 10 ? fallback : null);
      if (node?.focus) {
        node.focus();
        return;
      }
      window.setTimeout(restore, 25);
    };
    window.setTimeout(restore, 0);
  }, [route, existingOrderId, isNewOrderRoute]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (orderOverlayOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [orderOverlayOpen]);
  useEffect(() => {
    if (session && managerRouteBlocked) window.location.hash = "#/production";
  }, [session, managerRouteBlocked]);
  useEffect(() => {
    if (session && adminRouteBlocked) window.location.hash = "#/production";
  }, [session, adminRouteBlocked]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        window.setTimeout(() => drawerButtonRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawerOpen]);

  if (!sessionChecked) return <main className="auth-screen"><div className="loading-state">Loading</div></main>;
  if (!session) return <AuthScreen onSession={setSession} />;

  const shellStyle = { "--area-accent": routeContext.accent };
  const closeDrawer = ({ restoreFocus = false } = {}) => {
    setDrawerOpen(false);
    if (restoreFocus) window.setTimeout(() => drawerButtonRef.current?.focus(), 0);
  };

  return (
    <main className="app-shell" style={shellStyle}>
      <AreaSidebar context={routeContext} role={session.user.role} onLogout={logout} />
      {drawerOpen && (
        <div className="drawer-layer" role="presentation">
          <button type="button" className="drawer-backdrop" aria-label="Close navigation menu" onClick={() => closeDrawer({ restoreFocus: true })} />
          <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <button type="button" className="drawer-close" onClick={() => closeDrawer({ restoreFocus: true })}><XCircle size={18} />Close</button>
            <AreaSidebar context={routeContext} role={session.user.role} onLogout={() => { closeDrawer(); logout(); }} drawer onNavigate={() => closeDrawer()} />
          </aside>
        </div>
      )}
      <section className="workspace">
        <ShellHeader context={routeContext} session={session} drawerButtonRef={drawerButtonRef} onOpenDrawer={() => setDrawerOpen(true)} onCalculator={() => setCalculatorOpen(true)} />
        <ModuleTabs context={routeContext} role={session.user.role} />
        <ContextualRibbon
          pageKey={pageKey}
          routeParts={routeParts}
          ordersFilters={ordersFilters}
          setOrdersFilters={setOrdersFilters}
          filtersOpen={ordersFiltersOpen}
          setFiltersOpen={setOrdersFiltersOpen}
          workspaceActions={workspaceActions}
          onCalculator={() => setCalculatorOpen(true)}
        />
        {pageKey === "orders" && <OrdersFilterBar filters={ordersFilters} setFilters={setOrdersFilters} open={ordersFiltersOpen} />}
        <section className={orderOverlayOpen ? "content-stage overlay-open" : "content-stage"}>
          <div className="stage-background" inert={orderOverlayOpen ? true : undefined} aria-hidden={orderOverlayOpen ? "true" : undefined}>
            {pageKey === "customers" && <CustomersPage api={api} />}
            {pageKey === "estimates" && <EstimatesPage api={api} />}
            {pageKey === "orders" && (isOrderIntakeRoute ? <OrderIntakePage api={api} /> : <OrdersPage api={api} filters={ordersFilters} />)}
            {pageKey === "production" && <ProductionPage api={api} />}
            {pageKey === "tasks" && <ProductionPage api={api} />}
            {pageKey === "calendar" && <CalendarPage api={api} setWorkspaceActions={setWorkspaceActions} />}
            {pageKey === "announcements" && !adminRouteBlocked && <AnnouncementManagementPage api={api} />}
            {pageKey === "employees" && !managerRouteBlocked && <EmployeesPage api={api} session={session} />}
            {pageKey === "time" && !managerRouteBlocked && <TimeAttendancePage api={api} />}
            {pageKey === "payroll" && !managerRouteBlocked && <PayrollPage api={api} />}
            {pageKey === "employee-portal" && <EmployeePortalPage api={api} pageKey={["my-pay", "announcements", "messages"].includes(routeParts[1]) ? routeParts[1] : "time-clock"} />}
            {pageKey === "invoices" && <InvoicesPage api={api} session={session} />}
            {pageKey === "payments" && <InvoicesPage api={api} session={session} />}
            {(pageKey === "settings" || pageKey === "backup" || pageKey === "pricing") && <SettingsPage api={api} session={session} onSession={setSession} />}
            {pageKey === "home" && <HomePage api={api} />}
          </div>
          {isNewOrderRoute && <NewOrderPage api={api} setWorkspaceActions={setWorkspaceActions} onCreated={(order) => { window.location.hash = `#/orders/${order.id}`; }} />}
          {existingOrderId && <OrderWorkspace orderId={existingOrderId} api={api} returnRoute={workspaceReturnRoute} returnItemId={workspaceReturnItemId} setWorkspaceActions={setWorkspaceActions} onClose={() => {
            const targetHash = workspaceReturnRoute === "production" ? "#/production" : "#/orders";
            window.__signguyWorkspaceBypassHash = targetHash;
            window.__signguyWorkspaceFocusTarget = {
              selector: workspaceReturnRoute === "production" && workspaceReturnItemId
                ? `[data-focus-target="production-open-order-${workspaceReturnItemId}"]`
                : `[data-focus-target="order-open-${existingOrderId}"]`,
            };
            window.location.hash = targetHash;
          }} />}
        </section>
      </section>
      {calculatorOpen && <CalculatorModal onClose={() => setCalculatorOpen(false)} />}
    </main>
  );
}

const DEFAULT_ORDER_FILTERS = {
  search: "",
  status: "all",
  production_stage: "all",
  date_from: "",
  date_to: "",
  sort: "order_number_desc",
};

function RibbonGroup({ label, children }) {
  return (
    <div className="ribbon-group" aria-label={label}>
      <div className="ribbon-group-actions">{children}</div>
    </div>
  );
}

function ContextualRibbon({ pageKey, routeParts, ordersFilters, setOrdersFilters, filtersOpen, setFiltersOpen, workspaceActions, onCalculator }) {
  const isOrdersList = pageKey === "orders" && !routeParts[1];
  const isOrderIntake = pageKey === "orders" && routeParts[1] === "intake";
  const isNewOrder = pageKey === "orders" && routeParts[1] === "new";
  const isOrderWorkspace = pageKey === "orders" && routeParts[1] && routeParts[1] !== "new";

  if (isOrdersList || isOrderIntake) {
    return (
      <div className="ribbon office-ribbon orders-list-ribbon" aria-label={isOrderIntake ? "Order Intake ribbon" : "Orders list ribbon"}>
        <RibbonGroup label="Create">
          <a href="#/orders/new" className="ribbon-button"><Plus size={18} /><span>New Order</span></a>
        </RibbonGroup>
        <RibbonGroup label="View">
          <a href={isOrderIntake ? "#/orders" : "#/orders/intake"} className="ribbon-button"><Inbox size={18} /><span>{isOrderIntake ? "Orders" : "Order Intake"}</span></a>
          <button type="button" className="ribbon-button" onClick={() => setFiltersOpen(true)}><Search size={18} /><span>Search</span></button>
          <button type="button" className="ribbon-button" onClick={() => setFiltersOpen(!filtersOpen)}><Filter size={18} /><span>Filters</span></button>
          <button type="button" className="ribbon-button" onClick={() => setOrdersFilters({ ...ordersFilters, status: "active", production_stage: "all" })}><FileText size={18} /><span>Saved Views</span></button>
          <button type="button" className="ribbon-button" onClick={() => setOrdersFilters(DEFAULT_ORDER_FILTERS)}><RotateCcw size={18} /><span>Clear Filters</span></button>
        </RibbonGroup>
        <RibbonGroup label="Tools">
          <button type="button" className="ribbon-button" onClick={onCalculator}><Calculator size={18} /><span>Calculator</span></button>
        </RibbonGroup>
      </div>
    );
  }

  if (isNewOrder || isOrderWorkspace) {
    const saved = Boolean(workspaceActions?.savedRecord);
    return (
      <div className="ribbon office-ribbon order-workspace-ribbon" aria-label={isNewOrder ? "New order ribbon" : "Order workspace ribbon"}>
        <RibbonGroup label="Record">
          <button type="button" className="ribbon-button primary-ribbon-button" disabled={!workspaceActions?.save || workspaceActions.busy} onClick={() => workspaceActions?.save?.()}><Save size={18} /><span>Save</span></button>
          <button type="button" className="ribbon-button" onClick={() => workspaceActions?.back?.()}><ArrowLeft size={18} /><span>Close</span></button>
        </RibbonGroup>
        <RibbonGroup label="Items">
          <button type="button" className="ribbon-button" disabled={!workspaceActions?.addItem || workspaceActions.busy} onClick={() => workspaceActions?.addItem?.()}><Plus size={18} /><span>Add Item</span></button>
          <button type="button" className="ribbon-button" disabled={!workspaceActions?.duplicateItem} onClick={() => workspaceActions?.duplicateItem?.()}><Copy size={18} /><span>Duplicate</span></button>
        </RibbonGroup>
        <RibbonGroup label="Pricing">
          <button type="button" className="ribbon-button" onClick={onCalculator}><Calculator size={18} /><span>Calculator</span></button>
        </RibbonGroup>
        <RibbonGroup label="Customer & Files">
          <button type="button" className="ribbon-button" disabled={!workspaceActions?.openCustomer} onClick={() => workspaceActions?.openCustomer?.()}><UserPlus size={18} /><span>Customer</span></button>
          <button type="button" className="ribbon-button" disabled={!saved || !workspaceActions?.uploadArtwork} onClick={() => workspaceActions?.uploadArtwork?.()}><Upload size={18} /><span>Artwork</span></button>
        </RibbonGroup>
        <RibbonGroup label="Workflow">
          <button type="button" className="ribbon-button" disabled={!saved || !workspaceActions?.schedule} onClick={() => workspaceActions?.schedule?.()}><CalendarDays size={18} /><span>Schedule</span></button>
          <button type="button" className="ribbon-button" disabled={!saved || !workspaceActions?.invoice || workspaceActions.busy} onClick={() => workspaceActions?.invoice?.()}><ReceiptText size={18} /><span>Invoice</span></button>
          <button type="button" className="ribbon-button" disabled={!saved || !workspaceActions?.emailCustomer || workspaceActions.busy} onClick={() => workspaceActions?.emailCustomer?.()}><Mail size={18} /><span>Email Customer</span></button>
          <button type="button" className="ribbon-button" disabled={!saved || !workspaceActions?.communicationNote || workspaceActions.busy} onClick={() => workspaceActions?.communicationNote?.()}><MessageSquare size={18} /><span>Note</span></button>
        </RibbonGroup>
      </div>
    );
  }

  if (pageKey === "customers") {
    return <div className="ribbon contextual-ribbon" aria-label="Customers ribbon"><a href="#/customers" className="ribbon-button"><UserPlus size={18} /><span>New Customer</span></a><a href="#/orders/new" className="ribbon-button"><ShoppingBag size={18} /><span>New Order</span></a></div>;
  }
  if (pageKey === "estimates") {
    return <div className="ribbon contextual-ribbon" aria-label="Estimates ribbon"><a href="#/estimates" className="ribbon-button"><FileText size={18} /><span>New Estimate</span></a><button type="button" className="ribbon-button" onClick={onCalculator}><Calculator size={18} /><span>Calculator</span></button></div>;
  }
  if (pageKey === "production" || pageKey === "tasks") {
    return <div className="ribbon contextual-ribbon" aria-label="Production ribbon"><button type="button" className="ribbon-button" onClick={onCalculator}><Calculator size={18} /><span>Calculator</span></button></div>;
  }
  if (pageKey === "calendar") {
    const view = workspaceActions?.view || "month";
    return (
      <div className="ribbon office-ribbon calendar-ribbon" aria-label="Calendar ribbon">
        <button type="button" className="ribbon-button primary-ribbon-button" onClick={() => workspaceActions?.create?.("event")}><Plus size={20} /><span>Event</span></button>
        <button type="button" className="ribbon-button" onClick={() => workspaceActions?.create?.("task")}><CheckCircle2 size={20} /><span>Task</span></button>
        <button type="button" className="ribbon-button" onClick={() => workspaceActions?.create?.("appointment")}><UserPlus size={20} /><span>Appointment</span></button>
        <span className="ribbon-divider" aria-hidden="true" />
        <button type="button" className="ribbon-button" onClick={() => workspaceActions?.today?.()}><CalendarDays size={20} /><span>Today</span></button>
        {["month", "week", "day", "agenda"].map((option) => (
          <button type="button" key={option} className={view === option ? "ribbon-button active" : "ribbon-button"} onClick={() => workspaceActions?.setView?.(option)}><CalendarDays size={20} /><span>{option[0].toUpperCase() + option.slice(1)}</span></button>
        ))}
        <span className="ribbon-divider" aria-hidden="true" />
        <button type="button" className={workspaceActions?.filtersActive ? "ribbon-button active" : "ribbon-button"} onClick={() => workspaceActions?.filters?.()}><Filter size={20} /><span>Filters</span></button>
      </div>
    );
  }
  if (pageKey === "employees") {
    return <div className="ribbon contextual-ribbon" aria-label="Employees ribbon"><a href="#/time" className="ribbon-button"><Clock size={18} /><span>Time</span></a><a href="#/payroll" className="ribbon-button"><DollarSign size={18} /><span>Payroll</span></a></div>;
  }
  if (pageKey === "time") {
    return <div className="ribbon contextual-ribbon" aria-label="Time ribbon"><a href="#/employees" className="ribbon-button"><Users size={18} /><span>Employees</span></a><a href="#/employee-portal/time-clock" className="ribbon-button"><Clock size={18} /><span>Portal</span></a></div>;
  }
  if (pageKey === "payroll") {
    return <div className="ribbon contextual-ribbon" aria-label="Payroll ribbon"><a href="#/employees" className="ribbon-button"><Users size={18} /><span>Employees</span></a><a href="#/time" className="ribbon-button"><Clock size={18} /><span>Time</span></a></div>;
  }
  if (pageKey === "employee-portal") {
    return <div className="ribbon contextual-ribbon" aria-label="Employee Portal ribbon"><a href="#/employee-portal/time-clock" className="ribbon-button"><Clock size={18} /><span>Time Clock</span></a><a href="#/employee-portal/my-pay" className="ribbon-button"><DollarSign size={18} /><span>My Pay</span></a></div>;
  }
  if (pageKey === "invoices") {
    return <div className="ribbon contextual-ribbon" aria-label="Invoices ribbon"><a href="#/orders" className="ribbon-button"><ShoppingBag size={18} /><span>Create From Order</span></a></div>;
  }
  return <div className="ribbon contextual-ribbon" aria-label="Home ribbon"><a href="#/orders/new" className="ribbon-button"><ShoppingBag size={18} /><span>New Order</span></a><button type="button" className="ribbon-button" onClick={onCalculator}><Calculator size={18} /><span>Calculator</span></button></div>;
}

function OrdersFilterBar({ filters, setFilters, open }) {
  if (!open) return null;
  return (
    <div className="orders-filter-bar" aria-label="Orders filters">
      <label><span>Search orders</span><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
      <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="all">All</option>
        {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status} value={status}>{status}</option>)}
      </select></label>
      <label><span>Stage</span><select value={filters.production_stage} onChange={(event) => setFilters({ ...filters, production_stage: event.target.value })}>
        <option value="all">All stages</option>
        {PRODUCTION_STAGES.map((stage) => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}
      </select></label>
      <label><span>From</span><input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} /></label>
      <label><span>To</span><input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} /></label>
      <label><span>Saved View</span><select value="all" onChange={(event) => {
        if (event.target.value === "production") setFilters({ ...filters, production_stage: "in_progress", status: "active" });
        if (event.target.value === "open") setFilters({ ...filters, status: "active", production_stage: "all" });
      }}>
        <option value="all">All Orders</option>
        <option value="open">Open Orders</option>
        <option value="production">In Production</option>
      </select></label>
      <label><span>Sort</span><select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
        <option value="order_number_desc">Newest order</option>
        <option value="due_date_asc">Due date</option>
        <option value="total_desc">Total</option>
      </select></label>
    </div>
  );
}

function formatProgress(progress) {
  if (!progress || !progress.total) return "No production items";
  return `${progress.completed}/${progress.total} complete (${progress.percent}%)`;
}

function itemFromApi(entry) {
  return newQuickItem({
    id: entry.id,
    title: entry.title || entry.description || "",
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
                  <a href={`#/orders/${item.order_id}`} key={item.id}>{item.order_number} / {item.title || item.description}<small>{item.due_date ? `Due ${item.due_date}` : "No due date"}</small></a>
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
                {day.events.length === 0 ? <span>Open</span> : day.events.slice(0, 3).map((event) => <a href="#/calendar" key={event.id}>{event.display_title || event.title}</a>)}
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
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
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
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
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
        {selectedCustomer && <CommunicationPanel api={api} customerId={selectedCustomer.id} savedCustomerEmail={selectedCustomer.email || ""} />}
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
  const [editingEstimate, setEditingEstimate] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      if (editingId) await api.patch(`/estimates/${editingId}`, documentPayload(form));
      else await api.post("/estimates", documentPayload(form));
      setEditingId("");
      setEditingEstimate(null);
      estimates.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function edit(id) {
    setAction({ busy: true, error: "" });
    try {
      const estimate = await api.get(`/estimates/${id}`);
      setEditingId(id);
      setEditingEstimate(estimate);
      setForm({
        customer_id: estimate.customer_id,
        document_date: estimate.document_date,
        expires_at: estimate.expires_at || "",
        follow_up_at: estimate.follow_up_at || "",
        status: estimate.status,
        discount: String((estimate.discount_cents || 0) / 100),
        internal_notes: estimate.internal_notes || "",
        items: estimate.items.map((entry) => newQuickItem({
          id: entry.id,
          title: entry.title || entry.description,
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
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
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
              <EmailAction api={api} endpoint={`/estimates/${item.id}/send-email`} title={`Send ${item.estimate_number}`} defaultSubject={`Estimate ${item.estimate_number}`} defaultBody="Please review the attached estimate.">Email</EmailAction>
              <button disabled={action.busy} onClick={() => downloadEstimate(item.id, item.estimate_number)}><Download size={14} />PDF</button>
            </>
          )} />
        </AsyncState>
      </section>
      <div className="form-stack">
        <DocumentForm title={editingId ? "Edit Estimate" : "Estimate"} form={form} setForm={setForm} customers={customers.data?.items || []} users={settings.data?.users || []} onSubmit={save} submitLabel={editingId ? "Update Estimate" : "Save Estimate"} disabled={action.busy} includeEstimateStatus customerLocked={Boolean(editingId)} customerLockMessage="Estimate customer is locked after creation." onNew={editingId ? () => { setEditingId(""); setEditingEstimate(null); setForm({ customer_id: "", document_date: new Date().toISOString().slice(0, 10), expires_at: "", follow_up_at: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] }); } : null} />
        {editingId && editingEstimate && <BundleEditor api={api} documentType="estimate" documentId={editingId} items={editingEstimate.items || []} bundles={editingEstimate.bundles || []} locked={Boolean(editingEstimate.converted_order_id)} onSaved={async () => setEditingEstimate(await api.get(`/estimates/${editingId}`))} />}
      </div>
    </TwoColumn>
  );
}

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

function OrderIntakePage({ api }) {
  const [filters, setFilters] = useState({ status: "all", search: "" });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState({ status: "reviewing", customer_id: "", assigned_user_id: "", follow_up_at: "", summary: "", internal_notes: "" });
  const [customerForm, setCustomerForm] = useState({ contact_name: "", business_name: "", email: "", phone: "" });
  const [linkOrderId, setLinkOrderId] = useState("");
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const query = `/orders/intake?status=${encodeURIComponent(filters.status)}&search=${encodeURIComponent(filters.search)}`;
  const intake = useLoad(() => api.get(query), [filters.status, filters.search]);
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const orders = useLoad(() => api.get("/orders"), []);
  const selected = (intake.data?.items || []).find((item) => item.id === selectedId) || intake.data?.items?.[0] || null;

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraft({
      status: selected.status,
      customer_id: selected.customer_id || "",
      assigned_user_id: selected.assigned_user_id || "",
      follow_up_at: selected.follow_up_at || "",
      summary: selected.summary || "",
      internal_notes: selected.internal_notes || "",
    });
    setCustomerForm({
      contact_name: selected.source_message?.sender_name || selected.source_message?.sender_email || "",
      business_name: "",
      email: selected.source_message?.sender_email || "",
      phone: "",
    });
  }, [selected?.id]);

  async function refresh() {
    await intake.refresh();
    await orders.refresh();
    await customers.refresh();
  }

  async function save() {
    if (!selected) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.patch(`/orders/intake/${selected.id}`, { ...draft, customer_id: draft.customer_id || null, assigned_user_id: draft.assigned_user_id || null, follow_up_at: draft.follow_up_at || null, internal_notes: draft.internal_notes || null });
      await refresh();
      setAction({ busy: false, error: "", saved: "Intake Item updated" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function createCustomer() {
    if (!selected) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post(`/orders/intake/${selected.id}/customer`, { ...customerForm, email: customerForm.email || null, phone: customerForm.phone || null });
      await refresh();
      setAction({ busy: false, error: "", saved: "Customer matched to Intake Item" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function createDraftOrder() {
    if (!selected) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.post(`/orders/intake/${selected.id}/create-draft-order`, { customer_id: draft.customer_id || selected.customer_id || null, title: draft.summary || selected.summary });
      await refresh();
      setAction({ busy: false, error: "", saved: `Draft Order ${result.order.order_number} ready` });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function linkOrder() {
    if (!selected || !linkOrderId) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.post(`/orders/intake/${selected.id}/link-order`, { order_id: linkOrderId });
      await refresh();
      setAction({ busy: false, error: "", saved: `Linked to ${result.order.order_number}` });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  return (
    <TwoColumn wide>
      <section className="panel order-intake-list">
        <Toolbar title="Order Intake">
          <input placeholder="Search intake" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="all">All</option>
            {Object.entries(INTAKE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Toolbar>
        <div className="notice">Forward order-related email to the tenant intake address shown in Settings. Slim does not synchronize the shop mailbox.</div>
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="success-state">{action.saved}</div>}
        <AsyncState state={intake} empty="No forwarded order emails">
          <div className="record-list">
            {(intake.data?.items || []).map((item) => (
              <button type="button" className={selected?.id === item.id ? "record-row selectable active" : "record-row selectable"} key={item.id} onClick={() => setSelectedId(item.id)}>
                <div><strong>{item.summary}</strong><span>{item.sender_email || item.source_message?.sender_email || "Email"} / {INTAKE_STATUS_LABELS[item.status]}</span></div>
                <span>{item.received_at ? formatDate(item.received_at) : ""}</span>
              </button>
            ))}
          </div>
        </AsyncState>
      </section>
      <section className="panel intake-detail">
        {!selected ? <div className="empty-state">Select an Intake Item</div> : (
          <>
            <Toolbar title={selected.summary}>
              {selected.converted_order_id && <a href={`#/orders/${selected.converted_order_id}`}>Open Draft Order</a>}
              {selected.linked_order_id && <a href={`#/orders/${selected.linked_order_id}`}>Open Linked Order</a>}
            </Toolbar>
            <div className="source-message-card">
              <strong>{selected.source_message?.subject || selected.summary}</strong>
              <span>From {selected.source_message?.sender_name || selected.source_message?.sender_email}</span>
              <span>Received {selected.source_message?.received_at ? new Date(selected.source_message.received_at).toLocaleString() : ""}</span>
              <p>{selected.source_message?.text_body || "No plain text body was provided."}</p>
              <div className="compact-attachment-list">
                {(selected.attachments || []).length === 0 ? <span>No attachments</span> : selected.attachments.map((attachment) => (
                  <article className="compact-attachment" key={attachment.id}>
                    <strong>{attachment.original_filename}</strong>
                    <span>{attachment.mime_type} / {attachment.byte_size} bytes / {attachment.accepted ? "accepted" : attachment.rejection_reason}</span>
                  </article>
                ))}
              </div>
            </div>
            <div className="intake-control-grid">
              <SelectField label="Status" value={draft.status} onChange={(status) => setDraft({ ...draft, status })}>
                {Object.entries(INTAKE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectField>
              <SelectField label="Customer" value={draft.customer_id} onChange={(customer_id) => setDraft({ ...draft, customer_id })}>
                <option value="">Unmatched</option>
                {(customers.data?.items || []).map((customer) => <option key={customer.id} value={customer.id}>{customer.business_name || customer.contact_name}</option>)}
              </SelectField>
              <SelectField label="Assigned" value={draft.assigned_user_id} onChange={(assigned_user_id) => setDraft({ ...draft, assigned_user_id })}>
                <option value="">Unassigned</option>
                {(settings.data?.users || []).filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}
              </SelectField>
              <Field label="Follow-up" type="date" value={draft.follow_up_at} onChange={(follow_up_at) => setDraft({ ...draft, follow_up_at })} />
              <Field label="Summary" value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} />
              <Field label="Internal notes" value={draft.internal_notes} onChange={(internal_notes) => setDraft({ ...draft, internal_notes })} />
            </div>
            <div className="row-actions intake-actions">
              <button type="button" onClick={save} disabled={action.busy}><Save size={14} />Save Intake</button>
              <button type="button" onClick={createDraftOrder} disabled={action.busy || (!draft.customer_id && !selected.customer_id) || selected.converted_order_id || selected.linked_order_id}><ShoppingBag size={14} />Create Draft Order</button>
              <select aria-label="Existing Order" value={linkOrderId} onChange={(event) => setLinkOrderId(event.target.value)}>
                <option value="">Select existing Order</option>
                {(orders.data?.items || []).map((order) => <option value={order.id} key={order.id}>{order.order_number} / {order.customer_summary?.business_name || order.customer_summary?.contact_name}</option>)}
              </select>
              <button type="button" onClick={linkOrder} disabled={action.busy || !linkOrderId || selected.converted_order_id}><FileText size={14} />Link Order</button>
            </div>
            {!draft.customer_id && (
              <form className="inline-form intake-customer-create" onSubmit={(event) => { event.preventDefault(); createCustomer(); }}>
                <input placeholder="Contact name" value={customerForm.contact_name} onChange={(event) => setCustomerForm({ ...customerForm, contact_name: event.target.value })} />
                <input placeholder="Business" value={customerForm.business_name} onChange={(event) => setCustomerForm({ ...customerForm, business_name: event.target.value })} />
                <input placeholder="Email" type="email" value={customerForm.email} onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })} />
                <input placeholder="Phone" value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} />
                <button disabled={action.busy}><UserPlus size={14} />Create Customer</button>
              </form>
            )}
          </>
        )}
      </section>
    </TwoColumn>
  );
}

function draftLineTotalCents(item) {
  return Math.round(cents(item.unit_price) * Number(item.quantity_decimal || 0));
}

function draftSubtotalCents(items) {
  return items.reduce((total, item) => total + draftLineTotalCents(item), 0);
}

function CustomerSummary({ customer, compact = false }) {
  if (!customer) return <div className="empty-state">Select a customer to show order customer information.</div>;
  const address = customer.billing_address || blankAddress;
  return (
    <section className={compact ? "customer-summary compact" : "workspace-section customer-summary"}>
      {!compact && <h3>Customer Summary</h3>}
      <span>{customer.contact_name}</span>
      <span>{customer.business_name || "No business name"}</span>
      <span>{customer.tax_exempt ? "Tax exempt" : "Taxable"}</span>
      {customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : <span>No email</span>}
      {customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : <span>No phone</span>}
      <span>{address.line1 ? `${address.line1}, ${address.city}, ${address.state} ${address.postal_code}` : "No billing address"}</span>
    </section>
  );
}

function EmailComposerModal({ api, endpoint, title, defaultSubject, defaultBody, defaultTo = "", savedCustomerEmail = "", onClose, onSent }) {
  const [form, setForm] = useState({ to_email: defaultTo || savedCustomerEmail || "", cc: "", subject: defaultSubject || "", body_text: defaultBody || "", attach_document: true });
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  async function send(event) {
    event.preventDefault();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const to = form.to_email.trim();
      const saved = savedCustomerEmail.trim().toLowerCase();
      await api.post(endpoint, {
        idempotency_key: `${Date.now()}-${clientSideId()}`,
        to_email: to || undefined,
        cc: form.cc.split(",").map((email) => email.trim()).filter(Boolean),
        subject: form.subject,
        body_text: form.body_text,
        attach_document: form.attach_document,
        confirm_unsaved_recipient: Boolean(saved && to && saved !== to.toLowerCase()),
      });
      setAction({ busy: false, error: "", saved: "Email accepted by SendGrid" });
      onSent?.();
      window.setTimeout(onClose, 350);
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }
  return (
    <div className="modal-scrim">
      <form className="modal-card email-composer" onSubmit={send} role="dialog" aria-modal="true" aria-label={title}>
        <Toolbar title={title}><button type="button" onClick={onClose}>Close</button></Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="success-state">{action.saved}</div>}
        <Field label="To" type="email" value={form.to_email} onChange={(to_email) => setForm({ ...form, to_email })} />
        <Field label="CC" value={form.cc} onChange={(cc) => setForm({ ...form, cc })} />
        <Field label="Subject" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
        <label className="text-area-field"><span>Message</span><textarea value={form.body_text} onChange={(event) => setForm({ ...form, body_text: event.target.value })} /></label>
        <label className="check-row"><input type="checkbox" checked={form.attach_document} onChange={(event) => setForm({ ...form, attach_document: event.target.checked })} />Attach document when available</label>
        <button className="primary-button" disabled={action.busy}><Mail size={16} />Send</button>
      </form>
    </div>
  );
}

function EmailAction({ api, endpoint, title, defaultSubject, defaultBody, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}><Mail size={14} />{children || "Email"}</button>
      {open && <EmailComposerModal api={api} endpoint={endpoint} title={title} defaultSubject={defaultSubject} defaultBody={defaultBody} onClose={() => setOpen(false)} />}
    </>
  );
}

function CommunicationPanel({ api, customerId, relatedEntityType = "customer", relatedEntityId = "", savedCustomerEmail = "", onEmail }) {
  const query = relatedEntityId
    ? `/communications?customer_id=${encodeURIComponent(customerId)}&related_entity_type=${encodeURIComponent(relatedEntityType)}&related_entity_id=${encodeURIComponent(relatedEntityId)}`
    : `/communications?customer_id=${encodeURIComponent(customerId)}`;
  const state = useLoad(() => customerId ? api.get(query) : Promise.resolve({ items: [] }), [customerId, relatedEntityType, relatedEntityId]);
  const [form, setForm] = useState({ channel: "phone", direction: "inbound", subject: "", body_text: "" });
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  async function save(event) {
    event.preventDefault();
    if (!customerId) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post("/communications", {
        customer_id: customerId,
        ...form,
        subject: form.subject || null,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId || customerId,
      });
      setForm({ channel: "phone", direction: "inbound", subject: "", body_text: "" });
      state.refresh();
      setAction({ busy: false, error: "", saved: "Communication note added" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }
  return (
    <section className="workspace-card communication-panel" data-region="communications">
      <Toolbar title="Communication Activity">
        {onEmail && <button type="button" onClick={onEmail}><Mail size={14} />Email Customer</button>}
      </Toolbar>
      {savedCustomerEmail && <span className="muted-copy">Customer email: {savedCustomerEmail}</span>}
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <form className="compact-note-form" onSubmit={save}>
        <select aria-label="Communication channel" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
          <option value="phone">Phone</option>
          <option value="walk_in">Walk-in</option>
          <option value="email">External email</option>
          <option value="manual">Manual</option>
        </select>
        <select aria-label="Direction" value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
        <input placeholder="Summary" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
        <textarea placeholder="Note" value={form.body_text} onChange={(event) => setForm({ ...form, body_text: event.target.value })} />
        <button disabled={action.busy}><MessageSquare size={14} />Add Note</button>
      </form>
      <AsyncState state={state} empty="No communication activity">
        <div className="timeline-list">
          {(state.data?.items || []).map((entry) => (
            <article className="timeline-entry" key={entry.id}>
              <strong>{entry.summary}</strong>
              <span>{entry.channel.replace("_", " ")} / {entry.direction}{entry.delivery_state ? ` / ${entry.delivery_state}` : ""}</span>
              {entry.subject && <span>{entry.subject}</span>}
              <small>{new Date(entry.created_at).toLocaleString()}</small>
            </article>
          ))}
        </div>
      </AsyncState>
    </section>
  );
}

function TotalsSummary({ order, form }) {
  const liveSubtotal = draftSubtotalCents(form.items || []);
  const discount = cents(form.discount || "0");
  return (
    <section className="workspace-section totals-summary">
      <h3>Totals</h3>
      <span>Subtotal <strong>{order ? money(order.subtotal_cents) : money(liveSubtotal)}</strong></span>
      <span>Discount <strong>{order ? money(order.discount_cents) : money(discount)}</strong></span>
      <span>Tax <strong>{order ? money(order.tax_cents) : "Calculated on save"}</strong></span>
      <span>Total <strong>{order ? money(order.total_cents) : "Assigned on save"}</strong></span>
    </section>
  );
}

function progressParts(progress, fallbackItems = []) {
  if (progress) return progress;
  const required = fallbackItems.filter((item) => item.production_required);
  const completed = required.filter((item) => item.completed || item.production_stage === "complete");
  return { completed: completed.length, total: required.length, percent: required.length ? Math.round((completed.length / required.length) * 100) : null };
}

function saveStateText(action, dirty, fallback = "Saved") {
  if (action.busy) return "Saving";
  if (action.error) return "Save Failed";
  if (action.saved) return action.saved;
  return dirty ? "Unsaved" : fallback;
}

function OrderWorkspaceShell({ label, title, status, customerName, dueDate, total, progress, saveState, children, formRef, onSubmit }) {
  return (
    <div className="workspace-overlay" aria-label="Order Workspace backdrop">
      <form className="order-workspace command-center" role="dialog" aria-modal="true" aria-label={label} tabIndex="-1" ref={formRef} onSubmit={onSubmit}>
        <header className="workspace-header compact-workspace-header" data-region="workspace-header">
          <div>
            <h2>{title}</h2>
          </div>
          <span className="status-chip">{status}</span>
          <span><strong>Customer</strong>{customerName || "Not selected"}</span>
          <span><strong>Due</strong>{dueDate || "None"}</span>
          <span><strong>Total</strong>{total}</span>
          <span><strong>Production</strong>{formatProgress(progress)}</span>
          <span><strong>Save</strong>{saveState}</span>
        </header>
        {children}
      </form>
    </div>
  );
}

function OrderSummaryCard({ order, form, invoice = null, progress }) {
  const liveSubtotal = draftSubtotalCents(form.items || []);
  const discount = cents(form.discount || "0");
  const summaryProgress = progressParts(progress, form.items || []);
  return (
    <section className="workspace-card order-summary-region" data-region="order-summary">
      <h3>Order Summary</h3>
      <div className="summary-lines">
        <span>Subtotal <strong>{order ? money(order.subtotal_cents) : money(liveSubtotal)}</strong></span>
        <span>Discount <strong>{order ? money(order.discount_cents) : money(discount)}</strong></span>
        <span>Tax <strong>{order ? money(order.tax_cents) : "On save"}</strong></span>
        <span className="grand-total">Total <strong>{order ? money(order.total_cents) : "On save"}</strong></span>
        <span>Invoice <strong>{invoice?.document_status || "No invoice"}</strong></span>
        <span>Payment <strong>{invoice?.payment_status || "No payment"}</strong></span>
        <span>Production <strong>{formatProgress(summaryProgress)}</strong></span>
        <span>Items <strong>{summaryProgress.completed}/{summaryProgress.total} complete</strong></span>
      </div>
    </section>
  );
}

function CameraCaptureOverlay({ orderNumber, busy, onUsePhoto, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [captured, setCaptured] = useState(null);
  const [starting, setStarting] = useState(false);

  function stopCamera() {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startCamera(index = deviceIndex) {
    stopCamera();
    setCaptured((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture is not supported in this browser. Use file upload instead.");
      return;
    }
    if (window.isSecureContext === false && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setError("Camera capture requires a secure browser context. Use file upload instead.");
      return;
    }
    setStarting(true);
    setError("");
    try {
      const selected = devices[index];
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selected?.deviceId ? { deviceId: { exact: selected.deviceId } } : { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play?.();
      }
      const available = await navigator.mediaDevices.enumerateDevices?.().catch(() => []);
      const cameras = (available || []).filter((device) => device.kind === "videoinput");
      if (cameras.length) setDevices(cameras);
    } catch (err) {
      const code = err?.name || err?.message || "camera_error";
      if (code === "NotAllowedError" || code === "PermissionDeniedError") setError("Camera permission was denied. File upload remains available.");
      else if (code === "NotFoundError" || code === "DevicesNotFoundError") setError("No camera was found on this device. Use file upload instead.");
      else if (code === "NotReadableError" || code === "TrackStartError") setError("The camera is already in use or unavailable. Use file upload instead.");
      else setError("Camera capture failed. Use file upload instead.");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    startCamera(0);
    return () => {
      stopCamera();
      setCaptured((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return null;
      });
    };
  }, []);

  async function switchCamera() {
    if (devices.length < 2) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    await startCamera(next);
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return setError("Camera capture failed. Use file upload instead.");
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setError("Camera capture failed. Use file upload instead.");
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Camera capture failed. Use file upload instead.");
        return;
      }
      stopCamera();
      const url = URL.createObjectURL(blob);
      setCaptured({ blob, url, filename: `${orderNumber || "order"}-capture-${timestampSlug()}.jpg` });
    }, "image/jpeg", 0.95);
    return undefined;
  }

  function close() {
    stopCamera();
    setCaptured((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
    onClose();
  }

  async function usePhoto() {
    if (!captured) return;
    await onUsePhoto(captured.blob, captured.filename);
    if (captured.url) URL.revokeObjectURL(captured.url);
  }

  return (
    <div className="media-workspace-overlay" role="dialog" aria-modal="true" aria-label="Capture Photo">
      <div className="media-workspace camera-workspace">
        <Toolbar title="Capture Photo">
          {devices.length > 1 && <button type="button" onClick={switchCamera} disabled={starting || busy} title="Switch camera"><SwitchCamera size={16} />Switch</button>}
          <button type="button" onClick={close} disabled={busy}>Cancel</button>
        </Toolbar>
        {error && <div className="error-state">{error}</div>}
        {!captured ? (
          <div className="camera-panel">
            <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" />
            <canvas ref={canvasRef} hidden />
            <div className="media-actions">
              <button type="button" className="primary-button" onClick={capturePhoto} disabled={starting || busy || Boolean(error)}><Camera size={16} />Capture</button>
              <button type="button" onClick={close} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="camera-panel">
            <img src={captured.url} alt="Captured preview" />
            <div className="media-actions">
              <button type="button" onClick={() => startCamera(deviceIndex)} disabled={busy}><RotateCcw size={16} />Retake</button>
              <button type="button" className="primary-button" onClick={usePhoto} disabled={busy}><CheckCircle2 size={16} />Use Photo</button>
              <button type="button" onClick={close} disabled={busy}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnnotationWorkspace({ attachment, imageUrl, busy, onSave, onClose }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const drawingRef = useRef(null);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [text, setText] = useState("Label");
  const [operations, setOperations] = useState([]);
  const [redo, setRedo] = useState([]);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  const unsaved = operations.length > 0;

  function redraw(nextOps = operations, nextDraft = draft) {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image?.naturalWidth) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    nextOps.forEach((op) => drawAnnotationOperation(ctx, canvas, op));
    if (nextDraft) drawAnnotationOperation(ctx, canvas, nextDraft);
    if (selectedId) {
      const selected = nextOps.find((op) => op.id === selectedId);
      if (selected) {
        ctx.save();
        ctx.strokeStyle = "#111827";
        ctx.setLineDash([6, 4]);
        const points = annotationPoints(selected).map((point) => pointToCanvas(point, canvas));
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        ctx.strokeRect(Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs) + 16, Math.max(...ys) - Math.min(...ys) + 16);
        ctx.restore();
      }
    }
  }

  useEffect(() => {
    redraw();
  }, [operations, draft, selectedId]);

  useEffect(() => {
    const beforeUnload = (event) => {
      if (!unsaved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [unsaved]);

  function commit(op) {
    setOperations((current) => [...current, op]);
    setRedo([]);
    setDraft(null);
    setSelectedId("");
  }

  function startDraw(event) {
    if (busy) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = normalizePointer(event, canvas);
    if (tool === "select") {
      const hit = [...operations].reverse().find((op) => annotationHit(op, point));
      setSelectedId(hit?.id || "");
      return;
    }
    if (tool === "text") {
      commit({ id: clientSideId(), type: "text", color, stroke_width: strokeWidth, point, text: text || "Label" });
      return;
    }
    const next = tool === "pen"
      ? { id: clientSideId(), type: "pen", color, stroke_width: strokeWidth, points: [point] }
      : { id: clientSideId(), type: tool, color, stroke_width: strokeWidth, start: point, end: point };
    drawingRef.current = next;
    setDraft(next);
    canvas.setPointerCapture?.(event.pointerId);
  }

  function moveDraw(event) {
    const current = drawingRef.current;
    const canvas = canvasRef.current;
    if (!current || !canvas) return;
    const point = normalizePointer(event, canvas);
    const next = current.type === "pen" ? { ...current, points: [...current.points, point] } : { ...current, end: point };
    drawingRef.current = next;
    setDraft(next);
  }

  function endDraw(event) {
    const current = drawingRef.current;
    if (!current) return;
    drawingRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.type === "pen" && current.points.length < 2) {
      setDraft(null);
      return;
    }
    commit(current);
  }

  function undo() {
    setOperations((current) => {
      if (!current.length) return current;
      const next = current.slice(0, -1);
      setRedo((redoOps) => [current.at(-1), ...redoOps]);
      return next;
    });
    setSelectedId("");
  }

  function redoOne() {
    setRedo((current) => {
      if (!current.length) return current;
      const [first, ...rest] = current;
      setOperations((ops) => [...ops, first]);
      return rest;
    });
  }

  function clearAll() {
    if (!operations.length || !window.confirm("Clear all annotations?")) return;
    setRedo([...operations, ...redo]);
    setOperations([]);
    setSelectedId("");
  }

  function deleteSelected() {
    if (!selectedId) return;
    setOperations((current) => {
      const selected = current.find((op) => op.id === selectedId);
      if (selected) setRedo((redoOps) => [selected, ...redoOps]);
      return current.filter((op) => op.id !== selectedId);
    });
    setSelectedId("");
  }

  function cancel() {
    if (unsaved && !window.confirm("Discard unsaved annotation work?")) return;
    onClose();
  }

  async function save() {
    if (!operations.length) {
      setError("Add an annotation before saving.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setError("Could not render annotated image.");
        return;
      }
      const filename = `${safeAttachmentStem(attachment.original_filename)}-annotated-${timestampSlug()}.png`;
      try {
        await onSave(new File([blob], filename, { type: "image/png" }), operations);
      } catch (err) {
        setError(err.message);
      }
    }, "image/png");
  }

  return (
    <div className="media-workspace-overlay" role="dialog" aria-modal="true" aria-label={`Annotate ${attachment.original_filename}`}>
      <div className="media-workspace annotation-workspace">
        <Toolbar title={`Annotate ${attachment.original_filename}`}>
          <button type="button" onClick={cancel} disabled={busy}>Cancel</button>
          <button type="button" className="primary-button" onClick={save} disabled={busy || !operations.length}><Save size={16} />Save Annotated Copy</button>
        </Toolbar>
        {error && <div className="error-state">{error}</div>}
        <div className="annotation-toolbar" aria-label="Annotation tools">
          {[
            ["select", MousePointer2, "Select"],
            ["pen", PenLine, "Pen"],
            ["arrow", ArrowRight, "Arrow"],
            ["rectangle", Square, "Rectangle"],
            ["text", Type, "Text"],
          ].map(([value, Icon, label]) => (
            <button key={value} type="button" className={tool === value ? "active" : ""} onClick={() => setTool(value)} title={label} aria-pressed={tool === value}><Icon size={16} />{label}</button>
          ))}
          <label>Color<select className="visually-hidden" aria-label="Annotation color" value={color} onChange={(event) => setColor(event.target.value)}>{ANNOTATION_COLORS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <div className="annotation-swatches">{ANNOTATION_COLORS.map((entry) => <button key={entry} type="button" className={color === entry ? "active swatch" : "swatch"} style={{ "--swatch": entry }} title={entry} aria-label={`Use ${entry}`} onClick={() => setColor(entry)} />)}</div>
          <label>Stroke<select aria-label="Stroke width" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))}>{ANNOTATION_WIDTHS.map((width) => <option key={width} value={width}>{width}px</option>)}</select></label>
          <label>Text<input aria-label="Text label" value={text} onChange={(event) => setText(event.target.value)} maxLength={160} /></label>
          <button type="button" onClick={undo} disabled={!operations.length} title="Undo"><Undo2 size={16} />Undo</button>
          <button type="button" onClick={redoOne} disabled={!redo.length} title="Redo"><Redo2 size={16} />Redo</button>
          <button type="button" onClick={deleteSelected} disabled={!selectedId} title="Delete selected"><Trash2 size={16} />Delete</button>
          <button type="button" onClick={clearAll} disabled={!operations.length} title="Clear all"><Eraser size={16} />Clear</button>
        </div>
        <div className="annotation-canvas-wrap">
          <img ref={imageRef} src={imageUrl} alt="" onLoad={() => redraw()} />
          <canvas
            ref={canvasRef}
            aria-label="Annotation canvas"
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
      </div>
    </div>
  );
}

function annotationPoints(op) {
  if (op.type === "pen") return op.points;
  if (op.type === "text") return [op.point];
  return [op.start, op.end];
}

function annotationHit(op, point) {
  const points = annotationPoints(op);
  const minX = Math.min(...points.map((entry) => entry.x)) - 0.03;
  const maxX = Math.max(...points.map((entry) => entry.x)) + 0.03;
  const minY = Math.min(...points.map((entry) => entry.y)) - 0.03;
  const maxY = Math.max(...points.map((entry) => entry.y)) + 0.03;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function OperationalStatusRail({ order, form, attachments = [], preview = null, onUpload, onCapture, onAnnotate, onOpenOriginal, onSchedule, onInvoice, onPreview, onDownload, onDelete, onClosePreview }) {
  const progress = progressParts(order?.production_progress, form.items || []);
  const stageSummary = PRODUCTION_STAGES
    .map((stage) => ({ stage, count: (form.items || []).filter((item) => item.production_required && (item.production_stage || "not_started") === stage).length }))
    .filter((entry) => entry.count);
  const assigned = (form.items || []).filter((item) => item.assigned_user_id).length;
  return (
    <aside className="operational-status-region" data-region="operational-status">
      <section className="workspace-card mini-status-card">
        <h3>Production</h3>
        <span>Required <strong>{progress.total}</strong></span>
        <span>Completed <strong>{progress.completed}</strong></span>
        <span>Assigned <strong>{assigned}</strong></span>
        <span>Stages <strong>{stageSummary.length ? stageSummary.map((entry) => `${STAGE_LABELS[entry.stage]} ${entry.count}`).join(", ") : "None"}</strong></span>
      </section>
      <section className="workspace-card mini-status-card">
        <h3>Artwork & Files</h3>
        <span>Attachments <strong>{attachments.length}</strong></span>
        <div className="row-actions attachment-primary-actions">
          <button type="button" onClick={onUpload}><Upload size={14} />Upload File</button>
          <button type="button" onClick={onCapture}><Camera size={14} />Capture Photo</button>
        </div>
        <div className="compact-attachment-list">
          {attachments.length === 0 ? <span>No attachments</span> : attachments.map((attachment) => (
            <article className="compact-attachment" key={attachment.id}>
              <strong>{attachment.original_filename}</strong>
              <span className={attachment.source_type === "annotation_derivative" ? "attachment-kind annotated" : "attachment-kind"}>{attachment.source_type === "annotation_derivative" ? "Annotated" : "Original"}{attachment.source_type === "device_capture" ? " / Captured" : ""}</span>
              <span>{attachment.mime_type} / {attachment.byte_size} bytes</span>
              {attachment.image_width && attachment.image_height && <span>{attachment.image_width} x {attachment.image_height}</span>}
              <div className="row-actions">
                {attachment.previewable && <button type="button" onClick={() => onPreview?.(attachment)}>Preview</button>}
                {isImageAttachment(attachment) && <button type="button" onClick={() => onAnnotate?.(attachment)}><PenLine size={14} />Annotate</button>}
                {attachment.original_attachment_id && <button type="button" onClick={() => onOpenOriginal?.(attachment)}><FileText size={14} />Original</button>}
                <button type="button" onClick={() => onDownload?.(attachment)}><Download size={14} />Download</button>
                <button type="button" onClick={() => onDelete?.(attachment)}><Trash2 size={14} />Delete</button>
              </div>
            </article>
          ))}
        </div>
        {preview && <div className="attachment-preview compact-preview">
          <Toolbar title={preview.name}><button type="button" onClick={onClosePreview}>Close Preview</button></Toolbar>
          {preview.mime_type.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : <iframe title={preview.name} src={preview.url} sandbox="" />}
        </div>}
      </section>
      <section className="workspace-card mini-status-card">
        <h3>Schedule</h3>
        <span>{order?.due_date ? `Due ${formatDate(order.due_date)}` : "Unscheduled"}</span>
      </section>
      <section className="workspace-card mini-status-card">
        <h3>Invoice</h3>
        <span>{order?.invoice?.invoice_number || "No invoice"}</span>
        <span>{order?.invoice?.payment_status || "No payment status"}</span>
      </section>
    </aside>
  );
}

function WorkspaceOrderInfoCard({ form, onUpdate, invoiced = false }) {
  return (
    <section className="workspace-card order-info-region" data-region="order-info">
      <h3>Order Info</h3>
      <Field label="Order title" value={form.title || ""} onChange={(title) => onUpdate({ title })} />
      <Field label="Document date" type="date" value={form.document_date} onChange={(document_date) => onUpdate({ document_date })} />
      <Field label="Due date" type="date" value={form.due_date} onChange={(due_date) => onUpdate({ due_date })} />
      <SelectField label="Order status" value={form.status} onChange={(status) => onUpdate({ status })}>
        {["draft", "active", "on_hold", "complete", "cancelled"].map((status) => <option key={status}>{status}</option>)}
      </SelectField>
      <Field label="Discount" value={form.discount} disabled={invoiced} onChange={(discount) => onUpdate({ discount })} />
      <Field label="Internal notes" value={form.internal_notes} onChange={(internal_notes) => onUpdate({ internal_notes })} />
    </section>
  );
}

function WorkspaceCustomerCard({ api, customers = [], selectedCustomer, customerId, onCustomer, allowInlineCreate = false }) {
  return (
    <section className="workspace-card customer-info-region" data-region="customer-info">
      <h3>Customer</h3>
      <SelectField label="Customer" value={customerId} onChange={onCustomer}>
        <option value="">Select customer</option>
        {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.business_name || customer.contact_name}</option>)}
      </SelectField>
      {allowInlineCreate && (
        <InlineCustomerCreator api={api} onCreated={(customer) => onCustomer(customer.id, customer)} />
      )}
      <CustomerSummary customer={selectedCustomer} compact />
    </section>
  );
}

function OrderItemsTable({ items, users = [], invoiced = false, onItemChange, onAdd, onMove, onDuplicate, onRemove }) {
  const activeUsers = users.filter((user) => user.active !== false);
  return (
    <section className="workspace-card order-items-region" data-region="order-items">
      <h3>Order Items</h3>
      <div className="workspace-item-table" role="table" aria-label="Order items">
        <div className="workspace-item-row workspace-item-head" role="row">
          <span>Title</span>
          <span>Description</span>
          <span>Qty</span>
          <span>Unit</span>
          <span>Line</span>
          <span>Tax</span>
          <span>Prod</span>
          <span>Due</span>
          <span>Assigned</span>
          <span>Stage</span>
          <span>Done</span>
          <span>Note</span>
          <span>Actions</span>
        </div>
        {items.map((item, index) => (
          <div className="workspace-item-row" role="row" key={item.client_id}>
            <input aria-label="Item title" value={item.title || ""} disabled={invoiced} onChange={(event) => onItemChange(index, { title: event.target.value })} />
            <input aria-label="Description" value={item.description} disabled={invoiced} onChange={(event) => onItemChange(index, { description: event.target.value })} />
            <input aria-label="Qty" value={item.quantity_decimal} disabled={invoiced} onChange={(event) => onItemChange(index, { quantity_decimal: event.target.value })} />
            <input aria-label="Unit price" value={item.unit_price} disabled={invoiced} onChange={(event) => onItemChange(index, { unit_price: event.target.value })} />
            <span className="line-total">{money(draftLineTotalCents(item))}</span>
            <label className="icon-check" title="Taxable"><input aria-label="Taxable" type="checkbox" checked={item.taxable} disabled={invoiced} onChange={(event) => onItemChange(index, { taxable: event.target.checked })} /></label>
            <label className="icon-check" title="Production"><input aria-label="Production" type="checkbox" checked={item.production_required} onChange={(event) => onItemChange(index, { production_required: event.target.checked })} /></label>
            <input aria-label="Due date" type="date" value={item.due_date} onChange={(event) => onItemChange(index, { due_date: event.target.value })} />
            <select aria-label="Assigned user" value={item.assigned_user_id} onChange={(event) => onItemChange(index, { assigned_user_id: event.target.value })}>
              <option value="">Unassigned</option>
              {activeUsers.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
            </select>
            <select aria-label="Production stage" value={item.production_stage || "not_started"} onChange={(event) => onItemChange(index, { production_stage: event.target.value, completed: event.target.value === "complete" })}>
              {PRODUCTION_STAGES.map((stage) => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}
            </select>
            <label className="icon-check" title="Done"><input aria-label="Done" type="checkbox" checked={item.completed} onChange={(event) => onItemChange(index, { completed: event.target.checked, production_stage: event.target.checked ? "complete" : "in_progress" })} /></label>
            <input aria-label="Item note" value={item.internal_note} onChange={(event) => onItemChange(index, { internal_note: event.target.value })} />
            <div className="item-actions compact-item-actions">
              {!invoiced && <>
                <button type="button" title="Move up" onClick={() => onMove(index, -1)}><ArrowUp size={14} /></button>
                <button type="button" title="Move down" onClick={() => onMove(index, 1)}><ArrowDown size={14} /></button>
                <button type="button" title="Duplicate" onClick={() => onDuplicate(index)}><Copy size={14} /></button>
                <button type="button" title="Remove" onClick={() => onRemove(index)}><Trash2 size={14} /></button>
              </>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function productionSetupPreview(mode, items, groups, assignments) {
  const productionItems = items.filter((item) => item.production_required);
  if (mode === "whole_order") return productionItems.length ? [{ title: "Entire Order", count: productionItems.length }] : [];
  if (mode === "individual_items") return productionItems.map((item) => ({ title: item.title || item.description, count: 1 }));
  const custom = groups
    .map((group) => ({ title: group.title || "Untitled group", count: productionItems.filter((item) => assignments[item.id || item.client_id] === group.client_id).length }))
    .filter((entry) => entry.count);
  const independent = productionItems.filter((item) => assignments[item.id || item.client_id] === "independent").map((item) => ({ title: item.title || item.description, count: 1 }));
  return [...custom, ...independent];
}

function ProductionSetupCard({ api, order = null, items = [], dirty = false, onDone }) {
  const productionItems = items.filter((item) => item.production_required);
  const [mode, setMode] = useState(order?.production_grouping_mode || "whole_order");
  const [groups, setGroups] = useState([{ client_id: clientSideId(), title: "Main Production Group" }]);
  const [assignments, setAssignments] = useState({});
  const [reason, setReason] = useState("");
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const submitInFlight = useRef(false);
  const released = Boolean(order?.sent_to_production_at || order?.work_orders?.length);
  const preview = productionSetupPreview(mode, productionItems, groups, assignments);
  const unassigned = mode === "custom_groups"
    ? productionItems.filter((item) => !assignments[item.id || item.client_id])
    : [];
  const canSend = order && !dirty && productionItems.length > 0 && (mode !== "custom_groups" || unassigned.length === 0) && preview.length > 0;

  async function submit() {
    if (!canSend || submitInFlight.current) return;
    submitInFlight.current = true;
    setAction({ busy: true, error: "", saved: "" });
    const payload = { mode };
    if (mode === "custom_groups") {
      payload.groups = groups.map((group) => ({
        title: group.title,
        item_ids: productionItems.filter((item) => assignments[item.id || item.client_id] === group.client_id).map((item) => item.id),
      })).filter((group) => group.item_ids.length);
      payload.independent_item_ids = productionItems.filter((item) => assignments[item.id || item.client_id] === "independent").map((item) => item.id);
    }
    if (released) {
      payload.reason = reason;
      payload.calendar_resolution = "return_to_order";
    }
    try {
      await api.post(`/orders/${order.id}/production/${released ? "regroup" : "send"}`, payload);
      setAction({ busy: false, error: "", saved: released ? "Regrouped" : "Sent to production" });
      onDone?.();
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    } finally {
      submitInFlight.current = false;
    }
  }

  return (
    <section className="workspace-card production-setup-region" data-region="production-setup">
      <h3>Production Setup</h3>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <p className="muted-copy">How should this Order move through production?</p>
      <div className="segmented-options" role="radiogroup" aria-label="Production grouping mode">
        {[
          ["whole_order", "Keep the entire Order together"],
          ["individual_items", "Track every Order Item separately"],
          ["custom_groups", "Create custom production groups"],
        ].map(([value, label]) => (
          <button type="button" className={mode === value ? "active" : ""} key={value} onClick={() => setMode(value)}>{label}</button>
        ))}
      </div>
      {mode === "custom_groups" && (
        <div className="production-group-builder">
          <div className="row-actions">
            <button type="button" onClick={() => setGroups([...groups, { client_id: clientSideId(), title: "New Group" }])}><Plus size={14} />Group</button>
          </div>
          {groups.map((group) => (
            <div className="group-editor-row" key={group.client_id}>
              <Field label="Group name" value={group.title} onChange={(title) => setGroups(groups.map((entry) => entry.client_id === group.client_id ? { ...entry, title } : entry))} />
              <button type="button" disabled={Object.values(assignments).includes(group.client_id)} onClick={() => setGroups(groups.filter((entry) => entry.client_id !== group.client_id))}><Trash2 size={14} />Remove</button>
            </div>
          ))}
          {productionItems.map((item) => (
            <div className="assignment-row" key={item.id || item.client_id}>
              <strong>{item.title || item.description}</strong>
              <select aria-label={`Production group for ${item.title || item.description}`} value={assignments[item.id || item.client_id] || ""} onChange={(event) => setAssignments({ ...assignments, [item.id || item.client_id]: event.target.value })}>
                <option value="">Unassigned</option>
                <option value="independent">Leave independent</option>
                {groups.map((group) => <option value={group.client_id} key={group.client_id}>{group.title}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {unassigned.length > 0 && <div className="notice">{unassigned.length} production item{unassigned.length === 1 ? "" : "s"} still need assignment.</div>}
      <div className="work-order-preview">
        <strong>{preview.length} Work Order{preview.length === 1 ? "" : "s"} will be created</strong>
        {preview.map((entry, index) => <span key={`${entry.title}-${index}`}>Work Order {index + 1} - {entry.title} - {entry.count} item{entry.count === 1 ? "" : "s"}</span>)}
        {items.filter((item) => !item.production_required).map((item) => <span key={item.id || item.client_id}>Excluded - {item.title || item.description}</span>)}
      </div>
      {released && <Field label="Regroup reason" value={reason} onChange={setReason} />}
      <button type="button" className="primary-button" disabled={!canSend || action.busy} onClick={submit}>{released ? "Regroup Work Orders" : "Send to Production"}</button>
      {!order && <div className="notice">Save the draft before sending it to production.</div>}
      {dirty && order && <div className="notice">Save Order changes before sending or regrouping production.</div>}
    </section>
  );
}

function BundleEditor({ api, documentType, documentId, items = [], bundles = [], locked = false, onSaved }) {
  const [drafts, setDrafts] = useState(() => bundles.length ? bundles.map((bundle) => ({
    client_id: bundle.id || clientSideId(),
    title: bundle.title,
    description: bundle.description || "",
    pricing_mode: bundle.pricing_mode,
    manual_total: bundle.manual_total_cents ? String(bundle.manual_total_cents / 100) : "",
    override_reason: bundle.override_reason || "",
    show_member_prices: bundle.show_member_prices !== false,
    item_ids: (bundle.items || []).map((item) => item.id),
  })) : []);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  useEffect(() => {
    setDrafts(bundles.length ? bundles.map((bundle) => ({
      client_id: bundle.id || clientSideId(),
      title: bundle.title,
      description: bundle.description || "",
      pricing_mode: bundle.pricing_mode,
      manual_total: bundle.manual_total_cents ? String(bundle.manual_total_cents / 100) : "",
      override_reason: bundle.override_reason || "",
      show_member_prices: bundle.show_member_prices !== false,
      item_ids: (bundle.items || []).map((item) => item.id),
    })) : []);
  }, [documentId, bundles.length]);
  function update(index, changes) {
    setDrafts(drafts.map((bundle, i) => i === index ? { ...bundle, ...changes } : bundle));
  }
  async function save() {
    if (!documentId || locked) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const payload = {
        bundles: drafts.map((bundle, index) => ({
          title: bundle.title,
          description: bundle.description || null,
          display_order: index,
          pricing_mode: bundle.pricing_mode,
          manual_total_cents: bundle.pricing_mode === "bundle_price" ? cents(bundle.manual_total) : null,
          override_reason: bundle.override_reason || null,
          show_member_prices: bundle.show_member_prices,
          item_ids: bundle.item_ids,
        })),
      };
      await api.put(`/${documentType}s/${documentId}/bundles`, payload);
      setAction({ busy: false, error: "", saved: "Bundles saved" });
      onSaved?.();
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }
  return (
    <section className="workspace-card bundle-editor-region" data-region="bundle-editor">
      <h3>Customer Bundles</h3>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <div className="row-actions">
        <button type="button" disabled={locked} onClick={() => setDrafts([...drafts, { client_id: clientSideId(), title: "New Bundle", description: "", pricing_mode: "itemized_subtotal", manual_total: "", override_reason: "", show_member_prices: true, item_ids: [] }])}><Plus size={14} />Bundle</button>
        <button type="button" disabled={locked || action.busy || !documentId} onClick={save}><Save size={14} />Update Bundles</button>
      </div>
      {drafts.length === 0 && <div className="empty-state">No customer-facing bundles</div>}
      {drafts.map((bundle, index) => (
        <article className="bundle-editor" key={bundle.client_id}>
          <Field label="Bundle title" value={bundle.title} onChange={(title) => update(index, { title })} />
          <Field label="Description" value={bundle.description} onChange={(description) => update(index, { description })} />
          <SelectField label="Pricing mode" value={bundle.pricing_mode} onChange={(pricing_mode) => update(index, { pricing_mode })}>
            <option value="itemized_subtotal">Itemized subtotal</option>
            <option value="bundle_price">Bundle price</option>
          </SelectField>
          {bundle.pricing_mode === "bundle_price" && <Field label="Bundle total" value={bundle.manual_total} onChange={(manual_total) => update(index, { manual_total })} />}
          {bundle.pricing_mode === "bundle_price" && <Field label="Override reason" value={bundle.override_reason} onChange={(override_reason) => update(index, { override_reason })} />}
          <label className="check-row"><input type="checkbox" checked={bundle.show_member_prices} onChange={(event) => update(index, { show_member_prices: event.target.checked })} />Show member prices</label>
          <div className="bundle-members">
            {items.map((item) => (
              <label className="check-row" key={item.id || item.client_id}>
                <input type="checkbox" checked={bundle.item_ids.includes(item.id)} disabled={!item.id} onChange={(event) => {
                  const item_ids = event.target.checked ? [...bundle.item_ids, item.id] : bundle.item_ids.filter((id) => id !== item.id);
                  update(index, { item_ids });
                }} />
                {item.title || item.description}
              </label>
            ))}
          </div>
          <button type="button" disabled={locked} onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}><Trash2 size={14} />Remove Bundle</button>
        </article>
      ))}
    </section>
  );
}

function InlineCustomerCreator({ api, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
  const [action, setAction] = useState({ busy: false, error: "" });
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      const created = await api.post("/customers", { ...form, email: form.email || null, phone: form.phone || null, tax_exemption_note: form.tax_exemption_note || null, internal_notes: form.internal_notes || null });
      onCreated(created);
      setOpen(false);
      setForm({ contact_name: "", business_name: "", email: "", phone: "", billing_address: blankAddress, active: true, tax_exempt: false, tax_exemption_note: "", internal_notes: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)}><UserPlus size={14} />Create customer inline</button>;
  return (
    <form className="inline-customer-form form-grid" onSubmit={save}>
      <Toolbar title="New Customer"><button type="button" onClick={() => setOpen(false)}>Cancel</button></Toolbar>
      {action.error && <div className="error-state">{action.error}</div>}
      <Field label="Contact name" value={form.contact_name} onChange={(contact_name) => setForm({ ...form, contact_name })} />
      <Field label="Business name" value={form.business_name} onChange={(business_name) => setForm({ ...form, business_name })} />
      <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
      <Field label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
      <AddressFields address={form.billing_address} setAddress={(billing_address) => setForm({ ...form, billing_address })} />
      <label className="check-row"><input type="checkbox" checked={form.tax_exempt} onChange={(event) => setForm({ ...form, tax_exempt: event.target.checked })} />Tax exempt</label>
      <button className="primary-button" disabled={action.busy}><Save size={16} />Save Customer</button>
    </form>
  );
}

function NewOrderPage({ api, setWorkspaceActions, onCreated }) {
  const customers = useLoad(() => api.get("/customers"), []);
  const settings = useLoad(() => api.get("/settings"), []);
  const [form, setForm] = useState({ customer_id: "", title: "", document_date: dateOnly(), due_date: "", status: "draft", discount: "0.00", internal_notes: "", items: [newQuickItem()] });
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const dialogRef = useRef(null);
  const selectedCustomer = (customers.data?.items || []).find((customer) => customer.id === form.customer_id);

  function update(changes) {
    setDirty(true);
    setForm((current) => ({ ...current, ...changes }));
  }

  function requestBack() {
    if (dirty && !window.confirm("Discard unsaved Order Workspace changes?")) return;
    window.__signguyWorkspaceBypassHash = "#/orders";
    window.location.hash = "#/orders";
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

  function duplicateItem(index = form.items.length - 1) {
    const item = form.items[index];
    if (!item) return;
    update({ items: [...form.items.slice(0, index + 1), { ...item, id: undefined, client_id: clientSideId() }, ...form.items.slice(index + 1)] });
  }

  function removeItem(index) {
    update({ items: form.items.filter((_, i) => i !== index) });
  }

  async function save(event) {
    event?.preventDefault?.();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const order = await api.post("/orders", documentPayload(form));
      setDirty(false);
      setAction({ busy: false, error: "", saved: "Saved" });
      window.__signguyWorkspaceBypassHash = `#/orders/${order.id}`;
      onCreated(order);
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  useEffect(() => {
    const guard = () => !dirty || window.confirm("Discard unsaved Order Workspace changes?");
    window.__signguyWorkspaceCanLeave = guard;
    return () => {
      if (window.__signguyWorkspaceCanLeave === guard) delete window.__signguyWorkspaceCanLeave;
    };
  }, [dirty]);
  useEffect(() => {
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
    const keydown = (event) => {
      if (event.key === "Escape") requestBack();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dirty]);
  useEffect(() => {
    setWorkspaceActions({
      savedRecord: false,
      busy: action.busy,
      back: requestBack,
      save,
      addItem: () => update({ items: [...form.items, newQuickItem()] }),
      duplicateItem: form.items.length ? () => duplicateItem() : null,
      openCustomer: () => { window.location.hash = "#/customers"; },
      uploadArtwork: null,
      schedule: null,
      invoice: null,
    });
    return () => setWorkspaceActions(null);
  }, [action.busy, dirty, form]);

  return (
    <OrderWorkspaceShell
      label="New Order Workspace"
      title="New Order"
      status={form.status}
      customerName={selectedCustomer?.business_name || selectedCustomer?.contact_name || "Not selected"}
      dueDate={form.due_date}
      total="On save"
      progress={progressParts(null, form.items)}
      saveState={saveStateText(action, dirty, "Unsaved")}
      formRef={dialogRef}
      onSubmit={save}
    >
      {action.error && <div className="error-state">{action.error}</div>}
      <div className="order-dashboard-grid">
        <WorkspaceOrderInfoCard form={form} onUpdate={update} />
        <WorkspaceCustomerCard
          api={api}
          customers={customers.data?.items || []}
          selectedCustomer={selectedCustomer}
          customerId={form.customer_id}
          allowInlineCreate
          onCustomer={(customer_id, createdCustomer = null) => {
            if (createdCustomer) customers.refresh();
            update({ customer_id });
          }}
        />
        <OrderSummaryCard form={form} progress={progressParts(null, form.items)} />
        <ProductionSetupCard items={form.items} />
        <OrderItemsTable
          items={form.items}
          users={settings.data?.users || []}
          onItemChange={setItem}
          onAdd={() => update({ items: [...form.items, newQuickItem()] })}
          onMove={moveItem}
          onDuplicate={duplicateItem}
          onRemove={removeItem}
        />
        <OperationalStatusRail
          form={form}
          onUpload={null}
          onSchedule={null}
          onInvoice={null}
        />
      </div>
    </OrderWorkspaceShell>
  );
}

function OrderWorkspace({ orderId, api, returnRoute, returnItemId, setWorkspaceActions, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const [preview, setPreview] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [annotationTarget, setAnnotationTarget] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const dialogRef = useRef(null);
  const previewRef = useRef(null);
  const annotationTargetRef = useRef(null);
  const fileInputRef = useRef(null);

  async function load() {
    setState({ loading: true, error: "", data: null });
    try {
      const data = await api.get(`/orders/${orderId}/workspace`);
      setState({ loading: false, error: "", data });
      setForm({
        expected_updated_at: data.order.updated_at,
        title: data.order.title || "",
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
    annotationTargetRef.current = annotationTarget;
  }, [annotationTarget]);
  useEffect(() => {
    const guard = () => {
      if (annotationTarget && !window.confirm("Close annotation workspace and discard unsaved annotation work?")) return false;
      return !dirty || window.confirm("Discard unsaved Order Workspace changes?");
    };
    window.__signguyWorkspaceCanLeave = guard;
    return () => {
      if (window.__signguyWorkspaceCanLeave === guard) delete window.__signguyWorkspaceCanLeave;
    };
  }, [dirty, annotationTarget]);
  useEffect(() => {
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
    return () => {
      if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url);
      if (annotationTargetRef.current?.url) URL.revokeObjectURL(annotationTargetRef.current.url);
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
    closeAnnotation();
    setCameraOpen(false);
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
    event?.preventDefault?.();
    setAction({ busy: true, error: "", saved: "" });
    try {
      const payload = {
        expected_updated_at: form.expected_updated_at,
        title: form.title,
        document_date: form.document_date,
        due_date: form.due_date || null,
        status: form.status,
        discount_cents: cents(form.discount),
        internal_notes: form.internal_notes || null,
        items: form.items.map((item) => ({
          id: item.id,
          title: item.title,
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

  async function refreshAttachments(saved = "") {
    const attachments = await api.get(`/orders/${orderId}/attachments`);
    setState((current) => ({ ...current, data: { ...current.data, attachments: attachments.items } }));
    setAction({ busy: false, error: "", saved });
  }

  async function useCapturedPhoto(blob, filename) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/orders/${orderId}/attachments`, new File([blob], filename, { type: blob.type || "image/jpeg" }), { source_type: "device_capture" });
      setCameraOpen(false);
      await refreshAttachments("Captured photo attached");
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
      throw err;
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

  function closeAnnotation() {
    setAnnotationTarget((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function openOriginalAttachment(attachment) {
    const original = state.data?.attachments?.find((entry) => entry.id === attachment.original_attachment_id);
    if (original) await openAttachment(original, "preview");
  }

  async function openAnnotation(attachment) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      const result = await api.blob(`/orders/${orderId}/attachments/${attachment.id}/preview`);
      const url = URL.createObjectURL(result.blob);
      closeAnnotation();
      setAnnotationTarget({ attachment, url });
      setAction({ busy: false, error: "", saved: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function saveAnnotation(file, operations) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload(`/orders/${orderId}/attachments/${annotationTarget.attachment.id}/annotations`, file, { annotation_json: JSON.stringify(operations) });
      closeAnnotation();
      await refreshAttachments("Annotated copy saved");
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
      throw err;
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

  async function createOrOpenInvoice() {
    if (!state.data?.order) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post(`/orders/${orderId}/invoice`, {});
      await load();
      setAction({ busy: false, error: "", saved: "Invoice ready" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  useEffect(() => {
    const order = state.data?.order;
    setWorkspaceActions({
      savedRecord: Boolean(order),
      busy: action.busy,
      back: requestClose,
      save: order && form ? save : null,
      addItem: order && form && !order.invoice ? () => update({ items: [...form.items, newQuickItem({ production_stage: "not_started", completed: false })] }) : null,
      duplicateItem: order && !order.invoice && form?.items?.length ? () => {
        const item = form.items.at(-1);
        update({ items: [...form.items, { ...item, id: undefined, client_id: clientSideId() }] });
      } : null,
      uploadArtwork: order ? () => fileInputRef.current?.click?.() : null,
      schedule: order ? () => setScheduleTarget({ type: "order", order }) : null,
      openCustomer: order ? () => { window.location.hash = "#/customers"; } : null,
      invoice: order ? createOrOpenInvoice : null,
      emailCustomer: order ? () => setEmailOpen(true) : null,
      communicationNote: order ? () => document.querySelector("[data-region='communications'] textarea")?.focus?.() : null,
    });
    return () => setWorkspaceActions(null);
  }, [state.data, action.busy, form, dirty]);

  if (state.loading) return (
    <OrderWorkspaceShell
      label="Order Workspace"
      title="Loading Order"
      status="loading"
      customerName=""
      dueDate=""
      total=""
      progress={{ completed: 0, total: 0, percent: null }}
      saveState="Loading"
      formRef={dialogRef}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="loading-state">Loading</div>
    </OrderWorkspaceShell>
  );
  if (state.error) return (
    <OrderWorkspaceShell
      label="Order Workspace"
      title="Order Workspace"
      status="error"
      customerName=""
      dueDate=""
      total=""
      progress={{ completed: 0, total: 0, percent: null }}
      saveState="Error"
      formRef={dialogRef}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="error-state">{state.error}</div>
    </OrderWorkspaceShell>
  );

  const { order, customer, users, attachments } = state.data;
  const invoiced = Boolean(order.invoice);
  const activeUsers = users || [];
  return (
    <>
      <OrderWorkspaceShell
        label={`Order Workspace ${order.order_number}`}
        title={order.order_number}
        status={form.status}
        customerName={customer.business_name || customer.contact_name}
        dueDate={form.due_date || order.due_date}
        total={money(order.total_cents)}
        progress={order.production_progress}
        saveState={saveStateText(action, dirty, "Current")}
        formRef={dialogRef}
        onSubmit={save}
      >
        {action.error && <div className="error-state">{action.error} {action.error.includes("Reload") && <button type="button" onClick={load}>Reload</button>}</div>}
        {invoiced && <div className="notice">Invoice {order.invoice.invoice_number} exists. Financial fields and item order are locked to keep invoice totals and PDFs consistent.</div>}
        <input className="hidden-file-input" ref={fileInputRef} aria-label="Upload attachment" type="file" onChange={upload} disabled={action.busy} />
        <div className="order-dashboard-grid">
          <WorkspaceOrderInfoCard form={form} onUpdate={update} invoiced={invoiced} />
          <section className="workspace-card customer-info-region" data-region="customer-info">
            <h3>Customer</h3>
            <CustomerSummary customer={customer} compact />
            <span className="workspace-return-note">Return: {returnRoute === "production" ? "Production" : "Orders"}</span>
          </section>
          <OrderSummaryCard order={order} form={form} invoice={order.invoice} progress={order.production_progress} />
          <ProductionSetupCard api={api} order={order} items={form.items} dirty={dirty} onDone={load} />
          <BundleEditor api={api} documentType="order" documentId={order.id} items={order.items} bundles={order.bundles || []} locked={Boolean(order.invoice)} onSaved={load} />
          <OrderItemsTable
            items={form.items}
            users={activeUsers}
            invoiced={invoiced}
            onItemChange={setItem}
            onAdd={!invoiced ? () => update({ items: [...form.items, newQuickItem({ production_stage: "not_started", completed: false })] }) : null}
            onMove={moveItem}
            onDuplicate={(index) => {
              const item = form.items[index];
              update({ items: [...form.items.slice(0, index + 1), { ...item, id: undefined, client_id: clientSideId() }, ...form.items.slice(index + 1)] });
            }}
            onRemove={(index) => window.confirm("Remove this item?") && update({ items: form.items.filter((_, i) => i !== index) })}
          />
          <OperationalStatusRail
            order={order}
            form={form}
            attachments={attachments}
            preview={preview}
            onUpload={() => fileInputRef.current?.click?.()}
            onCapture={() => setCameraOpen(true)}
            onAnnotate={openAnnotation}
            onOpenOriginal={openOriginalAttachment}
            onSchedule={() => setScheduleTarget({ type: "order", order })}
            onInvoice={createOrOpenInvoice}
            onPreview={(attachment) => openAttachment(attachment, "preview")}
            onDownload={(attachment) => openAttachment(attachment, "download")}
            onDelete={deleteAttachment}
            onClosePreview={() => replacePreview(null)}
          />
          <CommunicationPanel
            api={api}
            customerId={customer.id}
            relatedEntityType="order"
            relatedEntityId={order.id}
            savedCustomerEmail={customer.email || ""}
            onEmail={() => setEmailOpen(true)}
          />
        </div>
      </OrderWorkspaceShell>
      {cameraOpen && <CameraCaptureOverlay orderNumber={order.order_number} busy={action.busy} onUsePhoto={useCapturedPhoto} onClose={() => setCameraOpen(false)} />}
      {annotationTarget && (
        <AnnotationWorkspace
          attachment={annotationTarget.attachment}
          imageUrl={annotationTarget.url}
          busy={action.busy}
          onSave={saveAnnotation}
          onClose={closeAnnotation}
        />
      )}
      {emailOpen && (
        <EmailComposerModal
          api={api}
          endpoint={`/orders/${order.id}/email`}
          title={`Email ${customer.business_name || customer.contact_name}`}
          defaultSubject={`Order ${order.order_number}`}
          defaultBody="Here is an update on your order."
          defaultTo={customer.email || ""}
          savedCustomerEmail={customer.email || ""}
          onClose={() => setEmailOpen(false)}
          onSent={load}
        />
      )}
      {scheduleTarget && <ScheduleFromWorkspaceModal api={api} target={scheduleTarget} users={activeUsers} onClose={() => setScheduleTarget(null)} />}
    </>
  );
}

function ScheduleFromWorkspaceModal({ api, target, users, onClose }) {
  const todayText = dateOnly();
  const linkedDate = target.work_order?.due_date || target.item?.due_date || target.order.due_date || todayText;
  const [form, setForm] = useState({
    title: target.type === "work_order" ? target.work_order.title : target.type === "order_item" ? target.item.title || target.item.description : target.order.title || target.order.order_number,
    start_at: `${linkedDate}T09:00`,
    end_at: `${linkedDate}T10:00`,
    all_day: false,
    assigned_user_id: target.work_order?.assigned_user_id || target.item?.assigned_user_id || "",
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
        work_order_id: target.type === "work_order" ? target.work_order.id : null,
        schedule_category: target.type === "work_order" ? "production" : "general",
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
  const [summary, setSummary] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
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
      const path = item.record_type === "work_order" ? `/production/work-orders/${item.id}/stage` : `/production/items/${item.id}/stage`;
      await api.post(path, { stage });
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
      const path = item.record_type === "work_order" ? `/production/work-orders/${item.id}/completion` : `/production/items/${item.id}/completion`;
      await api.post(path, { completed });
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
  async function openSummary(item) {
    if (item.record_type !== "work_order") return;
    setAction({ busy: true, error: "" });
    try {
      setSummary(await api.get(`/production/work-orders/${item.id}`));
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
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
                <strong>{item.record_type === "work_order" ? item.title : item.title || item.description}</strong>
                <span>{item.order_number} / {item.customer_name}</span>
                <p>{item.record_type === "work_order" ? `${item.item_count} included item${item.item_count === 1 ? "" : "s"}` : "Order Item"}</p>
                <span>Due: {item.due_date || "None"} {item.late ? "Late" : ""}</span>
                <span>{item.assigned_user?.display_name || "Unassigned"}</span>
                <span>{formatProgress(item.production_progress)}</span>
                <div className="row-actions">
                  <button type="button" aria-label={`Move ${item.title || item.description} left`} disabled={action.busy || PRODUCTION_STAGES.indexOf(item.production_stage) === 0} onClick={() => shift(item, -1)}><ArrowUp size={14} /></button>
                  <button type="button" aria-label={`Move ${item.title || item.description} right`} disabled={action.busy || PRODUCTION_STAGES.indexOf(item.production_stage) === PRODUCTION_STAGES.length - 1} onClick={() => shift(item, 1)}><ArrowDown size={14} /></button>
                  <select aria-label={`Move ${item.title || item.description} to stage`} value={item.production_stage} disabled={action.busy} onChange={(event) => move(item, event.target.value)}>
                    {PRODUCTION_STAGES.map((option) => <option value={option} key={option}>{STAGE_LABELS[option]}</option>)}
                  </select>
                  {item.completed ? <button type="button" onClick={() => setDone(item, false)}>Reopen</button> : <button type="button" onClick={() => setDone(item, true)}>Done</button>}
                  {item.record_type === "work_order" && <button type="button" onClick={() => openSummary(item)}>Summary</button>}
                  {item.record_type === "work_order" && <button type="button" onClick={() => setScheduleTarget({ type: "work_order", order: { id: item.order_id, due_date: item.due_date, title: item.order_title, order_number: item.order_number }, work_order: item })}><CalendarDays size={14} />Schedule Work</button>}
                  <button type="button" data-focus-target={`production-open-order-${item.id}`} onClick={() => { window.location.hash = `#/orders/${item.order_id}/from-production/${item.id}`; }}>Open Order</button>
                </div>
              </article>
            ))}
            {items.filter((item) => item.production_stage === stage).length === 0 && <div className="empty-state">No items</div>}
          </section>
        ))}
      </div>
      {summary && <div className="modal-backdrop">
        <section className="calendar-modal form-grid" role="dialog" aria-modal="true" aria-label="Work Order Summary">
          <Toolbar title="Work Order Summary"><button type="button" onClick={() => setSummary(null)}>Close</button></Toolbar>
          <h3>{summary.title}</h3>
          <span>{summary.order_number} / {summary.customer_name}</span>
          <span>{STAGE_LABELS[summary.production_stage]} / {summary.completed ? "Complete" : "Open"}</span>
          <div className="record-list">
            {(summary.items || []).map((entry) => (
              <article className="record-row" key={entry.id}>
                <div><strong>{entry.title}</strong><span>{entry.quantity_decimal} / {entry.description}</span></div>
                <span>{STAGE_LABELS[entry.production_stage]}</span>
              </article>
            ))}
          </div>
          {(summary.scheduled_entries || []).map((entry) => <span key={entry.id}>{entry.display_title || entry.title} / {formatDate(entry.local_start_date || entry.start_at)}</span>)}
        </section>
      </div>}
      {scheduleTarget && <ScheduleFromWorkspaceModal api={api} target={scheduleTarget} users={users} onClose={() => setScheduleTarget(null)} />}
    </section>
  );
}

function calendarRange(view, anchor) {
  if (view === "month") {
    const monthFirst = monthStart(anchor);
    const monthEnd = monthEndExclusive(anchor);
    const gridStart = weekStart(monthFirst);
    const gridEnd = addDays(weekStart(addDays(monthEnd, -1)), 7);
    return { start: gridStart, end: gridEnd, label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${monthFirst}T00:00:00`)), month: monthFirst };
  }
  if (view === "week") {
    const start = weekStart(anchor);
    return { start, end: addDays(start, 7), label: `${formatDate(start)} - ${formatDate(addDays(start, 6))}` };
  }
  if (view === "day") return { start: anchor, end: addDays(anchor, 1), label: formatDate(anchor) };
  return { start: anchor, end: addDays(anchor, 14), label: `${formatDate(anchor)} - ${formatDate(addDays(anchor, 13))}` };
}

const CALENDAR_ENTRY_LABELS = {
  event: "Event",
  task: "Task",
  appointment: "Appointment",
  production: "Production",
  deadline: "Deadline",
};

const SCHEDULE_CATEGORIES = ["general", "production", "installation", "sales", "customer_appointment", "site_survey", "pickup", "delivery", "meeting", "deadline", "other"];
const SCHEDULE_CATEGORY_LABELS = {
  general: "General",
  production: "Production",
  installation: "Installation",
  sales: "Sales",
  customer_appointment: "Customer Appointment",
  site_survey: "Site Survey",
  pickup: "Pickup",
  delivery: "Delivery",
  meeting: "Meeting",
  deadline: "Deadline",
  other: "Other",
};

const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];

function emptyEventForm(entryType = "event", anchor = dateOnly()) {
  const timed = entryType !== "task";
  return {
    id: "",
    entry_type: entryType,
    schedule_category: entryType === "appointment" ? "customer_appointment" : "general",
    department_id: "",
    title: "",
    task_priority: "normal",
    appointment_type: "",
    customer_name: "",
    customer_contact: "",
    location: "",
    estimate_id: "",
    order_id: "",
    order_item_id: "",
    work_order_id: "",
    all_day: !timed,
    start_at: timed ? `${anchor}T09:00` : anchor,
    end_at: timed ? `${anchor}T10:00` : addDays(anchor, 1),
    assigned_user_id: "",
    assignee_user_ids: [],
    resource_reservations: [],
    conflict_override: false,
    conflict_override_reason: "",
    status: "scheduled",
    internal_note: "",
  };
}

function eventToForm(event) {
  return {
    id: event.id,
    entry_type: event.entry_type || "event",
    schedule_category: event.schedule_category || "general",
    department_id: event.department_id || "",
    title: event.title,
    task_priority: event.task_priority || "normal",
    appointment_type: event.appointment_type || "",
    customer_name: event.customer_name || "",
    customer_contact: event.customer_contact || "",
    location: event.location || "",
    estimate_id: event.estimate_id || "",
    order_id: event.order_id || "",
    order_item_id: event.order_item_id || "",
    work_order_id: event.work_order_id || "",
    all_day: event.all_day,
    start_at: event.all_day ? event.start_at : String(event.start_at).slice(0, 16),
    end_at: event.all_day ? event.end_at : String(event.end_at).slice(0, 16),
    assigned_user_id: event.assigned_user_id || "",
    assignee_user_ids: (event.assignees || []).map((assignee) => assignee.user_id),
    resource_reservations: (event.resource_reservations || []).map((reservation) => ({ resource_id: reservation.resource_id, quantity: reservation.quantity || 1 })),
    conflict_override: false,
    conflict_override_reason: "",
    status: event.status,
    internal_note: event.internal_note || "",
  };
}

const CALENDAR_RAIL_KEYS = ["production", "installation", "employee", "sales_appointments"];

function calendarRailItems(calendarViews = [], canManageSchedule = false) {
  const bySystem = new Map(calendarViews.map((calendarView) => [calendarView.system_key, calendarView]));
  return [
    { key: "all_shop", label: "All Shop Schedules", color: "#75638F", view: bySystem.get("all_shop") || null, type: "all" },
    { key: "production", label: "Production", color: "#7B3DA6", view: bySystem.get("production") || null, categories: ["production"], sourceTypes: ["production"] },
    { key: "installation", label: "Install Schedule", color: "#3F7FC4", view: bySystem.get("installation") || null, categories: ["installation"] },
    { key: "employee", label: "Employee Schedule", color: "#229C9F", type: "employee" },
    { key: "sales_appointments", label: "Sales & Appointments", color: "#E06F00", view: bySystem.get("customer_appointments") || bySystem.get("sales") || null, categories: ["sales", "customer_appointment", "site_survey"], entryTypes: ["appointment"] },
    { key: "new_calendar", label: "New Calendar", color: "#75638F", type: "new", disabled: !canManageSchedule },
    { key: "my_schedule", label: "My Schedule", color: "#B8BDC7", type: "my" },
  ];
}

function entryMatchesRailKey(entry, key) {
  const source = entry.source_type || entry.entry_type;
  const category = entry.schedule_category;
  if (key === "production") return source === "production" || category === "production";
  if (key === "installation") return category === "installation";
  if (key === "employee") return Boolean(entry.assigned_user_id || entry.assigned_user_name || entry.assignees?.length);
  if (key === "sales_appointments") return ["sales", "customer_appointment", "site_survey"].includes(category) || entry.entry_type === "appointment";
  return false;
}

function CalendarSelectorRail({ items, selectedViewId, mySchedule, enabledKeys, onSelect, onToggle }) {
  const allEnabled = CALENDAR_RAIL_KEYS.every((key) => enabledKeys.includes(key));
  return (
    <aside className="calendar-selector-rail" aria-label="Calendars">
      <h2>CALENDARS</h2>
      <div className="calendar-selector-list">
        {items.map((item) => {
          if (item.key === "new_calendar") {
            return (
              <button type="button" className="calendar-selector-new" key={item.key} disabled={item.disabled} onClick={() => onSelect(item)}>
                <Plus size={18} /><span>{item.label}</span>
              </button>
            );
          }
          const checked = item.key === "all_shop" ? allEnabled : item.key === "my_schedule" ? mySchedule : enabledKeys.includes(item.key);
          const active = item.key === "my_schedule" ? mySchedule : item.view?.id ? selectedViewId === item.view.id : false;
          return (
            <div className={active ? "calendar-selector-row active" : "calendar-selector-row"} key={item.key} style={{ "--selector-color": item.color }}>
              <label className="calendar-selector-toggle">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggle(item, event.target.checked)}
                  aria-label={`${checked ? "Hide" : "Show"} ${item.label}`}
                />
                <span aria-hidden="true" />
              </label>
              <button type="button" className="calendar-selector-button" onClick={() => onSelect(item)}>
                <span className="calendar-selector-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
              <span className="calendar-selector-more" aria-hidden="true">...</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function CalendarPage({ api, setWorkspaceActions }) {
  const [view, setViewState] = useState(() => sessionStorage.getItem("signguyCalendarView") || "month");
  const [anchor, setAnchor] = useState(dateOnly());
  const [selectedDate, setSelectedDate] = useState(dateOnly());
  const [selectedViewId, setSelectedViewId] = useState(() => sessionStorage.getItem("signguyCalendarSelectedView") || "");
  const [mySchedule, setMySchedule] = useState(false);
  const [enabledCalendarKeys, setEnabledCalendarKeys] = useState(CALENDAR_RAIL_KEYS);
  const [filters, setFilters] = useState({ entry_type: "all", schedule_category: "all", department_id: "all", employee_id: "all", resource_id: "all", status: "all", linked_record_type: "all" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [overlay, setOverlay] = useState(null);
  const [form, setForm] = useState(emptyEventForm("event"));
  const [action, setAction] = useState({ busy: false, error: "" });
  const lastTriggerRef = useRef(null);
  const range = calendarRange(view, anchor);
  const queryParams = { start_at: range.start, end_at: range.end, ...(selectedViewId && !mySchedule ? { view_id: selectedViewId } : filters), ...(mySchedule ? { my_schedule: "1" } : {}) };
  const query = new URLSearchParams(queryParams).toString();
  const events = useLoad(() => api.get(`/calendar?${query}`), [query]);
  const orders = useLoad(() => api.get("/orders"), []);
  const estimates = useLoad(() => api.get("/estimates"), []);
  const entries = events.data?.items || [];
  const users = events.data?.users || [];
  const departments = events.data?.departments || [];
  const resources = events.data?.resources || [];
  const calendarViews = events.data?.views || [];
  const canManageSchedule = Boolean(events.data?.can_manage_schedule);
  const selectedView = events.data?.selected_view || calendarViews.find((calendarView) => calendarView.id === selectedViewId) || calendarViews.find((calendarView) => calendarView.system_key === "all_shop") || null;
  const railItems = calendarRailItems(calendarViews, canManageSchedule);
  const filtersActive = !selectedViewId && !mySchedule && Object.entries(filters).some(([key, value]) => value !== { entry_type: "all", schedule_category: "all", department_id: "all", employee_id: "all", resource_id: "all", status: "all", linked_record_type: "all" }[key]);

  function setView(next) {
    setViewState(next);
    sessionStorage.setItem("signguyCalendarView", next);
  }

  function move(delta) {
    if (view === "month") {
      setAnchor(monthStart(addDays(monthStart(anchor), delta > 0 ? 32 : -1)));
      return;
    }
    const amount = view === "week" ? 7 * delta : view === "day" ? delta : 14 * delta;
    setAnchor(addDays(anchor, amount));
  }

  function openOverlay(next) {
    lastTriggerRef.current = document.activeElement;
    setAction({ busy: false, error: "" });
    setOverlay(next);
  }

  function closeOverlay() {
    setOverlay(null);
    setAction({ busy: false, error: "" });
    window.setTimeout(() => lastTriggerRef.current?.focus?.(), 0);
  }

  function createEntry(entryType, day = selectedDate) {
    setForm(emptyEventForm(entryType, day));
    openOverlay({ type: "entry", mode: "create", entryType });
  }

  function openDay(day) {
    setSelectedDate(day);
    openOverlay({ type: "day", day });
  }

  function openEntry(entry) {
    if (entry.derived) {
      openOverlay({ type: "derived", entry });
      return;
    }
    setForm(eventToForm(entry));
    openOverlay({ type: "entry", mode: "edit", entryType: entry.entry_type || "event", entry });
  }

  function todayNav() {
    const today = dateOnly();
    setAnchor(today);
    setSelectedDate(today);
  }

  function selectCalendarView(value) {
    if (value === "__manage") {
      openOverlay({ type: "manage-calendars" });
      return;
    }
    setSelectedViewId(value);
    setMySchedule(false);
    sessionStorage.setItem("signguyCalendarSelectedView", value);
  }

  function openMySchedule() {
    setSelectedViewId("");
    setMySchedule(true);
    sessionStorage.setItem("signguyCalendarSelectedView", "");
  }

  function selectRailCalendar(item) {
    if (item.type === "new") {
      if (canManageSchedule) openOverlay({ type: "manage-calendars" });
      return;
    }
    if (item.type === "my") {
      openMySchedule();
      return;
    }
    if (item.type === "employee") {
      setDraftFilters(filters);
      setSelectedViewId("");
      setMySchedule(false);
      openOverlay({ type: "filters" });
      return;
    }
    selectCalendarView(item.view?.id || "");
  }

  function toggleRailCalendar(item, checked) {
    if (item.key === "all_shop") {
      setEnabledCalendarKeys(checked ? CALENDAR_RAIL_KEYS : []);
      if (checked) selectCalendarView(item.view?.id || "");
      return;
    }
    if (item.key === "my_schedule") {
      if (checked) openMySchedule();
      else setMySchedule(false);
      return;
    }
    if (!CALENDAR_RAIL_KEYS.includes(item.key)) return;
    setEnabledCalendarKeys((current) => {
      if (checked) return current.includes(item.key) ? current : [...current, item.key];
      return current.filter((key) => key !== item.key);
    });
  }

  useEffect(() => {
    setWorkspaceActions({
      view,
      setView,
      move,
      today: todayNav,
      create: (type) => createEntry(type),
      views: calendarViews,
      selectedViewValue: mySchedule ? "" : (selectedViewId || selectedView?.id || ""),
      selectCalendarView,
      mySchedule,
      myScheduleView: openMySchedule,
      canManageSchedule,
      filters: () => {
        setDraftFilters(filters);
        setSelectedViewId("");
        setMySchedule(false);
        openOverlay({ type: "filters" });
      },
      filtersActive,
    });
    return () => setWorkspaceActions(null);
  }, [view, anchor, selectedDate, filters, filtersActive, events.data, selectedViewId, mySchedule]);

  const linkedOrder = (orders.data?.items || []).find((order) => order.id === form.order_id);
  const orderItems = linkedOrder?.items || [];
  function payload() {
    return {
      title: form.title,
      entry_type: form.entry_type,
      schedule_category: form.schedule_category,
      department_id: form.department_id || null,
      task_priority: form.entry_type === "task" ? form.task_priority : null,
      appointment_type: form.entry_type === "appointment" ? form.appointment_type || null : null,
      customer_name: form.entry_type === "appointment" ? form.customer_name || null : null,
      customer_contact: form.entry_type === "appointment" ? form.customer_contact || null : null,
      location: form.entry_type === "appointment" ? form.location || null : null,
      estimate_id: form.entry_type === "appointment" ? form.estimate_id || null : null,
      order_id: form.order_id || null,
      order_item_id: form.order_item_id || null,
      work_order_id: form.work_order_id || null,
      all_day: form.all_day,
      start_at: form.start_at,
      end_at: form.end_at,
      assigned_user_id: form.assigned_user_id || null,
      assignee_user_ids: Array.from(new Set([form.assigned_user_id, ...(form.assignee_user_ids || [])].filter(Boolean))),
      primary_assignee_user_id: form.assigned_user_id || null,
      resource_reservations: form.resource_reservations || [],
      conflict_override: form.conflict_override,
      conflict_override_reason: form.conflict_override_reason || null,
      status: form.status,
      internal_note: form.internal_note || null,
    };
  }
  async function save(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      setAction({ busy: false, error: `${CALENDAR_ENTRY_LABELS[form.entry_type]} title is required.` });
      return;
    }
    setAction({ busy: true, error: "" });
    try {
      if (overlay?.mode === "edit") await api.patch(`/calendar/${form.id}`, payload());
      else await api.post("/calendar", payload());
      events.refresh();
      closeOverlay();
    } catch (err) {
      setAction({ busy: false, error: err.message, conflicts: err.conflicts || [] });
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
      return false;
    }
    setAction({ busy: false, error: "" });
    return true;
  }
  const displayEntries = selectedViewId && selectedView?.system_key && selectedView.system_key !== "all_shop"
    ? entries
    : mySchedule
      ? entries
      : entries.filter((entry) => {
        const matched = CALENDAR_RAIL_KEYS.filter((key) => entryMatchesRailKey(entry, key));
        if (!matched.length) return true;
        return matched.some((key) => enabledCalendarKeys.includes(key));
      });
  const days = view === "month"
    ? Array.from({ length: Math.ceil((new Date(`${range.end}T00:00:00Z`) - new Date(`${range.start}T00:00:00Z`)) / 86400000) }, (_, index) => addDays(range.start, index))
    : view === "week"
      ? Array.from({ length: 7 }, (_, index) => addDays(range.start, index))
      : view === "day"
        ? [range.start]
        : Array.from({ length: 14 }, (_, index) => addDays(range.start, index));
  const entriesForDay = (day) => displayEntries.filter((entry) => entry.local_start_date === day);
  return (
    <section className="shop-schedule" aria-label="Shop Schedule">
      <div className="schedule-layout">
        <section className="calendar-card" aria-label={`${view} calendar`}>
          <header className="schedule-heading">
            <div className="schedule-nav-actions">
              <button type="button" aria-label={`Previous ${view}`} onClick={() => move(-1)}><ArrowLeft size={18} /></button>
              <button type="button" aria-label={`Next ${view}`} onClick={() => move(1)}><ArrowRight size={18} /></button>
            </div>
            <h2>{range.label}</h2>
            <button type="button" className="today-inline-button" onClick={todayNav}>Today</button>
            {filtersActive && <span className="filter-active-pill">Filters active</span>}
          </header>
          {events.loading ? <div className="loading-state">Loading</div> : events.error ? <div className="error-state">{events.error}<button onClick={events.refresh}>Retry</button></div> : <>
            {view === "month" && <MonthSchedule days={days} month={range.month} entriesForDay={entriesForDay} onDay={openDay} onEntry={openEntry} />}
            {view === "week" && <TimeSchedule days={days} entriesForDay={entriesForDay} onDay={openDay} onEntry={openEntry} />}
            {view === "day" && <TimeSchedule days={days} entriesForDay={entriesForDay} onDay={openDay} onEntry={openEntry} />}
            {view === "agenda" && <AgendaSchedule entries={displayEntries} onEntry={openEntry} />}
          </>}
        </section>
        <CalendarSelectorRail
          items={railItems}
          selectedViewId={selectedViewId || selectedView?.id || ""}
          mySchedule={mySchedule}
          enabledKeys={enabledCalendarKeys}
          onSelect={selectRailCalendar}
          onToggle={toggleRailCalendar}
        />
      </div>
      {overlay?.type === "day" && <CalendarOverlay title={`Day Schedule ${formatDate(overlay.day)}`} onClose={closeOverlay}>
        <DaySchedule day={overlay.day} entries={entriesForDay(overlay.day)} onEntry={openEntry} onCreate={(type) => createEntry(type, overlay.day)} />
      </CalendarOverlay>}
      {overlay?.type === "derived" && <CalendarOverlay title={overlay.entry.display_title || overlay.entry.title} onClose={closeOverlay}>
        <EntrySummary entry={overlay.entry} />
        <div className="notice">This is a derived schedule milestone. Calendar actions here do not update linked Order, Order Item, or production status.</div>
      </CalendarOverlay>}
      {overlay?.type === "filters" && <CalendarOverlay title="Calendar Filters" onClose={closeOverlay}>
        <form className="calendar-overlay-form" onSubmit={(event) => { event.preventDefault(); setFilters(draftFilters); closeOverlay(); }}>
          <SelectField label="Entry type" value={draftFilters.entry_type} onChange={(entry_type) => setDraftFilters({ ...draftFilters, entry_type })}>
            <option value="all">All types</option>
            {["event", "task", "appointment", "production", "deadline"].map((type) => <option value={type} key={type}>{CALENDAR_ENTRY_LABELS[type]}</option>)}
          </SelectField>
          <SelectField label="Schedule category" value={draftFilters.schedule_category} onChange={(schedule_category) => setDraftFilters({ ...draftFilters, schedule_category })}>
            <option value="all">All categories</option>
            {SCHEDULE_CATEGORIES.map((category) => <option value={category} key={category}>{SCHEDULE_CATEGORY_LABELS[category]}</option>)}
          </SelectField>
          <SelectField label="Department" value={draftFilters.department_id} onChange={(department_id) => setDraftFilters({ ...draftFilters, department_id })}>
            <option value="all">All departments</option>
            {departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}
          </SelectField>
          <SelectField label="Employee" value={draftFilters.employee_id} onChange={(employee_id) => setDraftFilters({ ...draftFilters, employee_id })}>
            <option value="all">All employees</option>
            {users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
          </SelectField>
          <SelectField label="Resource" value={draftFilters.resource_id} onChange={(resource_id) => setDraftFilters({ ...draftFilters, resource_id })}>
            <option value="all">All resources</option>
            {resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.name}</option>)}
          </SelectField>
          <SelectField label="Status" value={draftFilters.status} onChange={(status) => setDraftFilters({ ...draftFilters, status })}>
            <option value="all">All statuses</option>
            {CALENDAR_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </SelectField>
          <SelectField label="Linked records" value={draftFilters.linked_record_type} onChange={(linked_record_type) => setDraftFilters({ ...draftFilters, linked_record_type })}>
            {LINKED_RECORD_TYPES.map((type) => <option value={type} key={type}>{type.replace("_", " ")}</option>)}
          </SelectField>
          <div className="modal-actions">
            <button type="button" onClick={async () => {
              const name = window.prompt?.("Personal view name");
              if (!name) return;
              await api.post("/schedule/views", {
                name,
                visibility: "personal",
                color: "#255b73",
                filters: {
                  entry_types: draftFilters.entry_type === "all" ? [] : [draftFilters.entry_type],
                  schedule_categories: draftFilters.schedule_category === "all" ? [] : [draftFilters.schedule_category],
                  department_ids: draftFilters.department_id === "all" ? [] : [draftFilters.department_id],
                  employee_ids: draftFilters.employee_id === "all" ? [] : [draftFilters.employee_id],
                  resource_ids: draftFilters.resource_id === "all" ? [] : [draftFilters.resource_id],
                  statuses: draftFilters.status === "all" ? [] : [draftFilters.status],
                  linked: draftFilters.linked_record_type === "none" ? "unlinked" : draftFilters.linked_record_type === "all" ? "all" : draftFilters.linked_record_type,
                },
              });
              events.refresh();
              closeOverlay();
            }}>Save personal view</button>
            <button type="button" onClick={() => { const clear = { entry_type: "all", schedule_category: "all", department_id: "all", employee_id: "all", resource_id: "all", status: "all", linked_record_type: "all" }; setDraftFilters(clear); setFilters(clear); closeOverlay(); }}>Clear all</button>
            <button className="primary-button" type="submit">Apply</button>
          </div>
        </form>
      </CalendarOverlay>}
      {overlay?.type === "manage-calendars" && <CalendarOverlay title="Manage Calendars/View Settings" onClose={closeOverlay}>
        <ScheduleManagement api={api} events={events} users={users} departments={departments} resources={resources} views={calendarViews} canManage={canManageSchedule} onRefresh={() => events.refresh()} />
      </CalendarOverlay>}
      {overlay?.type === "entry" && <CalendarOverlay title={`${overlay.mode === "edit" ? "Edit" : "Create"} ${CALENDAR_ENTRY_LABELS[form.entry_type]}`} onClose={closeOverlay}>
        <form className="calendar-overlay-form" onSubmit={save}>
          {action.error && <div className="error-state">{action.error}</div>}
          {action.conflicts?.length > 0 && <div className="conflict-warning">
            <strong>Schedule conflicts</strong>
            {action.conflicts.map((conflict, index) => <span key={`${conflict.reason}-${index}`}>{conflict.name || "Resource"}: {conflict.reason}</span>)}
          </div>}
          <Field label={form.entry_type === "task" ? "Task title" : form.entry_type === "appointment" ? "Appointment title" : "Title"} value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <SelectField label="Schedule category" value={form.schedule_category} onChange={(schedule_category) => setForm({ ...form, schedule_category })}>
            {SCHEDULE_CATEGORIES.map((category) => <option value={category} key={category}>{SCHEDULE_CATEGORY_LABELS[category]}</option>)}
          </SelectField>
          <SelectField label="Responsible department" value={form.department_id} onChange={(department_id) => setForm({ ...form, department_id })}>
            <option value="">No department</option>
            {departments.filter((department) => department.active).map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}
          </SelectField>
          {form.entry_type === "task" && <SelectField label="Priority" value={form.task_priority} onChange={(task_priority) => setForm({ ...form, task_priority })}>{TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</SelectField>}
          {form.entry_type === "appointment" && <>
            <Field label="Appointment type" value={form.appointment_type} onChange={(appointment_type) => setForm({ ...form, appointment_type })} />
            <Field label="Customer" value={form.customer_name} onChange={(customer_name) => setForm({ ...form, customer_name })} />
            <Field label="Customer contact" value={form.customer_contact} onChange={(customer_contact) => setForm({ ...form, customer_contact })} />
            <Field label="Location/address" value={form.location} onChange={(location) => setForm({ ...form, location })} />
            <SelectField label="Linked Estimate" value={form.estimate_id} onChange={(estimate_id) => setForm({ ...form, estimate_id })}>
              <option value="">No linked estimate</option>
              {(estimates.data?.items || []).map((estimate) => <option value={estimate.id} key={estimate.id}>{estimate.estimate_number}</option>)}
            </SelectField>
          </>}
          <SelectField label="Linked Order" value={form.order_id} onChange={(order_id) => setForm({ ...form, order_id, order_item_id: "" })}>
            <option value="">No linked order</option>
            {(orders.data?.items || []).map((order) => <option value={order.id} key={order.id}>{order.order_number}</option>)}
          </SelectField>
          <SelectField label="Linked Order Item" value={form.order_item_id} disabled={!form.order_id} onChange={(order_item_id) => setForm({ ...form, order_item_id })}>
            <option value="">No linked item</option>
            {orderItems.map((item) => <option value={item.id} key={item.id}>{item.title || item.description}</option>)}
          </SelectField>
          <label className="check-row"><input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked, start_at: event.target.checked ? String(form.start_at).slice(0, 10) : `${String(form.start_at).slice(0, 10)}T09:00`, end_at: event.target.checked ? addDays(String(form.start_at).slice(0, 10), 1) : `${String(form.start_at).slice(0, 10)}T10:00` })} />{form.entry_type === "task" ? "Deadline/all day" : "All day"}</label>
          <Field label={form.entry_type === "task" && form.all_day ? "Due date" : "Start"} type={form.all_day ? "date" : "datetime-local"} value={form.start_at} onChange={(start_at) => setForm({ ...form, start_at, end_at: form.all_day ? addDays(start_at, 1) : form.end_at })} />
          {!form.all_day && <Field label="End" type="datetime-local" value={form.end_at} onChange={(end_at) => setForm({ ...form, end_at })} />}
          <SelectField label="Assigned user" value={form.assigned_user_id} onChange={(assigned_user_id) => setForm({ ...form, assigned_user_id })}>
            <option value="">Unassigned</option>
            {users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
          </SelectField>
          <fieldset className="calendar-checkbox-grid">
            <legend>Additional assignees</legend>
            {users.map((user) => (
              <label key={user.id}><input type="checkbox" checked={(form.assignee_user_ids || []).includes(user.id)} onChange={(event) => {
                const current = new Set(form.assignee_user_ids || []);
                if (event.target.checked) current.add(user.id);
                else current.delete(user.id);
                setForm({ ...form, assignee_user_ids: [...current] });
              }} />{user.display_name}</label>
            ))}
          </fieldset>
          <fieldset className="calendar-checkbox-grid">
            <legend>Reserved resources</legend>
            {resources.filter((resource) => resource.active).map((resource) => {
              const selected = (form.resource_reservations || []).find((reservation) => reservation.resource_id === resource.id);
              return (
                <label key={resource.id}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => {
                  const current = form.resource_reservations || [];
                  setForm({ ...form, resource_reservations: event.target.checked ? [...current, { resource_id: resource.id, quantity: 1 }] : current.filter((reservation) => reservation.resource_id !== resource.id) });
                }} />{resource.name}</label>
              );
            })}
          </fieldset>
          <SelectField label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })}>
            {CALENDAR_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </SelectField>
          {action.conflicts?.length > 0 && canManageSchedule && <>
            <label className="check-row"><input type="checkbox" checked={form.conflict_override} onChange={(event) => setForm({ ...form, conflict_override: event.target.checked })} />Override protected conflict</label>
            <Field label="Override reason" value={form.conflict_override_reason} onChange={(conflict_override_reason) => setForm({ ...form, conflict_override_reason })} />
          </>}
          {action.conflicts?.length > 0 && !canManageSchedule && <div className="notice">Owner, admin, or manager access is required to override protected conflicts.</div>}
          <label className="field"><span>Internal note</span><textarea value={form.internal_note} onChange={(event) => setForm({ ...form, internal_note: event.target.value })} /></label>
          <div className="modal-actions">
            {overlay.mode === "edit" && form.status !== "complete" && <button type="button" disabled={action.busy} onClick={async () => { if (window.confirm("Complete this calendar entry?") && await setStatus(form, "complete")) closeOverlay(); }}><CheckCircle2 size={14} />Complete</button>}
            {overlay.mode === "edit" && form.status === "complete" && <button type="button" disabled={action.busy} onClick={async () => { if (await setStatus(form, "scheduled")) closeOverlay(); }}><RotateCcw size={14} />Reopen</button>}
            {overlay.mode === "edit" && form.status !== "cancelled" && <button type="button" disabled={action.busy} onClick={async () => { if (window.confirm("Cancel this calendar entry?") && await setStatus(form, "cancelled")) closeOverlay(); }}><XCircle size={14} />Cancel</button>}
            <button type="button" onClick={closeOverlay}>Cancel</button>
            <button className="primary-button" disabled={action.busy}><Save size={16} />Save</button>
          </div>
        </form>
      </CalendarOverlay>}
    </section>
  );
}

function EntryBadge({ entry }) {
  const type = entry.source_type || entry.entry_type || "event";
  const visualKey = calendarVisualKey(entry);
  return <span className={`entry-badge type-${type} cat-${visualKey}`}>{CALENDAR_ENTRY_LABELS[type] || type}</span>;
}

function calendarVisualKey(entry) {
  const source = entry.source_type || entry.entry_type || "event";
  const category = entry.schedule_category || "";
  if (source === "deadline" || category === "deadline") return "deadline";
  if (source === "production" || category === "production") return "production";
  if (category === "installation") return "install";
  if (["sales", "customer_appointment", "site_survey"].includes(category) || entry.entry_type === "appointment") return "sales";
  if (entry.assigned_user_id || entry.assigned_user_name || entry.assignees?.length) return "employee";
  return "event";
}

function EntryPill({ entry, onEntry, compact = false }) {
  const label = `${entry.display_title || entry.title}, ${formatEventTime(entry)}, ${SCHEDULE_CATEGORY_LABELS[entry.schedule_category] || entry.schedule_category || "General"}`;
  const timeLabel = compact ? compactMonthEventTime(entry) : formatEventTime(entry);
  const visualKey = calendarVisualKey(entry);
  return (
    <button
      type="button"
      className={`schedule-entry type-${entry.source_type || entry.entry_type} cat-${visualKey} status-${entry.status}`}
      title={label}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onEntry(entry); }}
    >
      <span className="entry-chip-row">
        <EntryBadge entry={entry} />
        <span className="entry-time">{timeLabel}</span>
      </span>
      <strong className="entry-title">{entry.display_title || entry.title}</strong>
      <small className="entry-meta">{SCHEDULE_CATEGORY_LABELS[entry.schedule_category] || entry.schedule_category}{entry.department_name ? ` / ${entry.department_name}` : ""}</small>
    </button>
  );
}

function monthVisibleEntries(entries, visibleLimit) {
  if (entries.length <= visibleLimit) return entries;
  const timedEntry = entries.find((entry) => !entry.all_day);
  if (timedEntry) return [timedEntry];
  return entries.slice(0, visibleLimit);
}

function MonthSchedule({ days, month, entriesForDay, onDay, onEntry }) {
  const weekCount = Math.max(1, days.length / 7);
  const compactVisibleCount = 1;
  return (
    <div className="month-schedule compact-six-row-month" role="grid" aria-label="Month schedule" style={{ "--week-count": weekCount }}>
      <div className="month-weekday-row" role="row">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => <div className="month-weekday" role="columnheader" key={day}>{day}</div>)}
      </div>
      <div className="month-week-grid">
        {days.map((day) => {
          const entries = entriesForDay(day);
          const visible = monthVisibleEntries(entries, compactVisibleCount);
          const hiddenCount = entries.length - visible.length;
          return (
            <section className={day.slice(0, 7) === month.slice(0, 7) ? "month-cell" : "month-cell outside-month"} key={day} role="gridcell" data-date={day} onClick={() => onDay(day)}>
              <button type="button" className="date-button" onClick={(event) => { event.stopPropagation(); onDay(day); }}>{new Date(`${day}T00:00:00`).getDate()}</button>
              <div className={hiddenCount ? "month-entry-stack has-overflow" : "month-entry-stack"} data-visible-count={visible.length} data-hidden-count={hiddenCount}>
                {visible.map((entry) => <EntryPill entry={entry} key={entry.id} onEntry={onEntry} compact />)}
                {hiddenCount > 0 && <button type="button" className="more-button" aria-label={`${hiddenCount} more events on ${formatDate(day)}`} onClick={(event) => { event.stopPropagation(); onDay(day); }}>+ {hiddenCount} more</button>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TimeSchedule({ days, entriesForDay, onDay, onEntry }) {
  return (
    <div className="time-schedule">
      {days.map((day) => {
        const entries = entriesForDay(day);
        const allDay = entries.filter((entry) => entry.all_day);
        const timed = entries.filter((entry) => !entry.all_day);
        return (
          <section className="time-day" key={day}>
            <button type="button" className="time-day-heading" onClick={() => onDay(day)}>{formatDate(day)}</button>
            <div className="all-day-row" aria-label={`${formatDate(day)} all-day entries`}>
              <span>All day</span>
              <div>{allDay.map((entry) => <EntryPill entry={entry} key={entry.id} onEntry={onEntry} />)}</div>
            </div>
            <div className="time-lane">
              {timed.length === 0 ? <button type="button" className="empty-day-hitarea" onClick={() => onDay(day)}>Open day schedule</button> : timed.map((entry) => <EntryPill entry={entry} key={entry.id} onEntry={onEntry} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AgendaSchedule({ entries, onEntry }) {
  return (
    <div className="agenda-schedule">
      {entries.map((entry) => (
        <button type="button" className="agenda-entry" key={entry.id} onClick={() => onEntry(entry)}>
          <span>{formatDate(entry.local_start_date)} {formatEventTime(entry)}</span>
          <EntryBadge entry={entry} />
          <strong>{entry.display_title || entry.title}</strong>
          <span>{entry.status}</span>
          <span>{entry.assignees?.map((assignee) => assignee.display_name).join(", ") || entry.assigned_user_name || "Unassigned"}</span>
          <span>{entry.department_name || SCHEDULE_CATEGORY_LABELS[entry.schedule_category] || entry.schedule_category}</span>
          <span>{entry.order_number || entry.work_order_title || entry.estimate_number || entry.item_title || entry.item_description || "Unlinked"}</span>
        </button>
      ))}
    </div>
  );
}

function DaySchedule({ day, entries, onEntry, onCreate }) {
  const allDay = entries.filter((entry) => entry.all_day);
  const timed = entries.filter((entry) => !entry.all_day);
  return (
    <div className="day-schedule-detail">
      <div className="day-quick-actions">
        <button type="button" onClick={() => onCreate("event")}><Plus size={14} />Event</button>
        <button type="button" onClick={() => onCreate("task")}><Plus size={14} />Task</button>
        <button type="button" onClick={() => onCreate("appointment")}><Plus size={14} />Appointment</button>
      </div>
      <section>
        <h3>All-day entries</h3>
        {allDay.length ? allDay.map((entry) => <DayEntry entry={entry} key={entry.id} onEntry={onEntry} />) : <div className="quiet-empty">No all-day entries for {formatDate(day)}</div>}
      </section>
      <section>
        <h3>Timed entries</h3>
        {timed.length ? timed.map((entry) => <DayEntry entry={entry} key={entry.id} onEntry={onEntry} />) : <div className="quiet-empty">No timed entries for {formatDate(day)}</div>}
      </section>
    </div>
  );
}

function DayEntry({ entry, onEntry }) {
  return (
    <article className="day-entry">
      <EntryBadge entry={entry} />
      <strong>{entry.display_title || entry.title}</strong>
      <span>{formatEventTime(entry)} / {entry.status}</span>
      <span>{entry.assignees?.map((assignee) => assignee.display_name).join(", ") || entry.assigned_user_name || "Unassigned"}</span>
      <span>{entry.department_name || SCHEDULE_CATEGORY_LABELS[entry.schedule_category] || entry.schedule_category}</span>
      <span>{entry.resource_reservations?.map((resource) => resource.name).join(", ") || entry.order_number || entry.work_order_title || entry.item_title || entry.item_description || entry.estimate_number || "Unlinked"}</span>
      <button type="button" onClick={() => onEntry(entry)}>Open/details</button>
    </article>
  );
}

function EntrySummary({ entry }) {
  return (
    <div className="entry-summary">
      <EntryBadge entry={entry} />
      <strong>{entry.display_title || entry.title}</strong>
      <span>{formatDate(entry.local_start_date)} {formatEventTime(entry)}</span>
      <span>Status: {entry.status}</span>
      <span>Category: {SCHEDULE_CATEGORY_LABELS[entry.schedule_category] || entry.schedule_category}</span>
      <span>Department: {entry.department_name || "None"}</span>
      <span>Assignees: {entry.assignees?.map((assignee) => assignee.display_name).join(", ") || entry.assigned_user_name || "Unassigned"}</span>
      <span>Resources: {entry.resource_reservations?.map((resource) => resource.name).join(", ") || "None"}</span>
      <span>Linked: {entry.order_number || entry.work_order_title || entry.item_title || entry.item_description || entry.estimate_number || "None"}</span>
      {entry.order_id && <a href={`#/orders/${entry.order_id}`}>Open linked Order</a>}
    </div>
  );
}

function CalendarOverlay({ title, onClose, children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialogRef.current?.focus?.(), 0);
    const keydown = (event) => {
      if (event.key === "Escape") onClose();
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
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose]);
  return (
    <div className="calendar-overlay-backdrop">
      <section className="calendar-overlay-panel" role="dialog" aria-modal="true" aria-label={title} tabIndex="-1" ref={dialogRef}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="calendar-overlay-scroll">{children}</div>
      </section>
    </div>
  );
}

function ScheduleManagement({ api, events, users, departments, resources, views, canManage, onRefresh }) {
  const [viewForm, setViewForm] = useState({ name: "", schedule_category: "general", color: "#255b73" });
  const [departmentForm, setDepartmentForm] = useState({ name: "", color: "#255b73", user_id: "", primary_department: true });
  const [resourceForm, setResourceForm] = useState({ name: "", resource_type: "equipment", capacity: 1, department_id: "", color: "#64748b" });
  const [action, setAction] = useState({ busy: false, error: "" });
  if (!canManage) return <div className="notice">Shared calendar, department, and resource management requires owner, admin, or manager access.</div>;
  async function run(work) {
    setAction({ busy: true, error: "" });
    try {
      await work();
      onRefresh();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  return (
    <div className="schedule-management">
      {action.error && <div className="error-state">{action.error}</div>}
      <section>
        <h3>Calendar views</h3>
        <div className="management-list">
          {views.map((calendarView) => (
            <article className="management-row" key={calendarView.id}>
              <span className="view-color" style={{ background: calendarView.color }} />
              <strong>{calendarView.name}</strong>
              <span>{calendarView.visibility}{calendarView.system_protected ? " / system-protected" : ""}</span>
              <div className="row-actions">
                {!calendarView.system_protected && <button type="button" disabled={action.busy} onClick={() => {
                  const name = window.prompt?.("Calendar view name", calendarView.name);
                  if (name) run(() => api.patch(`/schedule/views/${calendarView.id}`, { name }));
                }}>Rename</button>}
                {!calendarView.system_protected && <button type="button" disabled={action.busy} onClick={() => {
                  const category = window.prompt?.("Schedule category filter", calendarView.filters?.schedule_categories?.[0] || "general");
                  if (category) run(() => api.patch(`/schedule/views/${calendarView.id}`, { filters: { ...calendarView.filters, schedule_categories: [category] } }));
                }}>Change filter</button>}
                {!calendarView.system_protected && <button type="button" disabled={action.busy} onClick={() => run(() => api.patch(`/schedule/views/${calendarView.id}`, { display_order: Math.max(0, (calendarView.display_order || 0) - 10) }))}>Up</button>}
                {!calendarView.system_protected && <button type="button" disabled={action.busy} onClick={() => run(() => api.patch(`/schedule/views/${calendarView.id}`, { display_order: (calendarView.display_order || 0) + 10 }))}>Down</button>}
                <button type="button" disabled={calendarView.system_protected || action.busy} onClick={() => run(() => api.patch(`/schedule/views/${calendarView.id}`, { active: !calendarView.active }))}>{calendarView.active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </article>
          ))}
        </div>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          run(() => api.post("/schedule/views", {
            name: viewForm.name,
            color: viewForm.color,
            visibility: "shared",
            filters: { schedule_categories: [viewForm.schedule_category], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" },
          }));
          setViewForm({ name: "", schedule_category: "general", color: "#255b73" });
        }}>
          <input aria-label="Shared view name" placeholder="Shared view name" value={viewForm.name} onChange={(event) => setViewForm({ ...viewForm, name: event.target.value })} />
          <select aria-label="Shared view category" value={viewForm.schedule_category} onChange={(event) => setViewForm({ ...viewForm, schedule_category: event.target.value })}>{SCHEDULE_CATEGORIES.map((category) => <option value={category} key={category}>{SCHEDULE_CATEGORY_LABELS[category]}</option>)}</select>
          <input aria-label="Shared view color" type="color" value={viewForm.color} onChange={(event) => setViewForm({ ...viewForm, color: event.target.value })} />
          <button disabled={action.busy}>Create shared view</button>
        </form>
      </section>
      <section>
        <h3>Departments</h3>
        <div className="management-list">
          {departments.map((department) => (
            <article className="management-row" key={department.id}>
              <span className="view-color" style={{ background: department.color }} />
              <strong>{department.name}</strong>
              <span>{department.active ? "Active" : "Inactive"} / {department.memberships?.filter((membership) => membership.active).length || 0} employees</span>
              <button type="button" disabled={action.busy} onClick={() => run(() => api.patch(`/schedule/departments/${department.id}`, { active: !department.active }))}>{department.active ? "Deactivate" : "Reactivate"}</button>
            </article>
          ))}
        </div>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          run(() => api.post("/schedule/departments", {
            name: departmentForm.name,
            color: departmentForm.color,
            memberships: departmentForm.user_id ? [{ user_id: departmentForm.user_id, primary_department: departmentForm.primary_department, active: true }] : [],
          }));
          setDepartmentForm({ name: "", color: "#255b73", user_id: "", primary_department: true });
        }}>
          <input aria-label="Department name" placeholder="Department name" value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} />
          <input aria-label="Department color" type="color" value={departmentForm.color} onChange={(event) => setDepartmentForm({ ...departmentForm, color: event.target.value })} />
          <select aria-label="Department employee" value={departmentForm.user_id} onChange={(event) => setDepartmentForm({ ...departmentForm, user_id: event.target.value })}>
            <option value="">No initial employee</option>
            {users.map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}
          </select>
          <button disabled={action.busy}>Create department</button>
        </form>
      </section>
      <section>
        <h3>Resources</h3>
        <div className="management-list">
          {resources.map((resource) => (
            <article className="management-row" key={resource.id}>
              <span className="view-color" style={{ background: resource.color }} />
              <strong>{resource.name}</strong>
              <span>{resource.resource_type} / capacity {resource.capacity}</span>
              <button type="button" disabled={action.busy} onClick={() => run(() => api.patch(`/schedule/resources/${resource.id}`, { active: !resource.active }))}>{resource.active ? "Deactivate" : "Reactivate"}</button>
            </article>
          ))}
        </div>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          run(() => api.post("/schedule/resources", { ...resourceForm, capacity: Number(resourceForm.capacity), department_id: resourceForm.department_id || null }));
          setResourceForm({ name: "", resource_type: "equipment", capacity: 1, department_id: "", color: "#64748b" });
        }}>
          <input aria-label="Resource name" placeholder="Resource name" value={resourceForm.name} onChange={(event) => setResourceForm({ ...resourceForm, name: event.target.value })} />
          <select aria-label="Resource type" value={resourceForm.resource_type} onChange={(event) => setResourceForm({ ...resourceForm, resource_type: event.target.value })}>
            <option value="equipment">Equipment</option>
            <option value="vehicle">Vehicle</option>
            <option value="production_area">Production area/bay</option>
            <option value="installation_crew">Installation crew</option>
            <option value="other">Other</option>
          </select>
          <input aria-label="Resource capacity" type="number" min="1" value={resourceForm.capacity} onChange={(event) => setResourceForm({ ...resourceForm, capacity: event.target.value })} />
          <select aria-label="Resource department" value={resourceForm.department_id} onChange={(event) => setResourceForm({ ...resourceForm, department_id: event.target.value })}>
            <option value="">No department</option>
            {departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}
          </select>
          <button disabled={action.busy}>Create resource</button>
        </form>
      </section>
      <section>
        <h3>Preview</h3>
        <div className="management-list">
          {(events.data?.items || []).slice(0, 6).map((entry) => <article className="management-row" key={entry.id}><strong>{entry.display_title || entry.title}</strong><span>{SCHEDULE_CATEGORY_LABELS[entry.schedule_category] || entry.schedule_category}</span><span>{entry.department_name || "No department"}</span></article>)}
        </div>
      </section>
    </div>
  );
}

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

function EmployeesPage({ api, session }) {
  const state = useLoad(async () => {
    const [settings, employees] = await Promise.all([api.get("/settings"), api.get("/employees")]);
    return { users: settings.users || [], employees: employees.items || [] };
  }, []);
  const canManage = ["owner", "admin"].includes(session.user.role);
  const [form, setForm] = useState({ user_id: "", name: "", email: "", phone: "", role: "staff", portal_access_enabled: true, pay_management_enabled: false, active: true, hire_date: "", hourly_rate: "", rate_effective_date: todayInput(), internal_note: "" });
  const [rateForm, setRateForm] = useState({ employee_id: "", hourly_rate: "", effective_date: todayInput(), note: "" });
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });

  useEffect(() => {
    if (!form.user_id && state.data?.users?.length) {
      const user = state.data.users[0];
      setForm((current) => ({ ...current, user_id: user.id, name: user.display_name, email: user.email, role: user.role }));
    }
  }, [state.data, form.user_id]);

  function selectUser(userId) {
    const user = state.data?.users?.find((entry) => entry.id === userId);
    setForm({ ...form, user_id: userId, name: user?.display_name || form.name, email: user?.email || form.email, role: user?.role || form.role });
  }

  async function createEmployee(event) {
    event.preventDefault();
    if (!canManage) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post("/employees", {
        ...form,
        phone: form.phone || null,
        hire_date: form.hire_date || null,
        internal_note: form.internal_note || null,
        hourly_rate_cents: form.hourly_rate ? dollarsToCents(form.hourly_rate) : undefined,
        rate_effective_date: form.rate_effective_date || todayInput(),
      });
      setForm({ user_id: state.data?.users?.[0]?.id || "", name: "", email: "", phone: "", role: "staff", portal_access_enabled: true, pay_management_enabled: false, active: true, hire_date: "", hourly_rate: "", rate_effective_date: todayInput(), internal_note: "" });
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Employee saved" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function updateEmployee(employee, changes) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.patch(`/employees/${employee.id}`, changes);
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Employee updated" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function addRate(event) {
    event.preventDefault();
    if (!rateForm.employee_id || !rateForm.hourly_rate) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post(`/employees/${rateForm.employee_id}/rates`, { hourly_rate_cents: dollarsToCents(rateForm.hourly_rate), effective_date: rateForm.effective_date, note: rateForm.note || null });
      setRateForm({ ...rateForm, hourly_rate: "", note: "" });
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Rate added" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  return (
    <TwoColumn>
      <form className="panel form-grid" onSubmit={createEmployee}>
        <h2>Employee Administration</h2>
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="notice">{action.saved}</div>}
        {!canManage && <div className="notice">Employee administration requires owner or admin access.</div>}
        <SelectField label="Linked user" value={form.user_id} disabled={!canManage} onChange={selectUser}>
          {(state.data?.users || []).map((user) => <option key={user.id} value={user.id}>{user.display_name} / {user.email}</option>)}
        </SelectField>
        <Field label="Employee name" value={form.name} disabled={!canManage} onChange={(name) => setForm({ ...form, name })} />
        <Field label="Email" type="email" value={form.email} disabled={!canManage} onChange={(email) => setForm({ ...form, email })} />
        <Field label="Phone" value={form.phone} disabled={!canManage} onChange={(phone) => setForm({ ...form, phone })} />
        <SelectField label="Role" value={form.role} disabled={!canManage} onChange={(role) => setForm({ ...form, role })}>
          {["staff", "manager", "admin", "owner"].map((role) => <option key={role}>{role}</option>)}
        </SelectField>
        <Field label="Hire/start date" type="date" value={form.hire_date} disabled={!canManage} onChange={(hire_date) => setForm({ ...form, hire_date })} />
        <Field label="Initial hourly rate" value={form.hourly_rate} disabled={!canManage} onChange={(hourly_rate) => setForm({ ...form, hourly_rate })} />
        <Field label="Rate effective date" type="date" value={form.rate_effective_date} disabled={!canManage} onChange={(rate_effective_date) => setForm({ ...form, rate_effective_date })} />
        <label className="check-row"><input type="checkbox" checked={form.portal_access_enabled} disabled={!canManage} onChange={(event) => setForm({ ...form, portal_access_enabled: event.target.checked })} />Portal access</label>
        <label className="check-row"><input type="checkbox" checked={form.pay_management_enabled} disabled={session.user.role !== "owner"} onChange={(event) => setForm({ ...form, pay_management_enabled: event.target.checked })} />Pay management permission</label>
        <label className="check-row"><input type="checkbox" checked={form.active} disabled={!canManage} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Active</label>
        <Field label="Internal note" value={form.internal_note} disabled={!canManage} onChange={(internal_note) => setForm({ ...form, internal_note })} />
        {canManage && <button className="primary-button" disabled={action.busy}><UserPlus size={16} />Create Employee</button>}
      </form>
      <section className="panel">
        <Toolbar title="Employees" />
        <AsyncState state={state} empty="No employees yet">
          <div className="record-list">
            {(state.data?.employees || []).map((employee) => (
              <article className="record-row stacked-row" key={employee.id}>
                <div><strong>{employee.name}</strong><span>{employee.employee_number} / {employee.email}</span><span>{employee.active ? "Active" : "Inactive"} / portal {employee.portal_access_enabled ? "enabled" : "disabled"}</span></div>
                {employee.current_rate_cents !== undefined && <span>{employee.current_rate_cents === null ? "No rate" : `$${centsToDollars(employee.current_rate_cents)}/hr`} {employee.current_rate_effective_date ? `from ${employee.current_rate_effective_date}` : ""}</span>}
                {canManage && (
                  <div className="row-actions">
                    <button type="button" onClick={() => updateEmployee(employee, { active: !employee.active })}>{employee.active ? "Deactivate" : "Activate"}</button>
                    <button type="button" onClick={() => updateEmployee(employee, { portal_access_enabled: !employee.portal_access_enabled })}>{employee.portal_access_enabled ? "Disable Portal" : "Enable Portal"}</button>
                    {session.user.role === "owner" && <button type="button" onClick={() => updateEmployee(employee, { pay_management_enabled: !employee.pay_management_enabled })}>{employee.pay_management_enabled ? "Remove Pay Access" : "Grant Pay Access"}</button>}
                    <button type="button" onClick={() => setRateForm({ ...rateForm, employee_id: employee.id })}>Set Rate</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </AsyncState>
      </section>
      <form className="panel form-grid" onSubmit={addRate}>
        <h2>Effective-Dated Rate</h2>
        <SelectField label="Employee" value={rateForm.employee_id} onChange={(employee_id) => setRateForm({ ...rateForm, employee_id })}>
          <option value="">Select employee</option>
          {(state.data?.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </SelectField>
        <Field label="Hourly rate" value={rateForm.hourly_rate} onChange={(hourly_rate) => setRateForm({ ...rateForm, hourly_rate })} />
        <Field label="Effective date" type="date" value={rateForm.effective_date} onChange={(effective_date) => setRateForm({ ...rateForm, effective_date })} />
        <Field label="Note" value={rateForm.note} onChange={(note) => setRateForm({ ...rateForm, note })} />
        <button className="primary-button" disabled={action.busy || !rateForm.employee_id}><DollarSign size={16} />Add Rate</button>
      </form>
    </TwoColumn>
  );
}

function TimeAttendancePage({ api }) {
  const [employeeId, setEmployeeId] = useState("");
  const [weekStart, setWeekStart] = useState(todayInput());
  const state = useLoad(async () => {
    const employees = await api.get("/employees");
    const selected = employeeId || employees.items?.[0]?.id || "";
    const time = selected ? await api.get(`/time/entries?employee_id=${encodeURIComponent(selected)}&week_start_date=${encodeURIComponent(weekStart)}`) : { entries: [], clocked_in: [] };
    return { employees: employees.items || [], selected, time };
  }, [employeeId, weekStart]);
  const [form, setForm] = useState({ clock_in_at: "", clock_out_at: "", clock_in_note: "", clock_out_note: "", reason: "" });
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const selectedEmployee = employeeId || state.data?.selected || "";

  async function addEntry(event) {
    event.preventDefault();
    if (!selectedEmployee) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post("/time/entries", { ...form, employee_id: selectedEmployee });
      setForm({ clock_in_at: "", clock_out_at: "", clock_in_note: "", clock_out_note: "", reason: "" });
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Time Entry saved" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function correctEntry(entry) {
    const reason = window.prompt("Correction reason");
    if (!reason) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.patch(`/time/entries/${entry.id}`, { clock_in_at: entry.clock_in_at, clock_out_at: entry.clock_out_at || null, reason });
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Time Entry corrected" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function voidEntry(entry) {
    const reason = window.prompt("Void reason");
    if (!reason) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.post(`/time/entries/${entry.id}/void`, { reason });
      await state.refresh();
      setAction({ busy: false, error: "", saved: "Time Entry voided" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  return (
    <TwoColumn>
      <section className="panel">
        <Toolbar title="Currently Clocked In" />
        {(state.data?.time?.clocked_in || []).length ? state.data.time.clocked_in.map((entry) => <div className="record-row" key={entry.id}><strong>{entry.employee_name}</strong><span>{entry.clock_in_display}</span></div>) : <div className="empty-state">No one is clocked in</div>}
      </section>
      <section className="panel">
        <Toolbar title="Time Entries" />
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="notice">{action.saved}</div>}
        <div className="inline-form">
          <select value={selectedEmployee} onChange={(event) => setEmployeeId(event.target.value)}>
            {(state.data?.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
          <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
        </div>
        <div className="summary-grid">
          <span>Week <strong>{state.data?.time?.week?.week_start_date || ""} - {state.data?.time?.week?.week_end_date || ""}</strong></span>
          <span>Valid hours <strong>{minutesLabel(state.data?.time?.current_week_total_minutes)}</strong></span>
        </div>
        <div className="record-list">
          {(state.data?.time?.entries || []).map((entry) => (
            <article className="record-row stacked-row" key={entry.id}>
              <div><strong>{entry.clock_in_display} - {entry.clock_out_display || "Open"}</strong><span>{entry.status} / {minutesLabel(entry.duration_minutes)}</span>{entry.implausible && <span>Implausibly long or open</span>}</div>
              <div className="row-actions"><button type="button" onClick={() => correctEntry(entry)}>Correct</button><button type="button" onClick={() => voidEntry(entry)}>Void</button></div>
            </article>
          ))}
        </div>
      </section>
      <form className="panel form-grid" onSubmit={addEntry}>
        <h2>Add Missing Time Entry</h2>
        <Field label="Clock in" type="datetime-local" value={form.clock_in_at} onChange={(clock_in_at) => setForm({ ...form, clock_in_at })} />
        <Field label="Clock out" type="datetime-local" value={form.clock_out_at} onChange={(clock_out_at) => setForm({ ...form, clock_out_at })} />
        <Field label="Clock-in note" value={form.clock_in_note} onChange={(clock_in_note) => setForm({ ...form, clock_in_note })} />
        <Field label="Clock-out note" value={form.clock_out_note} onChange={(clock_out_note) => setForm({ ...form, clock_out_note })} />
        <Field label="Reason" value={form.reason} onChange={(reason) => setForm({ ...form, reason })} />
        <button className="primary-button" disabled={action.busy || !selectedEmployee}><Clock size={16} />Add Entry</button>
      </form>
    </TwoColumn>
  );
}

function PayrollPage({ api }) {
  const [employeeId, setEmployeeId] = useState("");
  const [weekStart, setWeekStart] = useState(todayInput());
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const state = useLoad(async () => {
    const employees = await api.get("/employees");
    const selected = employeeId || employees.items?.[0]?.id || "";
    return { employees: employees.items || [], selected };
  }, [employeeId]);
  const selectedEmployee = employeeId || state.data?.selected || "";
  const [advance, setAdvance] = useState({ amount: "", note: "", advance_date: todayInput() });
  const [adjustment, setAdjustment] = useState({ amount: "", direction: "positive", reason: "" });
  const [payment, setPayment] = useState({ amount: "", payment_date: todayInput(), method: "", reference: "", note: "" });

  async function loadDetail(employee = selectedEmployee, week = weekStart) {
    if (!employee) return;
    try {
      setDetail(await api.get(`/payroll/employees/${employee}/weeks/${week}`));
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  useEffect(() => { loadDetail(); }, [selectedEmployee, weekStart]);

  async function submitLedger(kind, payload, reset) {
    setAction({ busy: true, error: "", saved: "" });
    try {
      const data = await api.post(`/payroll/${kind}`, { ...payload, employee_id: selectedEmployee, pay_week_start: weekStart });
      setDetail(data);
      reset();
      setAction({ busy: false, error: "", saved: "Pay record saved" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function closeWeek() {
    setAction({ busy: true, error: "", saved: "" });
    try {
      setDetail(await api.post(`/payroll/employees/${selectedEmployee}/weeks/${weekStart}/close`, {}));
      setAction({ busy: false, error: "", saved: "Week closed" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function reopenWeek() {
    const reason = window.prompt("Reopen reason");
    if (!reason) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      setDetail(await api.post(`/payroll/employees/${selectedEmployee}/weeks/${weekStart}/reopen`, { reason }));
      setAction({ busy: false, error: "", saved: "Week reopened" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  const week = detail?.week;
  return (
    <TwoColumn>
      <section className="panel">
        <Toolbar title="Internal Pay Summary" />
        {action.error && <div className="error-state">{action.error}</div>}
        {action.saved && <div className="notice">{action.saved}</div>}
        <div className="inline-form">
          <select value={selectedEmployee} onChange={(event) => setEmployeeId(event.target.value)}>
            {(state.data?.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
          <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
        </div>
        {week ? (
          <>
            <div className="summary-grid pay-summary-grid">
              <span>Status <strong>{week.status}</strong></span>
              <span>Payday <strong>{week.payday_date}</strong></span>
              <span>Valid hours <strong>{minutesLabel(week.valid_minutes)}</strong></span>
              <span>Gross estimate <strong>{money(week.gross_pay_cents)}</strong></span>
              <span>Opening carryover <strong>{money(week.opening_carryover_cents)}</strong></span>
              <span>Advances <strong>{money(week.advances_cents)}</strong></span>
              <span>Adjustments <strong>{money(week.positive_adjustments_cents - week.negative_adjustments_cents)}</strong></span>
              <span>Manual payments <strong>{money(week.manual_payments_cents)}</strong></span>
              <span>Estimated Amount Due <strong>{money(week.estimated_amount_due_cents)}</strong></span>
              <span>Closing carryover <strong>{week.closing_carryover_cents === null ? "Open" : money(week.closing_carryover_cents)}</strong></span>
            </div>
            <div className="record-list">
              {week.rate_breakdown.map((rate) => <article className="record-row" key={rate.hourly_rate_cents}><strong>${centsToDollars(rate.hourly_rate_cents)}/hr</strong><span>{rate.hours_decimal} hrs / {money(rate.gross_pay_cents)}</span></article>)}
            </div>
            <div className="notice">{detail.formula}</div>
            <div className="row-actions"><button type="button" onClick={closeWeek} disabled={action.busy || week.status === "closed"}>Close Week</button><button type="button" onClick={reopenWeek} disabled={action.busy || week.status !== "closed"}>Reopen</button></div>
          </>
        ) : <div className="empty-state">No pay week selected</div>}
      </section>
      <form className="panel form-grid" onSubmit={(event) => { event.preventDefault(); submitLedger("advances", { amount_cents: dollarsToCents(advance.amount), advance_date: advance.advance_date, note: advance.note }, () => setAdvance({ amount: "", note: "", advance_date: todayInput() })); }}>
        <h2>Advance</h2>
        <Field label="Amount" value={advance.amount} onChange={(amount) => setAdvance({ ...advance, amount })} />
        <Field label="Date" type="date" value={advance.advance_date} onChange={(advance_date) => setAdvance({ ...advance, advance_date })} />
        <Field label="Reason or note" value={advance.note} onChange={(note) => setAdvance({ ...advance, note })} />
        <button className="primary-button" disabled={action.busy || !selectedEmployee}>Record Advance</button>
      </form>
      <form className="panel form-grid" onSubmit={(event) => { event.preventDefault(); submitLedger("adjustments", { amount_cents: dollarsToCents(adjustment.amount), direction: adjustment.direction, reason: adjustment.reason }, () => setAdjustment({ amount: "", direction: "positive", reason: "" })); }}>
        <h2>Adjustment</h2>
        <Field label="Amount" value={adjustment.amount} onChange={(amount) => setAdjustment({ ...adjustment, amount })} />
        <SelectField label="Direction" value={adjustment.direction} onChange={(direction) => setAdjustment({ ...adjustment, direction })}><option value="positive">Positive</option><option value="negative">Negative</option></SelectField>
        <Field label="Required reason" value={adjustment.reason} onChange={(reason) => setAdjustment({ ...adjustment, reason })} />
        <button className="primary-button" disabled={action.busy || !selectedEmployee}>Record Adjustment</button>
      </form>
      <form className="panel form-grid" onSubmit={(event) => { event.preventDefault(); submitLedger("manual-payments", { amount_cents: dollarsToCents(payment.amount), payment_date: payment.payment_date, method: payment.method || null, reference: payment.reference || null, note: payment.note || null }, () => setPayment({ amount: "", payment_date: todayInput(), method: "", reference: "", note: "" })); }}>
        <h2>Manual Payment</h2>
        <Field label="Amount" value={payment.amount} onChange={(amount) => setPayment({ ...payment, amount })} />
        <Field label="Payment date" type="date" value={payment.payment_date} onChange={(payment_date) => setPayment({ ...payment, payment_date })} />
        <Field label="Method" value={payment.method} onChange={(method) => setPayment({ ...payment, method })} />
        <Field label="Reference" value={payment.reference} onChange={(reference) => setPayment({ ...payment, reference })} />
        <Field label="Note" value={payment.note} onChange={(note) => setPayment({ ...payment, note })} />
        <button className="primary-button" disabled={action.busy || !selectedEmployee}>Record Manual Payment</button>
      </form>
    </TwoColumn>
  );
}

function AnnouncementManagementPage({ api }) {
  const state = useLoad(() => api.get("/announcements"), []);
  const blank = { title: "", body: "", publish_at: localDateTimeInput(), expires_at: "", audience_role: "all" };
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState("");
  const [action, setAction] = useState({ busy: false, error: "" });
  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      publish_at: localDateTimeInput(item.publish_at),
      expires_at: item.expires_at ? localDateTimeInput(item.expires_at) : "",
      audience_role: item.audience_role || "all",
    });
  }
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    const payload = { ...form, expires_at: form.expires_at || null };
    try {
      if (editingId) await api.patch(`/announcements/${editingId}`, payload);
      else await api.post("/announcements", payload);
      setForm(blank);
      setEditingId("");
      await state.refresh();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  async function archive(id) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/announcements/${id}/archive`, {});
      await state.refresh();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  return (
    <TwoColumn>
      <form className="panel form-grid" onSubmit={save}>
        <Toolbar title={editingId ? "Edit Announcement" : "Announcement"}>{editingId && <button type="button" onClick={() => { setEditingId(""); setForm(blank); }}>Cancel</button>}</Toolbar>
        {action.error && <div className="error-state">{action.error}</div>}
        <Field label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} />
        <label className="field"><span>Body</span><textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label>
        <Field label="Publish" type="datetime-local" value={form.publish_at} onChange={(publish_at) => setForm({ ...form, publish_at })} />
        <Field label="Expires" type="datetime-local" value={form.expires_at} onChange={(expires_at) => setForm({ ...form, expires_at })} />
        <SelectField label="Audience" value={form.audience_role} onChange={(audience_role) => setForm({ ...form, audience_role })}>
          <option value="all">All employees</option>
          <option value="owner">Owners</option>
          <option value="admin">Admins</option>
          <option value="manager">Managers</option>
          <option value="staff">Staff</option>
        </SelectField>
        <button className="primary-button" disabled={action.busy}><Megaphone size={16} />{editingId ? "Save Announcement" : "Post Announcement"}</button>
      </form>
      <section className="panel">
        <Toolbar title="Employee Announcements" />
        <AsyncState state={state} empty="No announcements">
          <div className="record-list">
            {(state.data?.items || []).map((item) => (
              <article className="record-row stacked-row announcement-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.audience_role === "all" ? "All employees" : item.audience_role} / {item.archived_at ? "Archived" : "Active"}</span>
                  <p>{item.body}</p>
                </div>
                <button type="button" onClick={() => startEdit(item)} disabled={action.busy || item.archived_at}>Edit</button>
                <button type="button" onClick={() => archive(item.id)} disabled={action.busy || item.archived_at}>Archive</button>
              </article>
            ))}
          </div>
        </AsyncState>
      </section>
    </TwoColumn>
  );
}

function PortalAnnouncementsPage({ api }) {
  const state = useLoad(() => api.get("/employee-portal/announcements"), []);
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  async function openAnnouncement(id) {
    setAction({ busy: true, error: "" });
    try {
      const detail = await api.get(`/employee-portal/announcements/${id}`);
      setSelected(detail);
      await state.refresh();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  return (
    <TwoColumn>
      <section className="panel">
        <Toolbar title="Announcements" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={state} empty="No announcements">
          <div className="record-list">
            {(state.data?.items || []).map((item) => (
              <button type="button" className="record-row portal-list-button" key={item.id} onClick={() => openAnnouncement(item.id)}>
                <div><strong>{item.title}</strong><span>{item.unread ? "Unread" : "Read"} / {item.author_name}</span></div>
                <span>{localDateTimeInput(item.publish_at).replace("T", " ")}</span>
              </button>
            ))}
          </div>
        </AsyncState>
      </section>
      <section className="panel">
        <Toolbar title={selected?.title || "Announcement Detail"} />
        {selected ? (
          <article className="portal-message-detail">
            <span>{selected.author_name} / {selected.read_at ? "Read" : "Unread"}</span>
            <p>{selected.body}</p>
          </article>
        ) : <div className="empty-state">Select an announcement</div>}
      </section>
    </TwoColumn>
  );
}

function PortalMessagesPage({ api }) {
  const conversations = useLoad(() => api.get("/employee-portal/messages"), []);
  const participants = useLoad(() => api.get("/employee-portal/message-participants"), []);
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [thread, setThread] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "" });
  useEffect(() => {
    if (!recipientId && participants.data?.items?.length) setRecipientId(participants.data.items[0].user_id);
  }, [participants.data, recipientId]);
  async function openConversation(userId) {
    setRecipientId(userId);
    setAction({ busy: true, error: "" });
    try {
      const detail = await api.get(`/employee-portal/messages/${userId}`);
      setThread(detail);
      await conversations.refresh();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  async function sendMessage(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      const sent = await api.post("/employee-portal/messages", { recipient_user_id: recipientId, body });
      setBody("");
      await conversations.refresh();
      await openConversation(sent.recipient_user_id);
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  const selectedMessages = thread?.messages || [];
  return (
    <TwoColumn>
      <section className="panel">
        <Toolbar title="Messages" />
        {action.error && <div className="error-state">{action.error}</div>}
        <AsyncState state={conversations} empty="No conversations">
          <div className="record-list">
            {(conversations.data?.items || []).map((item) => (
              <button type="button" className="record-row portal-list-button" key={item.user_id} onClick={() => openConversation(item.user_id)}>
                <div><strong>{item.display_name}</strong><span>{item.last_message?.body}</span></div>
                <span>{item.unread_count ? `${item.unread_count} unread` : "Open"}</span>
              </button>
            ))}
          </div>
        </AsyncState>
      </section>
      <section className="panel portal-thread-panel">
        <Toolbar title={thread?.participant?.display_name || "Conversation"} />
        <div className="portal-thread">
          {selectedMessages.length ? selectedMessages.map((message) => (
            <article className={`portal-bubble ${message.direction}`} key={message.id}>
              <strong>{message.direction === "sent" ? "You" : message.sender_name}</strong>
              <p>{message.body}</p>
              <span>{localDateTimeInput(message.sent_at).replace("T", " ")}{message.direction === "sent" && message.recipient_read_at ? " / Read" : ""}</span>
            </article>
          )) : <div className="empty-state">Select or start a conversation</div>}
        </div>
        <form className="form-grid" onSubmit={sendMessage}>
          <SelectField label="To" value={recipientId} onChange={setRecipientId}>
            {(participants.data?.items || []).map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}
          </SelectField>
          <label className="field"><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <button className="primary-button" disabled={action.busy || !recipientId || !body.trim()}><Send size={16} />Send Message</button>
        </form>
      </section>
    </TwoColumn>
  );
}

function EmployeePortalPage({ api, pageKey }) {
  if (pageKey === "announcements") return <PortalAnnouncementsPage api={api} />;
  if (pageKey === "messages") return <PortalMessagesPage api={api} />;
  const isPay = pageKey === "my-pay";
  const state = useLoad(() => api.get(isPay ? "/employee-portal/my-pay" : "/employee-portal/time-clock"), [isPay]);
  const [note, setNote] = useState("");
  const [action, setAction] = useState({ busy: false, error: "" });
  async function punch(kind) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/employee-portal/${kind}`, { note: note || null });
      setNote("");
      await state.refresh();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  if (state.error) return <section className="panel"><h2>Restricted Employee Portal</h2><div className="error-state">{state.error}</div></section>;
  if (isPay) {
    const week = state.data?.week;
    return (
      <section className="panel employee-portal-panel">
        <Toolbar title="My Pay" />
        <AsyncState state={state} empty="No pay data">
          {week && <div className="summary-grid pay-summary-grid">
            <span>Status <strong>{week.status}</strong></span>
            <span>Week <strong>{week.week_start_date} - {week.week_end_date}</strong></span>
            <span>Payday <strong>{week.payday_date}</strong></span>
            <span>Valid hours <strong>{minutesLabel(week.valid_minutes)}</strong></span>
            <span>Gross estimate <strong>{money(week.gross_pay_cents)}</strong></span>
            <span>Opening carryover <strong>{money(week.opening_carryover_cents)}</strong></span>
            <span>Advances <strong>{money(week.advances_cents)}</strong></span>
            <span>Adjustments <strong>{money(week.positive_adjustments_cents - week.negative_adjustments_cents)}</strong></span>
            <span>Manual payments <strong>{money(week.manual_payments_cents)}</strong></span>
            <span>Estimated Amount Due <strong>{money(week.estimated_amount_due_cents)}</strong></span>
          </div>}
          <div className="record-list">{(week?.rate_breakdown || []).map((rate) => <article className="record-row" key={rate.hourly_rate_cents}><strong>${centsToDollars(rate.hourly_rate_cents)}/hr</strong><span>{rate.hours_decimal} hrs / {money(rate.gross_pay_cents)}</span></article>)}</div>
        </AsyncState>
      </section>
    );
  }
  return (
    <section className="panel employee-portal-panel">
      <Toolbar title="Time Clock" />
      {action.error && <div className="error-state">{action.error}</div>}
      <AsyncState state={state} empty="No time data">
        <div className="portal-clock-action">
          <strong>{state.data?.open_entry ? "Clocked in" : "Clocked out"}</strong>
          {state.data?.warning && <span className="error-state">Open entry needs administrator review.</span>}
          <Field label="Work note" value={note} onChange={setNote} />
          {state.data?.open_entry ? <button className="primary-button" type="button" onClick={() => punch("clock-out")} disabled={action.busy}><Clock size={16} />Clock Out</button> : <button className="primary-button" type="button" onClick={() => punch("clock-in")} disabled={action.busy}><Clock size={16} />Clock In</button>}
        </div>
        <div className="summary-grid"><span>Current week <strong>{state.data?.week?.week_start_date} - {state.data?.week?.week_end_date}</strong></span><span>Total <strong>{minutesLabel(state.data?.current_week_total_minutes)}</strong></span></div>
        <div className="record-list">
          {(state.data?.entries || []).map((entry) => <article className="record-row" key={entry.id}><strong>{entry.clock_in_display} - {entry.clock_out_display || "Open"}</strong><span>{entry.status} / {minutesLabel(entry.duration_minutes)}</span></article>)}
        </div>
        <div className="notice">Corrections require an authorized administrator.</div>
      </AsyncState>
    </section>
  );
}

function SettingsPage({ api, session, onSession }) {
  const state = useLoad(() => api.get("/settings"), []);
  const [form, setForm] = useState(null);
  const [emailForm, setEmailForm] = useState({ sender_name: "", sender_email: "", sendgrid_verified: false });
  const [rotationReason, setRotationReason] = useState("");
  const [userForm, setUserForm] = useState({ display_name: "", email: "", password: "", role: "staff", active: true });
  const [action, setAction] = useState({ busy: false, error: "" });
  const canManageUsers = ["owner", "admin"].includes(session.user.role);
  const canEditSettings = ["owner", "admin"].includes(session.user.role);
  const roleOptions = session.user.role === "owner" ? ["staff", "manager", "admin", "owner"] : ["staff", "manager", "admin"];
  useEffect(() => {
    if (state.data?.tenant && !form) setForm({ ...state.data.tenant, address: state.data.tenant.address });
    if (state.data?.email_settings) {
      setEmailForm({
        sender_name: state.data.email_settings.sender_name || state.data.tenant?.company_name || "",
        sender_email: state.data.email_settings.sender_email || "",
        sendgrid_verified: Boolean(state.data.email_settings.sendgrid_verified),
      });
    }
  }, [state.data, form]);
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
  async function saveEmailSettings(event) {
    event.preventDefault();
    if (!canEditSettings) return;
    setAction({ busy: true, error: "" });
    try {
      await api.patch("/settings/email", { ...emailForm, sender_email: emailForm.sender_email || null });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function rotateIntake(event) {
    event.preventDefault();
    if (!canEditSettings || !rotationReason.trim()) return;
    setAction({ busy: true, error: "" });
    try {
      await api.post("/settings/intake-address/rotate", { reason: rotationReason });
      setRotationReason("");
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
      <form className="panel form-grid" onSubmit={saveEmailSettings}>
        <h2>Customer Email</h2>
        <div className="notice">SendGrid API keys and webhook secrets are read from server environment variables and are never shown here.</div>
        <Field label="Sender name" value={emailForm.sender_name} disabled={!canEditSettings} onChange={(sender_name) => setEmailForm({ ...emailForm, sender_name })} />
        <Field label="Sender email" type="email" value={emailForm.sender_email} disabled={!canEditSettings} onChange={(sender_email) => setEmailForm({ ...emailForm, sender_email })} />
        <label className="check-row"><input type="checkbox" checked={emailForm.sendgrid_verified} disabled={!canEditSettings} onChange={(event) => setEmailForm({ ...emailForm, sendgrid_verified: event.target.checked })} />Verified sender</label>
        <span className="status-pill"><Mail size={16} />{state.data?.email_settings?.provider_ready ? "Provider key configured" : "Provider key missing"}</span>
        {canEditSettings && <button className="primary-button" disabled={action.busy}><Save size={16} />Save Email Settings</button>}
      </form>
      <form className="panel form-grid" onSubmit={rotateIntake}>
        <h2>Order Intake</h2>
        <div className="notice">Forward only order-related email to this private address. Slim does not read Gmail, Outlook, or the full shop mailbox.</div>
        <label><span>Private intake address</span><input readOnly value={state.data?.intake_address?.full_address || ""} /></label>
        <Field label="Rotation reason" value={rotationReason} disabled={!canEditSettings} onChange={setRotationReason} />
        {canEditSettings && <button className="primary-button" disabled={action.busy || !rotationReason.trim()}><RotateCcw size={16} />Rotate Address</button>}
      </form>
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
          <Field label="Item title" value={item.title || ""} onChange={(title) => setItem(index, { title })} />
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
    title: form.title,
    document_date: form.document_date,
    due_date: form.due_date || null,
    expires_at: form.expires_at || null,
    follow_up_at: form.follow_up_at || null,
    status: form.status || "draft",
    discount_cents: cents(form.discount),
    internal_notes: form.internal_notes || null,
    items: form.items.map((item) => ({
      title: item.title,
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
