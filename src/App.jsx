import { ShieldCheck } from "lucide-react";
import { enabledNavigationItems, enabledRibbonActions, VERSION_1_NAVIGATION } from "./navigation.js";

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
            <span>Version 1 Part 1</span>
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
            <p>Independent Slim Boundary</p>
            <h1>Version 1 Shell Foundation</h1>
          </div>
          <span className="status-pill">
            <ShieldCheck size={16} aria-hidden="true" />
            MVP reference read-only
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
            <span className="ribbon-empty">Feature actions appear only after the owning page is complete.</span>
          )}
        </div>

        <section className="content-grid">
          <article className="panel">
            <h2>Part 1 Status</h2>
            <p>
              This shell proves the independent application boundary and only renders complete Part 1 surfaces.
              Unfinished Version 1 workflows are registered for planning but are not shown as empty pages.
            </p>
          </article>
          <article className="panel">
            <h2>Allowed Version 1 Navigation</h2>
            <ul>
              {VERSION_1_NAVIGATION.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <strong>{item.availableInPart1 ? "active" : "planned"}</strong>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}

export default App;
