import { useEffect, useState } from "react";
import { CalendarDays, Pause, Play, Users } from "lucide-react";
import { DEPARTMENT_STAGES, DEPARTMENT_STAGE_LABELS } from "./productionState.js";

function formatMinutes(minutes) {
  if (!minutes && minutes !== 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function AvatarChip({ initials }) {
  return <span className="kanban-avatar" title={initials} aria-label={`Worker ${initials}`}>{initials}</span>;
}

function BudgetBar({ actual, budget }) {
  if (!budget) return <span className="kanban-budget-empty">No budget set</span>;
  const pct = Math.min(100, Math.round((actual / budget) * 100));
  const over = actual > budget;
  return (
    <div className={over ? "kanban-budget over" : "kanban-budget"}>
      <div className="kanban-budget-bar"><div className="kanban-budget-fill" style={{ width: `${pct}%` }} /></div>
      <span className="kanban-budget-label">{formatMinutes(actual)} / {formatMinutes(budget)} {over && "· OVER"}</span>
    </div>
  );
}

export default function ProductionPage({ api, Toolbar, ScheduleFromWorkspaceModal }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [action, setAction] = useState({ busy: false, error: "" });
  const [budgetTarget, setBudgetTarget] = useState(null);
  const [holdTarget, setHoldTarget] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);

  async function load() {
    try {
      const data = await api.get(`/production/kanban`);
      setState({ loading: false, error: "", data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }

  useEffect(() => { load(); }, []);
  // Auto refresh every 20s to keep active workers/budget live
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  async function move(card, stage) {
    if (card.department_stage === stage) return;
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/work-orders/${card.id}/department-stage`, { department_stage: stage });
      await load();
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }

  async function toggleHold(card, reason = null) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/work-orders/${card.id}/hold`, { on_hold: !card.on_hold, reason });
      await load();
      setHoldTarget(null);
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }

  async function saveBudget(card, minutes) {
    setAction({ busy: true, error: "" });
    try {
      await api.post(`/production/work-orders/${card.id}/budget`, { minutes });
      await load();
      setBudgetTarget(null);
      setAction({ busy: false, error: "" });
    } catch (err) {
      setAction({ busy: false, error: err.message });
    }
  }

  if (state.loading) return <div className="loading-state">Loading Kanban…</div>;
  if (state.error) return <div className="error-state">{state.error}<button onClick={load}>Retry</button></div>;

  const cards = state.data?.cards || [];
  const stages = state.data?.stages || DEPARTMENT_STAGES;

  return (
    <section className="panel production-page">
      <Toolbar title="Production · 7-Stage Board">
        <button type="button" data-testid="kiosk-mode-button" onClick={() => {
          localStorage.setItem("signguy_slim_kiosk_mode", "1");
          window.location.hash = "";
          window.location.pathname = "/kiosk";
        }}>Enter Kiosk Mode</button>
        <button type="button" onClick={load} disabled={action.busy}>Refresh</button>
      </Toolbar>
      {action.error && <div className="error-state" role="alert">{action.error}</div>}
      <div className="kanban-board" data-testid="kanban-board">
        {stages.map((stage) => {
          const columnCards = cards.filter((c) => c.department_stage === stage);
          return (
            <section
              className="kanban-column"
              key={stage}
              data-testid={`kanban-column-${stage}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const id = event.dataTransfer.getData("text/plain");
                const card = cards.find((c) => c.id === id);
                if (card) move(card, stage);
              }}
            >
              <header>
                <h3>{DEPARTMENT_STAGE_LABELS[stage] || stage}</h3>
                <span className="kanban-column-count">{columnCards.length}</span>
              </header>
              <div className="kanban-column-body">
                {columnCards.map((card) => (
                  <article
                    className={`kanban-card ${card.late ? "late" : ""} ${card.on_hold ? "hold" : ""}`}
                    key={card.id}
                    draggable
                    data-testid={`kanban-card-${card.id}`}
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", card.id)}
                  >
                    <div className="kanban-card-head">
                      <strong>{card.work_order_number}</strong>
                      <span className="kanban-order">{card.order_number}</span>
                    </div>
                    <div className="kanban-card-title">{card.title || card.order_title}</div>
                    <div className="kanban-card-meta">{card.customer_name}</div>
                    <div className="kanban-card-meta">Due: {card.due_date || "—"} {card.late && <em>Late</em>}</div>
                    {card.on_hold && (
                      <div className="kanban-hold-badge" title={card.on_hold_reason || ""}>ON HOLD{card.on_hold_reason ? `: ${card.on_hold_reason}` : ""}</div>
                    )}
                    {card.active_workers?.length > 0 && (
                      <div className="kanban-workers"><Users size={12} />
                        {card.active_workers.map((w) => <AvatarChip key={w.employee_id} initials={w.initials} />)}
                      </div>
                    )}
                    <BudgetBar actual={card.actual_minutes || 0} budget={card.budget_minutes || 0} />
                    <div className="kanban-card-actions">
                      <select
                        aria-label={`Move ${card.work_order_number}`}
                        value={card.department_stage}
                        disabled={action.busy}
                        onChange={(event) => move(card, event.target.value)}
                        data-testid={`kanban-stage-select-${card.id}`}
                      >
                        {stages.map((s) => <option value={s} key={s}>{DEPARTMENT_STAGE_LABELS[s] || s}</option>)}
                      </select>
                      <button type="button" onClick={() => setBudgetTarget(card)} disabled={action.busy}>Budget</button>
                      <button type="button" onClick={() => card.on_hold ? toggleHold(card, null) : setHoldTarget(card)} disabled={action.busy} data-testid={`kanban-hold-${card.id}`}>
                        {card.on_hold ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Hold</>}
                      </button>
                      <button type="button" onClick={() => setScheduleTarget({ type: "work_order", order: { id: card.order_id, due_date: card.due_date, title: card.order_title, order_number: card.order_number }, work_order: card })}><CalendarDays size={12} /> Schedule</button>
                      <a href={`#/orders/${card.order_id}/from-production/${card.id}`} data-focus-target={`production-open-order-${card.id}`}>Open</a>
                    </div>
                  </article>
                ))}
                {columnCards.length === 0 && <div className="kanban-empty">No jobs</div>}
              </div>
            </section>
          );
        })}
      </div>
      {budgetTarget && (
        <BudgetModal card={budgetTarget} onClose={() => setBudgetTarget(null)} onSave={saveBudget} />
      )}
      {holdTarget && (
        <HoldModal card={holdTarget} onClose={() => setHoldTarget(null)} onConfirm={toggleHold} />
      )}
      {scheduleTarget && <ScheduleFromWorkspaceModal api={api} target={scheduleTarget} users={state.data?.users || []} onClose={() => setScheduleTarget(null)} />}
    </section>
  );
}

function BudgetModal({ card, onClose, onSave }) {
  const [value, setValue] = useState(card.budget_minutes || "");
  return (
    <div className="modal-backdrop">
      <section className="calendar-modal form-grid" role="dialog" aria-modal="true" aria-label="Set budget minutes">
        <h3>Budget · {card.work_order_number}</h3>
        <label>Budget (minutes)
          <input data-testid="budget-input" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="row-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" data-testid="budget-save" onClick={() => onSave(card, Number(value) || 0)}>Save</button>
        </div>
      </section>
    </div>
  );
}

function HoldModal({ card, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-backdrop">
      <section className="calendar-modal form-grid" role="dialog" aria-modal="true" aria-label="Place work order on hold">
        <h3>Place on Hold · {card.work_order_number}</h3>
        <label>Reason (optional)
          <input data-testid="hold-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Waiting on customer approval, out of stock…" />
        </label>
        <div className="row-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" data-testid="hold-confirm" onClick={() => onConfirm(card, reason.trim() || null)}>Confirm hold</button>
        </div>
      </section>
    </div>
  );
}
