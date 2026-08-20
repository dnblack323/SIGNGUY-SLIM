import { CalendarDays, ClipboardList, PackageCheck, ShieldCheck } from "lucide-react";
import { enabledNavigationItems, enabledRibbonActions } from "./navigation.js";

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      SG
    </div>
  );
}

function App() {
  const visibleNav = enabledNavigationItems();
  const ribbonActions = enabledRibbonActions();

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <LogoMark />
          <div>
            <strong>SignGuy Slim</strong>
            <span>Operations</span>
          </div>
        </div>
        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <a href={item.href} className="nav-link" key={item.key}>
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Shop Operations</p>
            <h1>Home</h1>
          </div>
          <span className="status-pill">
            <ShieldCheck size={16} aria-hidden="true" />
            Secure workspace
          </span>
        </header>

        <div className="ribbon" aria-label="Quick access ribbon">
          {ribbonActions.length ? (
            ribbonActions.map((action) => {
              const Icon = action.icon;
              return (
                <a href={`/${action.requiresRoute}`} className="ribbon-button" key={action.key}>
                  <Icon aria-hidden="true" size={18} />
                  <span>{action.label}</span>
                </a>
              );
            })
          ) : (
            <span className="ribbon-empty">Quick actions will appear here when records are available.</span>
          )}
        </div>

        <section className="content-grid" aria-label="Home summary">
          <article className="panel panel-accent">
            <PackageCheck size={22} aria-hidden="true" />
            <h2>Today</h2>
            <p>
              Your shop dashboard will open here with active orders, production work, scheduled items,
              and reminders once those records are connected.
            </p>
          </article>
          <article className="panel panel-accent">
            <CalendarDays size={22} aria-hidden="true" />
            <h2>Schedule</h2>
            <p>
              Calendar and due-date work will stay separate from production completion so scheduled
              events cannot falsely complete shop work.
            </p>
          </article>
          <article className="panel panel-accent">
            <ClipboardList size={22} aria-hidden="true" />
            <h2>Records</h2>
            <p>
              Business records will keep stable portable IDs for backup, restore, and upgrade
              compatibility as connected workflows come online.
            </p>
          </article>
        </section>
      </section>
    </main>
  );
}

export default App;
