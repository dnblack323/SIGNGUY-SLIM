import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays } from "lucide-react";
import { canMoveProductionRecord, productionStageIndex, PRODUCTION_STAGES, STAGE_LABELS } from "./productionState.js";

export default function ProductionPage({ api, Toolbar, ScheduleFromWorkspaceModal, formatProgress }) {
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
    if (!canMoveProductionRecord(item)) return;
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/work-orders/${item.id}/stage`, { stage });
      await load();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }

  async function setDone(item, completed) {
    if (!canMoveProductionRecord(item)) return;
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/work-orders/${item.id}/completion`, { completed });
      await load();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }

  function shift(item, delta) {
    const next = PRODUCTION_STAGES[productionStageIndex(item.production_stage) + delta];
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
            if (item && canMoveProductionRecord(item)) move(item, stage);
          }}>
            <h3>{STAGE_LABELS[stage]}</h3>
            {items.filter((item) => item.production_stage === stage).map((item) => {
              const movable = canMoveProductionRecord(item);
              return (
                <article className={item.late ? "production-card late" : "production-card"} key={item.id} draggable={movable} onDragStart={(event) => {
                  if (movable) event.dataTransfer.setData("text/plain", item.id);
                }}>
                  <strong>{item.record_type === "work_order" ? item.title : item.title || item.description}</strong>
                  <span>{item.order_number} / {item.customer_name}</span>
                  <p>{item.record_type === "work_order" ? `${item.item_count} included item${item.item_count === 1 ? "" : "s"}` : "Unreleased Order Item"}</p>
                  <span>Due: {item.due_date || "None"} {item.late ? "Late" : ""}</span>
                  <span>{item.assigned_user?.display_name || "Unassigned"}</span>
                  <span>{formatProgress(item.production_progress)}</span>
                  <div className="row-actions">
                    <button type="button" aria-label={`Move ${item.title || item.description} left`} disabled={action.busy || !movable || productionStageIndex(item.production_stage) === 0} onClick={() => shift(item, -1)}><ArrowUp size={14} /></button>
                    <button type="button" aria-label={`Move ${item.title || item.description} right`} disabled={action.busy || !movable || productionStageIndex(item.production_stage) === PRODUCTION_STAGES.length - 1} onClick={() => shift(item, 1)}><ArrowDown size={14} /></button>
                    <select aria-label={`Move ${item.title || item.description} to stage`} value={item.production_stage} disabled={action.busy || !movable} onChange={(event) => move(item, event.target.value)}>
                      {PRODUCTION_STAGES.map((option) => <option value={option} key={option}>{STAGE_LABELS[option]}</option>)}
                    </select>
                    {movable && (item.completed ? <button type="button" onClick={() => setDone(item, false)}>Reopen</button> : <button type="button" onClick={() => setDone(item, true)}>Done</button>)}
                    {!movable && <span className="muted-copy">Release first</span>}
                    {item.record_type === "work_order" && <button type="button" onClick={() => openSummary(item)}>Summary</button>}
                    {item.record_type === "work_order" && <button type="button" onClick={() => setScheduleTarget({ type: "work_order", order: { id: item.order_id, due_date: item.due_date, title: item.order_title, order_number: item.order_number }, work_order: item })}><CalendarDays size={14} />Schedule Work</button>}
                    <button type="button" data-focus-target={`production-open-order-${item.id}`} onClick={() => { window.location.hash = `#/orders/${item.order_id}/from-production/${item.id}`; }}>Open Order</button>
                  </div>
                </article>
              );
            })}
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
          {(summary.scheduled_entries || []).map((entry) => <span key={entry.id}>{entry.display_title || entry.title} / {entry.local_start_date || entry.start_at}</span>)}
        </section>
      </div>}
      {scheduleTarget && <ScheduleFromWorkspaceModal api={api} target={scheduleTarget} users={users} onClose={() => setScheduleTarget(null)} />}
    </section>
  );
}
