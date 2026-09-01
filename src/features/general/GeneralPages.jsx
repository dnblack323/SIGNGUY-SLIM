import {
  useEffect,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calculator,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  Delete,
  DollarSign,
  FileText,
  Filter,
  Inbox,
  Mail,
  MessageSquare,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  ShoppingBag,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { cents } from "../../api.js";
import {
  PRODUCTION_STAGES,
  STAGE_LABELS,
} from "../production/productionState.js";

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

const BACKUP_PREVIEW_GROUPS = [
  {
    title: "System & Tenant",
    items: [
      ["tenants", "Tenants"],
      ["users", "Users"],
      ["tenant_sequences", "Numbering sequences"],
      ["audit_events", "Audit events"],
    ],
  },
  {
    title: "Shop Records",
    items: [
      ["customers", "Customers"],
      ["estimates", "Quotes"],
      ["estimate_items", "Quote items"],
      ["orders", "Orders"],
      ["order_items", "Order items"],
      ["invoices", "Invoices"],
    ],
  },
  {
    title: "Production & Scheduling",
    items: [
      ["calendar_events", "Calendar events"],
      ["reminders", "Reminders"],
      ["notes", "Notes"],
      ["work_orders", "Work Orders"],
      ["work_order_items", "Work Order items"],
      ["commercial_bundles", "Commercial bundles"],
      ["commercial_bundle_items", "Commercial bundle items"],
    ],
  },
  {
    title: "Customer Communications & Intake",
    items: [
      ["outbound_email_sends", "Outbound emails"],
      ["customer_communications", "Customer communications"],
      ["sendgrid_events", "SendGrid events"],
      ["tenant_intake_addresses", "Intake addresses"],
      ["intake_source_messages", "Intake source messages"],
      ["order_intake_items", "Incoming request items"],
      ["intake_attachments", "Intake attachments"],
    ],
  },
  {
    title: "Employees, Time & Pay",
    items: [
      ["employees", "Employees"],
      ["employee_rates", "Employee rates"],
      ["employee_time_entries", "Time entries"],
      ["employee_pay_weeks", "Pay weeks"],
      ["employee_pay_advances", "Advances"],
      ["employee_pay_adjustments", "Adjustments"],
      ["employee_pay_manual_payments", "Manual payments"],
    ],
  },
  {
    title: "Messages & Announcements",
    items: [
      ["employee_announcements", "Employee announcements"],
      ["employee_announcement_reads", "Announcement read states"],
      ["employee_direct_messages", "Employee direct messages"],
    ],
  },
  {
    title: "Files",
    items: [["attachments", "Order attachments"]],
  },
];

function backupPreviewGroups(counts = {}) {
  return BACKUP_PREVIEW_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter(([key]) => Object.prototype.hasOwnProperty.call(counts, key)),
    }))
    .filter((group) => group.items.length);
}

function centsToDollars(value) {
  return ((value || 0) / 100).toFixed(2);
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


const DEFAULT_ORDER_FILTERS = {
  search: "",
  status: "all",
  production_stage: "all",
  date_from: "",
  date_to: "",
  sort: "order_number_desc",
};

function NotFoundPage() {
  return (
    <section className="panel">
      <Toolbar title="Page Not Available" />
      <div className="empty-state">This destination is not available in Slim.</div>
    </section>
  );
}

function RibbonGroup({ label, children }) {
  return (
    <div className="ribbon-group" aria-label={label}>
      <div className="ribbon-group-actions">{children}</div>
    </div>
  );
}

function ContextualRibbon({ pageKey, routeParts, capabilities, ordersFilters, setOrdersFilters, filtersOpen, setFiltersOpen, workspaceActions, onCalculator }) {
  const isOrdersList = pageKey === "orders" && !routeParts[1];
  const isIncomingRequests = pageKey === "orders" && ["incoming", "intake"].includes(routeParts[1]);
  const isNewOrder = pageKey === "orders" && routeParts[1] === "new";
  const isOrderWorkspace = pageKey === "orders" && routeParts[1] && !["new", "incoming", "intake"].includes(routeParts[1]);

  if (isOrdersList || isIncomingRequests) {
    return (
      <div className="ribbon office-ribbon orders-list-ribbon" aria-label={isIncomingRequests ? "Incoming Requests ribbon" : "Orders list ribbon"}>
        <RibbonGroup label="Create">
          <a href="#/orders/new" className="ribbon-button"><Plus size={18} /><span>New Order</span></a>
        </RibbonGroup>
        <RibbonGroup label="View">
          <a href={isIncomingRequests ? "#/orders" : "#/orders/incoming"} className="ribbon-button"><Inbox size={18} /><span>{isIncomingRequests ? "Orders" : "Incoming Requests"}</span></a>
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
    return <div className="ribbon contextual-ribbon" aria-label="Quotes ribbon"><a href="#/estimates" className="ribbon-button"><FileText size={18} /><span>New Quote</span></a><button type="button" className="ribbon-button" onClick={onCalculator}><Calculator size={18} /><span>Calculator</span></button></div>;
  }
  if (pageKey === "production") {
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
    return <div className="ribbon contextual-ribbon" aria-label="Employees ribbon"><a href="#/time" className="ribbon-button"><Clock size={18} /><span>Time</span></a>{capabilities.can_manage_pay && <a href="#/payroll" className="ribbon-button"><DollarSign size={18} /><span>Payroll</span></a>}</div>;
  }
  if (pageKey === "time") {
    return <div className="ribbon contextual-ribbon" aria-label="Time ribbon"><a href="#/employees" className="ribbon-button"><Users size={18} /><span>Employees</span></a>{capabilities.can_use_employee_portal && <a href="#/employee-portal/time-clock" className="ribbon-button"><Clock size={18} /><span>Portal</span></a>}</div>;
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
  if (pageKey === "payments") {
    return <div className="ribbon contextual-ribbon" aria-label="Payments ribbon"><a href="#/invoices" className="ribbon-button"><ReceiptText size={18} /><span>Invoices</span></a></div>;
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
    production_state_source: entry.production_state_source || "pre_release",
    current_work_order_id: entry.current_work_order_id || null,
    current_work_order_number: entry.current_work_order_number || null,
    current_work_order_title: entry.current_work_order_title || null,
    due_date: entry.due_date || "",
    assigned_user_id: entry.assigned_user_id || "",
    internal_note: entry.internal_note || "",
  });
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

export {
  blankAddress,
  blankItem,
  INTAKE_STATUS_LABELS,
  IMAGE_ATTACHMENT_TYPES,
  ANNOTATION_COLORS,
  ANNOTATION_WIDTHS,
  BACKUP_PREVIEW_GROUPS,
  backupPreviewGroups,
  centsToDollars,
  isImageAttachment,
  safeAttachmentStem,
  timestampSlug,
  normalizePointer,
  pointToCanvas,
  drawArrowHead,
  drawAnnotationOperation,
  CALENDAR_STATUSES,
  LINKED_RECORD_TYPES,
  dateOnly,
  addDays,
  monthStart,
  monthEndExclusive,
  weekStart,
  formatDate,
  formatEventTime,
  compactMonthEventTime,
  clientSideId,
  newQuickItem,
  Field,
  SelectField,
  DEFAULT_ORDER_FILTERS,
  NotFoundPage,
  RibbonGroup,
  ContextualRibbon,
  OrdersFilterBar,
  formatProgress,
  itemFromApi,
  AddressFields,
  useLoad,
  Toolbar,
  TwoColumn,
  AsyncState,
  RecordList,
  DocumentForm,
  QuickEntry,
  documentPayload,
  CalculatorModal,
};
