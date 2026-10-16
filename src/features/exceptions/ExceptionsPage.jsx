import { useEffect, useState } from "react";
import { AlertTriangle, Clock, DollarSign, Factory, PenSquare } from "lucide-react";

function formatMinutes(minutes) {
  if (!minutes && minutes !== 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export default function ExceptionsPage({ api, Toolbar }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [fixes, setFixes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewNote, setReviewNote] = useState("");

  async function load() {
    setState({ loading: true, error: "", data: null });
    try {
      const [summary, punchFixes] = await Promise.all([
        api.get("/exceptions/summary"),
        api.get("/punch-fix-requests?status=pending").catch(() => ({ items: [] })),
      ]);
      setState({ loading: false, error: "", data: summary });
      setFixes(punchFixes.items || []);
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }
  useEffect(() => { load(); }, []);

  function openReview(req, approve) {
    setReviewTarget({ req, approve });
    setReviewNote("");
  }

  async function review(event) {
    event.preventDefault();
    if (!reviewTarget) return;
    setBusy(true);
    try {
      await api.post(`/punch-fix-requests/${reviewTarget.req.id}/review`, {
        approve: reviewTarget.approve,
        review_note: reviewNote.trim() || null,
      });
      setReviewTarget(null);
      setReviewNote("");
      await load();
    } finally { setBusy(false); }
  }

  if (state.loading) return <div className="loading-state">Loading exceptions…</div>;
  if (state.error) return <div className="error-state">{state.error} <button onClick={load}>Retry</button></div>;

  const data = state.data;
  const total = data.counts.total + fixes.length;

  return (
    <section className="panel exceptions-page">
      <Toolbar title={`Exceptions ${total ? `· ${total} to review` : "· All clear"}`}>
        <button type="button" onClick={load} data-testid="exceptions-refresh">Refresh</button>
      </Toolbar>
      <div className="exceptions-counts">
        <span className={data.counts.open_shifts_too_long ? "warn" : "ok"} data-testid="count-open-shifts">
          <Clock size={14} /> Long open shifts <strong>{data.counts.open_shifts_too_long}</strong>
        </span>
        <span className={data.counts.over_budget_work_orders ? "warn" : "ok"} data-testid="count-over-budget">
          <Factory size={14} /> Over-budget WOs <strong>{data.counts.over_budget_work_orders}</strong>
        </span>
        <span className={data.counts.low_direct_labor_employees ? "warn" : "ok"} data-testid="count-low-dl">
          <AlertTriangle size={14} /> Low direct labor <strong>{data.counts.low_direct_labor_employees}</strong>
        </span>
        <span className={data.counts.outstanding_loans ? "warn" : "ok"} data-testid="count-loans">
          <DollarSign size={14} /> Outstanding loans <strong>{data.counts.outstanding_loans}</strong>
        </span>
        <span className={fixes.length ? "warn" : "ok"} data-testid="count-punch-fixes">
          <PenSquare size={14} /> Punch fix requests <strong>{fixes.length}</strong>
        </span>
      </div>

      <ExceptionSection
        title={`Long-running open shifts (> ${Math.round(data.thresholds.implausible_open_shift_minutes / 60)}h)`}
        empty="No implausibly long open shifts."
        rows={data.open_shifts_too_long}
        testid="section-open-shifts"
        render={(row) => (
          <>
            <strong>{row.employee_name}</strong>
            <span>{row.employee_number} · in for {formatMinutes(row.elapsed_minutes)}</span>
            <span className="muted-copy">Since {row.clock_in_at}</span>
          </>
        )}
      />

      <ExceptionSection
        title="Work orders over budget"
        empty="No work orders over budget."
        rows={data.over_budget_work_orders}
        testid="section-over-budget"
        render={(row) => (
          <>
            <strong>{row.work_order_number} · {row.customer_name}</strong>
            <span>{row.order_number} · {row.department_stage}</span>
            <span>Actual {formatMinutes(row.actual_minutes)} / Budget {formatMinutes(row.budget_minutes)} · <b>+{row.overage_percent}%</b></span>
          </>
        )}
      />

      <ExceptionSection
        title={`Low direct labor (< ${data.thresholds.low_direct_labor_percent}% over last ${data.thresholds.direct_labor_window_days}d)`}
        empty="Direct labor tracking looks healthy."
        rows={data.low_direct_labor_employees}
        testid="section-low-dl"
        render={(row) => (
          <>
            <strong>{row.employee_name} · {row.direct_labor_percent}%</strong>
            <span>{row.employee_number} · Shift {formatMinutes(row.shift_minutes)} · Billable {formatMinutes(row.billable_minutes)} · Untracked {formatMinutes(row.untracked_minutes)}</span>
          </>
        )}
      />

      <ExceptionSection
        title="Outstanding loans"
        empty="No outstanding loans."
        rows={data.outstanding_loans}
        testid="section-loans"
        render={(row) => (
          <>
            <strong>{row.employee_name} · {money(row.balance_cents)} balance</strong>
            <span>{row.employee_number} · principal {money(row.principal_cents)} · {row.deduction_mode === "installment" ? `${money(row.installment_cents)}/wk` : "lump sum"}</span>
            {!row.employee_active && <span className="error-state">Employee INACTIVE — collection risk</span>}
          </>
        )}
      />

      <section className="exceptions-section" data-testid="section-punch-fixes">
        <h3>Pending punch fix requests</h3>
        {fixes.length === 0 ? (
          <div className="empty-state">No pending punch fix requests.</div>
        ) : (
          <div className="record-list">
            {fixes.map((req) => (
              <article className="record-row stacked-row" key={req.id} data-testid={`punch-fix-review-row-${req.id}`}>
                <div>
                  <strong>{req.employee_name} · {req.employee_number}</strong>
                  <span>{req.reason}</span>
                  {req.requested_clock_in_at && <span>Clock in → {req.requested_clock_in_at}</span>}
                  {req.requested_clock_out_at && <span>Clock out → {req.requested_clock_out_at}</span>}
                  <span className="muted-copy">Submitted {req.created_at}</span>
                </div>
                <div className="row-actions">
                  <button type="button" disabled={busy} onClick={() => openReview(req, true)} data-testid={`punch-fix-approve-${req.id}`}>Approve</button>
                  <button type="button" disabled={busy} onClick={() => openReview(req, false)} data-testid={`punch-fix-deny-${req.id}`}>Deny</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {reviewTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setReviewTarget(null)}>
          <form className="calendar-modal form-grid" onSubmit={review} onClick={(event) => event.stopPropagation()} data-testid="punch-fix-review-dialog">
            <h3>{reviewTarget.approve ? "Approve punch fix" : "Deny punch fix"}</h3>
            <p className="muted-copy">{reviewTarget.req.employee_name} · {reviewTarget.req.reason}</p>
            <label>
              {reviewTarget.approve ? "Approval note" : "Denial reason"}
              <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} data-testid="punch-fix-review-note" />
            </label>
            <div className="row-actions">
              <button type="button" onClick={() => setReviewTarget(null)} disabled={busy}>Cancel</button>
              <button type="submit" disabled={busy} data-testid="punch-fix-review-submit">
                {busy ? "Saving…" : reviewTarget.approve ? "Approve" : "Deny"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function ExceptionSection({ title, empty, rows, render, testid }) {
  return (
    <section className="exceptions-section" data-testid={testid}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <div className="record-list">
          {rows.map((row, i) => (
            <article className="record-row stacked-row" key={row.id || row.work_order_id || row.loan_id || row.employee_id || i}>
              <div>{render(row)}</div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
