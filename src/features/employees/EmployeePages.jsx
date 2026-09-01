import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, DollarSign, Megaphone, Send, UserPlus } from "lucide-react";
import { money } from "../../api.js";
import {
  announcementDisplayStatus,
  centsToDollars,
  dateTimeInputToIso,
  DEFAULT_TIMEZONE,
  dollarsToCents,
  localDateTimeInput,
  minutesLabel,
  todayInput,
} from "./employeeFormatters.js";

export function EmployeesPage({ api, session, onSessionRefresh, ui }) {
  const { AsyncState, Field, SelectField, Toolbar, TwoColumn, useLoad } = ui;
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
      await onSessionRefresh?.();
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
      await onSessionRefresh?.();
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

export function TimeAttendancePage({ api, ui }) {
  const { Field, Toolbar, TwoColumn, useLoad } = ui;
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

export function PayrollPage({ api, ui }) {
  const { Field, SelectField, Toolbar, TwoColumn, useLoad } = ui;
  const [employeeId, setEmployeeId] = useState("");
  const [weekStart, setWeekStart] = useState(todayInput());
  const [detail, setDetail] = useState(null);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });
  const state = useLoad(async () => {
    const employees = await api.get("/payroll/employees");
    const selected = employeeId || employees.items?.[0]?.id || "";
    return { employees: employees.items || [], selected };
  }, [employeeId]);
  const selectedEmployee = employeeId || state.data?.selected || "";
  const [advance, setAdvance] = useState({ amount: "", note: "", advance_date: todayInput() });
  const [adjustment, setAdjustment] = useState({ amount: "", direction: "positive", reason: "" });
  const [payment, setPayment] = useState({ amount: "", payment_date: todayInput(), method: "", reference: "", note: "" });

  const loadDetail = useCallback(async (employee = selectedEmployee, week = weekStart) => {
    if (!employee) return;
    try {
      setDetail(await api.get(`/payroll/employees/${employee}/weeks/${week}`));
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }, [api, selectedEmployee, weekStart]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

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

export function AnnouncementManagementPage({ api, session, ui }) {
  const { AsyncState, Field, SelectField, Toolbar, TwoColumn, useLoad } = ui;
  const state = useLoad(() => api.get("/announcements"), []);
  const timeZone = session?.tenant?.shop_timezone || DEFAULT_TIMEZONE;
  const blank = useMemo(() => ({ title: "", body: "", publish_at: localDateTimeInput(undefined, timeZone), expires_at: "", audience_role: "all" }), [timeZone]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState("");
  const [action, setAction] = useState({ busy: false, error: "" });
  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      publish_at: localDateTimeInput(item.publish_at, timeZone),
      expires_at: item.expires_at ? localDateTimeInput(item.expires_at, timeZone) : "",
      audience_role: item.audience_role || "all",
    });
  }
  async function save(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    const payload = {
      ...form,
      publish_at: dateTimeInputToIso(form.publish_at, timeZone),
      expires_at: form.expires_at ? dateTimeInputToIso(form.expires_at, timeZone) : null,
    };
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
                  <span>{item.audience_role === "all" ? "All employees" : item.audience_role} / {announcementDisplayStatus(item)}</span>
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

function PortalAnnouncementsPage({ api, session, ui }) {
  const { AsyncState, Toolbar, TwoColumn, useLoad } = ui;
  const timeZone = session?.tenant?.shop_timezone || DEFAULT_TIMEZONE;
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
                <span>{localDateTimeInput(item.publish_at, timeZone).replace("T", " ")}</span>
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

function PortalMessagesPage({ api, session, ui }) {
  const { AsyncState, SelectField, Toolbar, TwoColumn, useLoad } = ui;
  const timeZone = session?.tenant?.shop_timezone || DEFAULT_TIMEZONE;
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
  async function changeRecipient(userId) {
    setRecipientId(userId);
    setThread(null);
    if (userId) await openConversation(userId);
  }
  async function sendMessage(event) {
    event.preventDefault();
    const targetRecipientId = thread?.participant?.user_id || recipientId;
    setAction({ busy: true, error: "" });
    try {
      await api.post("/employee-portal/messages", { recipient_user_id: targetRecipientId, body });
      setBody("");
      await conversations.refresh();
      await openConversation(targetRecipientId);
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }
  const selectedMessages = thread?.messages || [];
  const composerRecipientId = thread?.participant?.user_id || recipientId;
  const participantOptions = participants.data?.items || [];
  const participantsUnavailable = Boolean(participants.loading || participants.error);
  const selectedRecipientAvailable = participantOptions.some((item) => item.user_id === composerRecipientId);
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
        <Toolbar title={thread?.participant?.display_name || "Conversation"}>
          {thread && <button type="button" onClick={() => { setThread(null); setRecipientId(participantOptions[0]?.user_id || ""); }}>New Message</button>}
        </Toolbar>
        <div className="portal-thread">
          {selectedMessages.length ? selectedMessages.map((message) => (
            <article className={`portal-bubble ${message.direction}`} key={message.id}>
              <strong>{message.direction === "sent" ? "You" : message.sender_name}</strong>
              <p>{message.body}</p>
              <span>{localDateTimeInput(message.sent_at, timeZone).replace("T", " ")}{message.direction === "sent" && message.recipient_read_at ? " / Read" : ""}</span>
            </article>
          )) : <div className="empty-state">Select or start a conversation</div>}
        </div>
        <form className="form-grid" onSubmit={sendMessage}>
          {participants.loading && <div className="loading-state">Loading recipients</div>}
          {participants.error && <div className="error-state">Recipients unavailable: {participants.error} <button type="button" onClick={participants.refresh}>Retry</button></div>}
          {!participantsUnavailable && selectedRecipientAvailable && <SelectField label="To" value={composerRecipientId} onChange={changeRecipient}>
            {participantOptions.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}
          </SelectField>}
          {!participantsUnavailable && composerRecipientId && !selectedRecipientAvailable && <div className="notice">Recipient unavailable for new messages.</div>}
          <label className="field"><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <button className="primary-button" disabled={action.busy || participantsUnavailable || !composerRecipientId || !selectedRecipientAvailable || !body.trim()}><Send size={16} />Send Message</button>
        </form>
      </section>
    </TwoColumn>
  );
}

export function EmployeePortalPage({ api, session, pageKey, ui }) {
  if (pageKey === "announcements") return <PortalAnnouncementsPage api={api} session={session} ui={ui} />;
  if (pageKey === "messages") return <PortalMessagesPage api={api} session={session} ui={ui} />;
  return <EmployeePortalTimePayPage api={api} pageKey={pageKey} ui={ui} />;
}

function EmployeePortalTimePayPage({ api, pageKey, ui }) {
  const { AsyncState, Field, Toolbar, useLoad } = ui;
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
