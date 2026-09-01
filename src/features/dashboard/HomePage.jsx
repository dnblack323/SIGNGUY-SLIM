import {
  formatDate,
  useLoad,
  Toolbar,
  AsyncState,
} from "../general/GeneralPages.jsx";

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

export {
  HomePage,
};
