import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api.js";
import { DEPARTMENT_STAGES, DEPARTMENT_STAGE_LABELS } from "../production/productionState.js";

function formatMinutes(minutes) {
  if (!minutes && minutes !== 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

async function readCsrf() {
  try {
    const me = await apiRequest("/auth/me");
    return { session: me, csrf: me.csrf_token };
  } catch {
    return { session: null, csrf: "" };
  }
}

export default function KioskApp() {
  const [boot, setBoot] = useState({ loading: true, session: null, csrf: "", error: "" });
  const [context, setContext] = useState(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeState, setEmployeeState] = useState(null);
  const [screen, setScreen] = useState("pin"); // pin, menu, job-picker
  const idleTimer = useRef(null);
  const currentPin = useRef("");

  async function loadBoot() {
    setBoot((s) => ({ ...s, loading: true, error: "" }));
    try {
      const { session, csrf } = await readCsrf();
      if (!session) {
        setBoot({ loading: false, session: null, csrf: "", error: "Not signed in. Please log in on this tablet first." });
        return;
      }
      const ctx = await apiRequest("/kiosk/context");
      setContext(ctx);
      setBoot({ loading: false, session, csrf, error: "" });
    } catch (err) {
      setBoot({ loading: false, session: null, csrf: "", error: err.message || "Failed to load kiosk" });
    }
  }

  useEffect(() => { loadBoot(); }, []);

  // Auto-lock: return to PIN pad after 60s inactivity
  useEffect(() => {
    function resetIdle() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (screen === "pin") return;
      idleTimer.current = setTimeout(() => {
        setEmployeeState(null);
        setPin("");
        currentPin.current = "";
        setScreen("pin");
      }, 60000);
    }
    resetIdle();
    window.addEventListener("mousedown", resetIdle);
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("touchstart", resetIdle);
    return () => {
      window.removeEventListener("mousedown", resetIdle);
      window.removeEventListener("keydown", resetIdle);
      window.removeEventListener("touchstart", resetIdle);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [screen]);

  async function kioskCall(path, body) {
    setBusy(true);
    try {
      const res = await apiRequest(path, { method: "POST", body, csrfToken: boot.csrf });
      setBusy(false);
      return res;
    } catch (err) {
      setBusy(false);
      throw err;
    }
  }

  async function submitPin() {
    if (!/^\d{4,6}$/.test(pin)) { setPinError("PIN must be 4–6 digits"); return; }
    setPinError("");
    try {
      const state = await kioskCall("/kiosk/pin-verify", { pin });
      currentPin.current = pin;
      setEmployeeState(state);
      setScreen("menu");
      setPin("");
    } catch (err) {
      setPinError(err.status === 401 ? "PIN not recognized" : (err.message || "Error"));
      setPin("");
    }
  }

  function pressKey(key) {
    if (key === "clear") { setPin(""); setPinError(""); return; }
    if (key === "back") { setPin((s) => s.slice(0, -1)); setPinError(""); return; }
    if (key === "enter") { submitPin(); return; }
    if (pin.length < 6) setPin((s) => s + key);
    setPinError("");
  }

  function exitKiosk() {
    localStorage.removeItem("signguy_slim_kiosk_mode");
    window.location.pathname = "/";
    window.location.hash = "#/";
  }

  function backToPinPad() {
    setEmployeeState(null);
    currentPin.current = "";
    setScreen("pin");
  }

  async function doAction(path, extra = {}) {
    try {
      const state = await kioskCall(path, { pin: currentPin.current, ...extra });
      setEmployeeState(state);
      setScreen("menu");
    } catch (err) {
      setPinError(err.message || "Error");
    }
  }

  if (boot.loading) return <div className="kiosk-fullscreen"><div className="kiosk-loading">Loading kiosk…</div></div>;
  if (boot.error) return (
    <div className="kiosk-fullscreen">
      <div className="kiosk-error-panel">
        <h1>Kiosk not ready</h1>
        <p>{boot.error}</p>
        <button data-testid="kiosk-goto-login" onClick={() => { window.location.pathname = "/"; }}>Go to Login</button>
      </div>
    </div>
  );

  return (
    <div className="kiosk-fullscreen" data-testid="kiosk-shell">
      <header className="kiosk-header">
        <div className="kiosk-brand">The Sign Guys <span>Kiosk · {boot.session?.tenant?.slug}</span></div>
        <button className="kiosk-exit" data-testid="kiosk-exit" onClick={exitKiosk}>Exit Kiosk</button>
      </header>
      <main className="kiosk-main">
        {screen === "pin" && (
          <PinPad pin={pin} error={pinError} onKey={pressKey} busy={busy} />
        )}
        {screen === "menu" && employeeState && (
          <EmployeeMenu
            state={employeeState}
            busy={busy}
            onClockIn={() => doAction("/kiosk/clock-in", {})}
            onClockOut={() => doAction("/kiosk/clock-out", {})}
            onBreakStart={() => doAction("/kiosk/break/start", {})}
            onBreakEnd={() => doAction("/kiosk/break/end", {})}
            onEndJob={() => doAction("/kiosk/job/end", {})}
            onPickJob={() => setScreen("job-picker")}
            onDone={backToPinPad}
          />
        )}
        {screen === "job-picker" && employeeState && (
          <JobPicker
            context={context}
            busy={busy}
            onCancel={() => setScreen("menu")}
            onStart={(payload) => doAction("/kiosk/job/start", payload)}
          />
        )}
      </main>
    </div>
  );
}

function PinPad({ pin, error, onKey, busy }) {
  return (
    <section className="kiosk-pinpad" data-testid="kiosk-pinpad">
      <h1>Enter your PIN</h1>
      <div className="kiosk-pin-display" data-testid="kiosk-pin-display">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={i < pin.length ? "kiosk-pin-dot filled" : "kiosk-pin-dot"}>{i < pin.length ? "•" : ""}</span>
        ))}
      </div>
      {error && <div className="kiosk-pin-error" role="alert" data-testid="kiosk-pin-error">{error}</div>}
      <div className="kiosk-pinpad-grid">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button type="button" key={k} className="kiosk-key" onClick={() => onKey(k)} disabled={busy} data-testid={`kiosk-key-${k}`}>{k}</button>
        ))}
        <button type="button" className="kiosk-key secondary" onClick={() => onKey("clear")} disabled={busy} data-testid="kiosk-key-clear">Clear</button>
        <button type="button" className="kiosk-key" onClick={() => onKey("0")} disabled={busy} data-testid="kiosk-key-0">0</button>
        <button type="button" className="kiosk-key secondary" onClick={() => onKey("back")} disabled={busy} data-testid="kiosk-key-back">⌫</button>
      </div>
      <button type="button" className="kiosk-enter" onClick={() => onKey("enter")} disabled={busy || pin.length < 4} data-testid="kiosk-key-enter">Enter</button>
    </section>
  );
}

function EmployeeMenu({ state, busy, onClockIn, onClockOut, onBreakStart, onBreakEnd, onEndJob, onPickJob, onDone }) {
  const clockedIn = !!state.shift;
  const onBreak = !!state.shift?.on_break;
  const activeJob = state.active_job;
  return (
    <section className="kiosk-menu" data-testid="kiosk-menu">
      <div className="kiosk-menu-head">
        <div>
          <h1 data-testid="kiosk-menu-employee">{state.employee.name}</h1>
          <span>{state.employee.employee_number} · {state.employee.role}</span>
        </div>
        <button type="button" onClick={onDone} className="kiosk-secondary" data-testid="kiosk-done">Done</button>
      </div>
      <div className="kiosk-status-grid">
        <div className={`kiosk-status ${clockedIn ? "on" : "off"}`}>
          <span className="kiosk-status-label">Shift</span>
          <strong>{clockedIn ? (onBreak ? "On Break" : "Clocked In") : "Clocked Out"}</strong>
          {clockedIn && <span>Elapsed: {formatMinutes(state.shift.elapsed_minutes)}</span>}
        </div>
        <div className={`kiosk-status ${activeJob ? "on" : "off"}`}>
          <span className="kiosk-status-label">Active Task</span>
          {activeJob ? (
            <>
              <strong>{activeJob.work_order ? `${activeJob.work_order.work_order_number} · ${activeJob.work_order.title}` : (activeJob.non_billable?.label || "Task")}</strong>
              <span>{DEPARTMENT_STAGE_LABELS[activeJob.department_stage] || activeJob.department_stage} · {formatMinutes(activeJob.elapsed_minutes)}</span>
            </>
          ) : <strong>None</strong>}
        </div>
      </div>
      <div className="kiosk-action-grid">
        {!clockedIn && <button type="button" className="kiosk-action primary" disabled={busy} onClick={onClockIn} data-testid="kiosk-clock-in">Clock In</button>}
        {clockedIn && !onBreak && (
          <>
            {!activeJob && <button type="button" className="kiosk-action primary" disabled={busy} onClick={onPickJob} data-testid="kiosk-start-task">Start Task</button>}
            {activeJob && <button type="button" className="kiosk-action warning" disabled={busy} onClick={onEndJob} data-testid="kiosk-end-task">End Task</button>}
            {activeJob && <button type="button" className="kiosk-action" disabled={busy} onClick={onPickJob} data-testid="kiosk-switch-task">Switch Task</button>}
            <button type="button" className="kiosk-action" disabled={busy} onClick={onBreakStart} data-testid="kiosk-break-start">Start Break</button>
            <button type="button" className="kiosk-action danger" disabled={busy} onClick={onClockOut} data-testid="kiosk-clock-out">Clock Out</button>
          </>
        )}
        {clockedIn && onBreak && (
          <>
            <button type="button" className="kiosk-action primary" disabled={busy} onClick={onBreakEnd} data-testid="kiosk-break-end">End Break</button>
            <button type="button" className="kiosk-action danger" disabled={busy} onClick={onClockOut} data-testid="kiosk-clock-out">Clock Out</button>
          </>
        )}
      </div>
    </section>
  );
}

function JobPicker({ context, busy, onCancel, onStart }) {
  const [selected, setSelected] = useState(null); // { type: 'wo'|'nb', id, department_stage? }
  const [stage, setStage] = useState("");

  const workOrders = context?.work_orders || [];
  const nonBillable = context?.non_billable_codes || [];

  function start() {
    if (!selected) return;
    if (selected.type === "wo") {
      onStart({ work_order_id: selected.id, department_stage: stage || selected.department_stage });
    } else {
      onStart({ non_billable_code_id: selected.id, department_stage: stage || "design" });
    }
  }

  return (
    <section className="kiosk-picker" data-testid="kiosk-job-picker">
      <div className="kiosk-picker-head">
        <h1>Pick a task</h1>
        <button type="button" className="kiosk-secondary" onClick={onCancel} data-testid="kiosk-picker-cancel">Cancel</button>
      </div>
      <div className="kiosk-picker-scroll">
        <h2>Work Orders</h2>
        <div className="kiosk-picker-grid">
          {workOrders.length === 0 && <div className="kiosk-empty">No open work orders</div>}
          {workOrders.map((wo) => (
            <button
              type="button"
              key={wo.id}
              className={`kiosk-picker-card ${selected?.id === wo.id ? "selected" : ""} ${wo.on_hold ? "hold" : ""}`}
              onClick={() => { setSelected({ type: "wo", id: wo.id, department_stage: wo.department_stage }); setStage(wo.department_stage); }}
              disabled={wo.on_hold}
              data-testid={`kiosk-pick-wo-${wo.id}`}
            >
              <strong>{wo.work_order_number}</strong>
              <span>{wo.customer_name}</span>
              <span className="kiosk-picker-order">{wo.order_number} · {wo.title}</span>
              <span>{DEPARTMENT_STAGE_LABELS[wo.department_stage] || wo.department_stage}</span>
              {wo.on_hold && <em>ON HOLD</em>}
            </button>
          ))}
        </div>
        {nonBillable.length > 0 && (
          <>
            <h2>Non-Billable</h2>
            <div className="kiosk-picker-grid">
              {nonBillable.map((nb) => (
                <button
                  type="button"
                  key={nb.id}
                  className={`kiosk-picker-card ${selected?.id === nb.id ? "selected" : ""}`}
                  onClick={() => { setSelected({ type: "nb", id: nb.id }); setStage("design"); }}
                  data-testid={`kiosk-pick-nb-${nb.id}`}
                >
                  <strong>{nb.label}</strong>
                  <span>{nb.code}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {selected && (
        <div className="kiosk-picker-confirm">
          <label>Department stage
            <select value={stage} onChange={(e) => setStage(e.target.value)} data-testid="kiosk-picker-stage">
              {DEPARTMENT_STAGES.map((s) => <option key={s} value={s}>{DEPARTMENT_STAGE_LABELS[s]}</option>)}
            </select>
          </label>
          <button type="button" className="kiosk-action primary" disabled={busy} onClick={start} data-testid="kiosk-picker-start">Start Task</button>
        </div>
      )}
    </section>
  );
}
