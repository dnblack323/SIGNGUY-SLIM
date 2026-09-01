import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, Search, ShieldCheck, XCircle } from "lucide-react";
import { apiRequest, blobApiFile, downloadApiFile, uploadApiFile } from "./api.js";
import { CalendarPage } from "./features/calendar/CalendarPage.jsx";
import { CustomersPage } from "./features/customers/CustomersPage.jsx";
import { HomePage } from "./features/dashboard/HomePage.jsx";
import { AnnouncementManagementPage, EmployeePortalPage, EmployeesPage, PayrollPage, TimeAttendancePage } from "./features/employees/EmployeePages.jsx";
import { BackupRestorePanel, SettingsPage } from "./features/settings/SettingsPage.jsx";
import { OrderIntakePage } from "./features/incoming/IncomingRequestsPage.jsx";
import { InvoicesPage, PaymentsPage } from "./features/invoices/InvoicePages.jsx";
import { NewOrderPage, OrderWorkspace, ScheduleFromWorkspaceModal } from "./features/orders/OrderWorkspace.jsx";
import { OrdersPage } from "./features/orders/OrdersPage.jsx";
import ProductionPage from "./features/production/ProductionPage.jsx";
import { EstimatesPage } from "./features/quotes/QuotesPage.jsx";
import {
  AsyncState,
  CalculatorModal,
  ContextualRibbon,
  DEFAULT_ORDER_FILTERS,
  Field,
  NotFoundPage,
  OrdersFilterBar,
  SelectField,
  Toolbar,
  TwoColumn,
  formatDate,
  formatProgress,
  useLoad,
} from "./features/general/GeneralPages.jsx";
import {
  AREA_NAVIGATION,
  enabledOperationalAreas,
  enabledQuickAccess,
  enabledUtilityItems,
  filterNavigationForRole,
  getRouteContext,
} from "./navigation.js";

const ROUTED_PAGE_KEYS = new Set([
  "home",
  "customers",
  "estimates",
  "orders",
  "production",
  "calendar",
  "announcements",
  "employees",
  "time",
  "payroll",
  "employee-portal",
  "invoices",
  "payments",
  "settings",
  "backup",
]);
function LogoMark() {
  return <div className="logo-mark" aria-hidden="true">SG</div>;
}

function AreaSidebar({ context, role, capabilities, onLogout, drawer = false, onNavigate }) {
  const operationalAreas = enabledOperationalAreas(undefined, role, capabilities);
  const utilities = enabledUtilityItems(role, capabilities);
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

function ModuleTabs({ context, role, capabilities }) {
  const modules = filterNavigationForRole(context.area.modules || [], role, capabilities);
  if (!modules.length) return null;
  const module = modules.find((entry) => entry.key === context.moduleKey) || modules[0];
  const childTabs = filterNavigationForRole(module?.children || [], role, capabilities);
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
  const [session, setSessionState] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [ordersFilters, setOrdersFilters] = useState(DEFAULT_ORDER_FILTERS);
  const [ordersFiltersOpen, setOrdersFiltersOpen] = useState(false);
  const [workspaceActions, setWorkspaceActions] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerButtonRef = useRef(null);
  function setSession(next) {
    setSessionState(next);
  }
  async function refreshSession() {
    const restored = await apiRequest("/auth/me", { onUnauthorized: () => setSession(null) });
    setSession(restored);
    return restored;
  }
  const api = useMemo(
    () => ({
      get: (path) => apiRequest(path, { onUnauthorized: () => setSession(null) }),
      post: (path, body) => apiRequest(path, { method: "POST", body, csrfToken: session?.csrf_token, onUnauthorized: () => setSession(null) }),
      put: (path, body) => apiRequest(path, { method: "PUT", body, csrfToken: session?.csrf_token, onUnauthorized: () => setSession(null) }),
      patch: (path, body) => apiRequest(path, { method: "PATCH", body, csrfToken: session?.csrf_token, onUnauthorized: () => setSession(null) }),
      delete: (path) => apiRequest(path, { method: "DELETE", csrfToken: session?.csrf_token, onUnauthorized: () => setSession(null) }),
      upload: (path, file, fields) => uploadApiFile(path, { file, fields, csrfToken: session?.csrf_token, onUnauthorized: () => setSession(null) }),
      blob: (path) => blobApiFile(path, { onUnauthorized: () => setSession(null) }),
      download: (path, filename, options = {}) => downloadApiFile(path, { filename, csrfToken: session?.csrf_token, onUnauthorized: () => setSession(null), ...options }),
    }),
    [session?.csrf_token],
  );
  useEffect(() => {
    async function restore() {
      localStorage.removeItem("signguySlimSession");
      try {
        const restored = await apiRequest("/auth/me");
        setSession(restored);
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
      await apiRequest("/auth/logout", { method: "POST", csrfToken: session?.csrf_token });
    } finally {
      setSession(null);
    }
  }
  const routeParts = route.split("/").filter(Boolean);
  const pageKey = routeParts[0] || "home";
  const baseRouteContext = getRouteContext(route);
  const capabilities = session?.capabilities || {};
  const isIncomingRequestsRoute = pageKey === "orders" && ["incoming", "intake"].includes(routeParts[1]);
  const routeAccessRedirect = (() => {
    if (!session) return "";
    if (pageKey === "employees" && !capabilities.can_manage_employees) return "#/production";
    if (pageKey === "time" && !capabilities.can_review_time) return "#/production";
    if (pageKey === "announcements" && !capabilities.can_manage_announcements) return "#/production";
    if (pageKey === "payroll" && !capabilities.can_manage_pay) return "#/invoices";
    if (pageKey === "employee-portal" && !capabilities.can_use_employee_portal) return "#/";
    return "";
  })();
  const routeUnavailable = !ROUTED_PAGE_KEYS.has(pageKey);
  const routeContext = routeUnavailable
    ? { ...baseRouteContext, module: null, child: null, moduleKey: baseRouteContext.areaKey, childKey: null, pageLabel: "Page Not Available", accent: "#64748b" }
    : baseRouteContext;
  const workspaceOrderId = pageKey === "orders" && routeParts[1] && !["new", "incoming", "intake"].includes(routeParts[1]) ? routeParts[1] : "";
  const isNewOrderRoute = pageKey === "orders" && routeParts[1] === "new";
  const existingOrderId = pageKey === "orders" && routeParts[1] && !["new", "incoming", "intake"].includes(routeParts[1]) ? routeParts[1] : "";
  const workspaceReturnRoute = workspaceOrderId && routeParts[2] === "from-production" ? "production" : "orders";
  const workspaceReturnItemId = workspaceReturnRoute === "production" ? routeParts[3] || "" : "";
  const orderOverlayOpen = isNewOrderRoute || Boolean(existingOrderId);

  useEffect(() => {
    if (route === "/orders/intake" || route.startsWith("/orders/intake/")) window.location.hash = "#/orders/incoming";
  }, [route]);

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
    if (routeAccessRedirect) window.location.hash = routeAccessRedirect;
  }, [routeAccessRedirect]);
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

  const employeeUi = { AsyncState, Field, SelectField, Toolbar, TwoColumn, useLoad };

  const shellStyle = { "--area-accent": routeContext.accent };
  const closeDrawer = ({ restoreFocus = false } = {}) => {
    setDrawerOpen(false);
    if (restoreFocus) window.setTimeout(() => drawerButtonRef.current?.focus(), 0);
  };

  return (
    <main className="app-shell" style={shellStyle}>
      <AreaSidebar context={routeContext} role={session.user.role} capabilities={capabilities} onLogout={logout} />
      {drawerOpen && (
        <div className="drawer-layer" role="presentation">
          <button type="button" className="drawer-backdrop" aria-label="Close navigation menu" onClick={() => closeDrawer({ restoreFocus: true })} />
          <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <button type="button" className="drawer-close" onClick={() => closeDrawer({ restoreFocus: true })}><XCircle size={18} />Close</button>
            <AreaSidebar context={routeContext} role={session.user.role} capabilities={capabilities} onLogout={() => { closeDrawer(); logout(); }} drawer onNavigate={() => closeDrawer()} />
          </aside>
        </div>
      )}
      <section className="workspace">
        <ShellHeader context={routeContext} session={session} drawerButtonRef={drawerButtonRef} onOpenDrawer={() => setDrawerOpen(true)} onCalculator={() => setCalculatorOpen(true)} />
        <ModuleTabs context={routeContext} role={session.user.role} capabilities={capabilities} />
        <ContextualRibbon
          pageKey={pageKey}
          routeParts={routeParts}
          capabilities={capabilities}
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
            {pageKey === "orders" && (isIncomingRequestsRoute ? <OrderIntakePage api={api} /> : <OrdersPage api={api} filters={ordersFilters} />)}
            {pageKey === "production" && <ProductionPage api={api} Toolbar={Toolbar} ScheduleFromWorkspaceModal={ScheduleFromWorkspaceModal} formatDate={formatDate} formatProgress={formatProgress} />}
            {pageKey === "calendar" && <CalendarPage api={api} setWorkspaceActions={setWorkspaceActions} />}
            {pageKey === "announcements" && !routeAccessRedirect && <AnnouncementManagementPage api={api} session={session} ui={employeeUi} />}
            {pageKey === "employees" && !routeAccessRedirect && <EmployeesPage api={api} session={session} onSessionRefresh={refreshSession} ui={employeeUi} />}
            {pageKey === "time" && !routeAccessRedirect && <TimeAttendancePage api={api} ui={employeeUi} />}
            {pageKey === "payroll" && !routeAccessRedirect && <PayrollPage api={api} ui={employeeUi} />}
            {pageKey === "employee-portal" && !routeAccessRedirect && <EmployeePortalPage api={api} session={session} pageKey={["my-pay", "announcements", "messages"].includes(routeParts[1]) ? routeParts[1] : "time-clock"} ui={employeeUi} />}
            {pageKey === "invoices" && <InvoicesPage api={api} session={session} />}
            {pageKey === "payments" && <PaymentsPage api={api} session={session} />}
            {pageKey === "settings" && <SettingsPage api={api} session={session} onSession={setSession} />}
            {pageKey === "backup" && <BackupRestorePanel api={api} session={session} />}
            {pageKey === "home" && <HomePage api={api} />}
            {routeUnavailable && <NotFoundPage />}
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

export default App;
