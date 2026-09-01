import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Plus,
  RotateCcw,
  Save,
  XCircle,
} from "lucide-react";
import {
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
  Field,
  SelectField,
  useLoad,
} from "../general/GeneralPages.jsx";

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
            <SelectField label="Linked Quote" value={form.estimate_id} onChange={(estimate_id) => setForm({ ...form, estimate_id })}>
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

export {
  CalendarPage,
};
