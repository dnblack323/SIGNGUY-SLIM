import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Building2,
  ChevronRight,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCog,
} from "lucide-react";
import { PlatformApiError, platformFetch } from "./platformApi.js";
import TenantDetail from "./TenantDetail.jsx";
import QuotaAlerts from "./QuotaAlerts.jsx";
import GlobalAudit from "./GlobalAudit.jsx";

function useSession() {
  const [session, setSession] = useState(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      try {
        const me = await platformFetch("/auth/me");
        if (alive) setSession(me);
      } catch (err) {
        if (err.status === 401) {
          try {
            const dev = await platformFetch("/auth/dev-login", { method: "POST" });
            if (alive) setSession(dev);
          } catch (devErr) {
            if (devErr.status !== 403 && devErr.status !== 503 && alive) {
              setError(devErr.message);
            }
          }
        } else if (alive) {
          setError(err.message);
        }
      } finally {
        if (alive) setChecked(true);
      }
    }
    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

  return { session, setSession, checked, sessionError: error };
}

function LoginScreen({ onSession, initialError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [autoBusy, setAutoBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await platformFetch("/auth/login", { method: "POST", body: { email, password } });
      onSession(session);
    } catch (err) {
      setError(
        err instanceof PlatformApiError && err.status === 401
          ? "Incorrect email or password."
          : err.message || "Login failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function attemptDevLogin() {
    setAutoBusy(true);
    setError("");
    try {
      const session = await platformFetch("/auth/dev-login", { method: "POST" });
      onSession(session);
    } catch (err) {
      const msg =
        err.status === 403
          ? "Auto sign-in is disabled on this server."
          : err.status === 503
            ? "No platform admin is configured on this server."
            : err.message || "Auto sign-in failed.";
      setError(msg);
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <div className="platform-shell platform-auth-shell">
      <form className="platform-card platform-login-card" onSubmit={submit} data-testid="platform-login-form">
        <div className="platform-brand">
          <div className="platform-brand-mark">
            <ShieldCheck size={20} strokeWidth={2.4} />
          </div>
          <div>
            <div className="platform-eyebrow">SignGuy Slim</div>
            <h1 className="platform-title">Platform Creator</h1>
          </div>
        </div>
        <p className="platform-subtitle">Sign in to manage every tenant on this instance.</p>
        <label className="platform-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            data-testid="platform-login-email"
          />
        </label>
        <label className="platform-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            data-testid="platform-login-password"
          />
        </label>
        {error && <div className="platform-error" role="alert" data-testid="platform-login-error">{error}</div>}
        <button type="submit" className="platform-button primary" disabled={busy} data-testid="platform-login-submit">
          {busy ? "Signing in…" : "Enter platform"}
        </button>
        <div className="platform-login-divider"><span>or</span></div>
        <button
          type="button"
          className="platform-button ghost full"
          onClick={attemptDevLogin}
          disabled={autoBusy}
          data-testid="platform-login-dev"
        >
          {autoBusy ? "Signing in…" : "Sign in as Platform Creator (auto)"}
        </button>
        <p className="platform-muted platform-login-hint">
          Auto sign-in works when <code>SIGNGUY_SLIM_PLATFORM_AUTO_LOGIN=1</code> is set.
        </p>
      </form>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function CreateTenantDialog({ csrfToken, onClose, onCreated }) {
  const [form, setForm] = useState({
    tenant_slug: "",
    tenant_name: "",
    owner_name: "",
    owner_email: "",
    owner_password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await platformFetch("/tenants", { method: "POST", body: form, csrfToken });
      onCreated(created);
    } catch (err) {
      setError(err.message || "Could not create tenant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form
        className="platform-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        data-testid="platform-create-tenant-form"
      >
        <div className="platform-modal-header">
          <h2>New tenant</h2>
          <button type="button" className="platform-icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="platform-modal-body">
          <label className="platform-field">
            <span>Shop slug (URL-safe)</span>
            <input
              value={form.tenant_slug}
              onChange={(e) => update("tenant_slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              required
              minLength={2}
              placeholder="acme-signs"
              data-testid="platform-tenant-slug"
            />
          </label>
          <label className="platform-field">
            <span>Company name</span>
            <input
              value={form.tenant_name}
              onChange={(e) => update("tenant_name", e.target.value)}
              required
              placeholder="Acme Signs LLC"
              data-testid="platform-tenant-name"
            />
          </label>
          <label className="platform-field">
            <span>Owner name</span>
            <input
              value={form.owner_name}
              onChange={(e) => update("owner_name", e.target.value)}
              required
              data-testid="platform-owner-name"
            />
          </label>
          <label className="platform-field">
            <span>Owner email</span>
            <input
              type="email"
              value={form.owner_email}
              onChange={(e) => update("owner_email", e.target.value)}
              required
              data-testid="platform-owner-email"
            />
          </label>
          <label className="platform-field">
            <span>Owner password (8+ characters)</span>
            <input
              type="text"
              value={form.owner_password}
              onChange={(e) => update("owner_password", e.target.value)}
              required
              minLength={8}
              data-testid="platform-owner-password"
            />
          </label>
          {error && <div className="platform-error" role="alert">{error}</div>}
        </div>
        <div className="platform-modal-footer">
          <button type="button" className="platform-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="platform-button primary" disabled={busy} data-testid="platform-create-tenant-submit">
            {busy ? "Creating…" : "Create tenant"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SuspendTenantDialog({ tenant, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");

  function submit(event) {
    event.preventDefault();
    onConfirm(tenant, reason.trim() || null);
  }

  return (
    <div className="platform-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <form
        className="platform-modal small"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        data-testid="platform-suspend-dialog"
      >
        <div className="platform-modal-header">
          <h3>Suspend {tenant.company_name}</h3>
          <button type="button" className="platform-icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="platform-modal-body">
          <label className="platform-field">
            <span>Reason</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              data-testid="platform-suspend-reason"
            />
          </label>
        </div>
        <div className="platform-modal-footer">
          <button type="button" className="platform-button ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="platform-button warn" disabled={busy} data-testid="platform-suspend-confirm">
            {busy ? "Suspending…" : "Suspend tenant"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TenantsTable({ tenants, onOpenDetail, onSuspend, onUnsuspend, onDelete, busyId }) {
  if (!tenants.length) {
    return (
      <div className="platform-empty" data-testid="platform-tenants-empty">
        <Building2 size={28} strokeWidth={1.6} />
        <h3>No tenants yet</h3>
        <p>Create your first shop to see it appear here.</p>
      </div>
    );
  }
  return (
    <div className="platform-tenants-grid" data-testid="platform-tenants-grid">
      {tenants.map((tenant) => (
        <article
          className={`platform-tenant-card ${tenant.suspended_at ? "suspended" : ""}`}
          key={tenant.id}
          data-testid={`platform-tenant-card-${tenant.id}`}
          onClick={(e) => {
            // Only open detail when the click didn't originate on a button.
            if (e.target.closest("button")) return;
            onOpenDetail(tenant);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenDetail(tenant);
            }
          }}
        >
          <header className="platform-tenant-head">
            <div>
              <h3 className="platform-tenant-name">{tenant.company_name}</h3>
              <div className="platform-tenant-slug">{tenant.slug}</div>
            </div>
            {tenant.suspended_at ? (
              <span className="platform-badge warn" title={tenant.suspended_reason || ""}>Suspended</span>
            ) : (
              <span className="platform-badge ok">Active</span>
            )}
          </header>
          <dl className="platform-tenant-stats">
            <div>
              <dt>Users</dt>
              <dd>{tenant.active_user_count} <span className="platform-muted">/ {tenant.user_count}</span></dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd>{tenant.order_count}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{formatBytes(tenant.storage_bytes)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(tenant.created_at)}</dd>
            </div>
          </dl>
          <footer className="platform-tenant-actions">
            <button
              type="button"
              className="platform-button small primary"
              onClick={() => onOpenDetail(tenant)}
              data-testid={`platform-open-detail-${tenant.id}`}
            >
              <ChevronRight size={14} /> Open detail
            </button>
            {tenant.suspended_at ? (
              <button
                type="button"
                className="platform-button small"
                onClick={() => onUnsuspend(tenant)}
                disabled={busyId === tenant.id}
                data-testid={`platform-unsuspend-${tenant.id}`}
              >
                <RefreshCw size={14} /> Reactivate
              </button>
            ) : (
              <button
                type="button"
                className="platform-button small warn"
                onClick={() => onSuspend(tenant)}
                disabled={busyId === tenant.id}
                data-testid={`platform-suspend-${tenant.id}`}
              >
                <Ban size={14} /> Suspend
              </button>
            )}
            <button
              type="button"
              className="platform-button small danger"
              onClick={() => onDelete(tenant)}
              disabled={busyId === tenant.id || !tenant.suspended_at}
              title={!tenant.suspended_at ? "Suspend before deleting" : ""}
              data-testid={`platform-delete-${tenant.id}`}
            >
              <Trash2 size={14} /> Delete
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}

function Dashboard({ session, onSession }) {
  const [tenants, setTenants] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [detailTenantId, setDetailTenantId] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [banner, setBanner] = useState("");
  const [view, setView] = useState("tenants");
  const csrf = session.csrf_token;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await platformFetch("/tenants");
        if (alive) setTenants(res.items);
      } catch (err) {
        if (alive) setError(err.message || "Could not load tenants.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  function reload() {
    setReloadTick((t) => t + 1);
  }

  async function logout() {
    try {
      await platformFetch("/auth/logout", { method: "POST", csrfToken: csrf });
    } catch {
      // No-op: clear local session regardless.
    }
    onSession(null);
    window.location.reload();
  }

  async function suspend(tenant, reason) {
    setBusyId(tenant.id);
    setError("");
    try {
      await platformFetch(`/tenants/${tenant.id}/suspend`, {
        method: "POST",
        body: { reason },
        csrfToken: csrf,
      });
      setSuspendTarget(null);
      setBanner(`Suspended ${tenant.company_name}.`);
      reload();
    } catch (err) {
      setError(err.message || "Could not suspend tenant.");
    } finally {
      setBusyId("");
    }
  }

  async function unsuspend(tenant) {
    setBusyId(tenant.id);
    setError("");
    try {
      await platformFetch(`/tenants/${tenant.id}/unsuspend`, { method: "POST", csrfToken: csrf });
      setBanner(`Reactivated ${tenant.company_name}.`);
      reload();
    } catch (err) {
      setError(err.message || "Could not reactivate tenant.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteTenant(tenant) {
    const confirmed = window.prompt(
      `This will permanently delete "${tenant.company_name}" and all its data. This cannot be undone.\n\nType DELETE to confirm.`,
    );
    if (confirmed !== "DELETE") return;
    setBusyId(tenant.id);
    setError("");
    try {
      await platformFetch(`/tenants/${tenant.id}`, {
        method: "DELETE",
        body: { confirmation: "DELETE" },
        csrfToken: csrf,
      });
      setBanner(`Deleted ${tenant.company_name}.`);
      reload();
    } catch (err) {
      setError(err.message || "Could not delete tenant.");
    } finally {
      setBusyId("");
    }
  }

  function handleImpersonated(result) {
    // A tenant session cookie has been set. Take the operator into the shop app.
    window.location.href = `/?impersonating=${encodeURIComponent(result.user.email)}`;
  }

  const stats = useMemo(() => {
    if (!tenants) return null;
    return {
      total: tenants.length,
      active: tenants.filter((t) => !t.suspended_at).length,
      suspended: tenants.filter((t) => t.suspended_at).length,
      storage: tenants.reduce((sum, t) => sum + (t.storage_bytes || 0), 0),
    };
  }, [tenants]);

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <div className="platform-brand">
          <div className="platform-brand-mark">
            <ShieldCheck size={20} strokeWidth={2.4} />
          </div>
          <div>
            <div className="platform-eyebrow">SignGuy Slim</div>
            <div className="platform-brand-title">Platform</div>
          </div>
        </div>
        <nav className="platform-nav">
          <button
            type="button"
            className={`platform-nav-item ${view === "tenants" && !detailTenantId ? "active" : ""}`}
            onClick={() => { setView("tenants"); setDetailTenantId(null); }}
            data-testid="platform-nav-tenants"
          >
            <Building2 size={16} /> Tenants
          </button>
          <button
            type="button"
            className={`platform-nav-item ${view === "activity" ? "active" : ""}`}
            onClick={() => { setView("activity"); setDetailTenantId(null); }}
            data-testid="platform-nav-activity"
          >
            <Activity size={16} /> Activity
          </button>
          <a className="platform-nav-item" href="/" data-testid="platform-goto-app"><UserCog size={16} /> Open shop app</a>
        </nav>
        <div className="platform-sidebar-footer">
          <div className="platform-account">
            <div className="platform-avatar">{(session.admin?.display_name || "?").slice(0, 1)}</div>
            <div className="platform-account-meta">
              <strong>{session.admin?.display_name}</strong>
              <span className="platform-muted">{session.admin?.email}</span>
            </div>
          </div>
          <button type="button" className="platform-button ghost full" onClick={logout} data-testid="platform-logout">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="platform-main">
        {detailTenantId ? (
          <TenantDetail
            tenantId={detailTenantId}
            csrfToken={csrf}
            onBack={() => { setDetailTenantId(null); reload(); }}
            onImpersonated={handleImpersonated}
            onTenantChanged={reload}
          />
        ) : view === "activity" ? (
          <>
            <header className="platform-header">
              <div>
                <div className="platform-eyebrow">Every mutation, every tenant</div>
                <h1 className="platform-title">Recent activity</h1>
                <p className="platform-subtitle">
                  A live feed of every platform-side change — tenants, users, sessions, quotas, and email notices.
                  Filter by action, tenant, or window to trace back exactly what happened and who did it.
                </p>
              </div>
            </header>
            <GlobalAudit tenants={tenants || []} />
          </>
        ) : (
          <>
            <header className="platform-header">
              <div>
                <div className="platform-eyebrow">Multi-tenant control</div>
                <h1 className="platform-title">Tenants</h1>
                <p className="platform-subtitle">
                  Create shops, suspend or reactivate them, impersonate their operators, reset passwords, and audit storage
                  usage — all from one place.
                </p>
              </div>
              <div className="platform-header-actions">
                <button type="button" className="platform-button ghost" onClick={reload} data-testid="platform-refresh">
                  <RefreshCw size={14} /> Refresh
                </button>
                <button
                  type="button"
                  className="platform-button primary"
                  onClick={() => setShowCreate(true)}
                  data-testid="platform-open-create-tenant"
                >
                  <Plus size={14} /> New tenant
                </button>
              </div>
            </header>
            {stats && (
              <section className="platform-stats" data-testid="platform-stats">
                <div className="platform-stat">
                  <span className="platform-stat-label">Total tenants</span>
                  <span className="platform-stat-value" data-testid="platform-stat-total">{stats.total}</span>
                </div>
                <div className="platform-stat">
                  <span className="platform-stat-label">Active</span>
                  <span className="platform-stat-value ok">{stats.active}</span>
                </div>
                <div className="platform-stat">
                  <span className="platform-stat-label">Suspended</span>
                  <span className="platform-stat-value warn">{stats.suspended}</span>
                </div>
                <div className="platform-stat">
                  <span className="platform-stat-label">Total storage</span>
                  <span className="platform-stat-value">{formatBytes(stats.storage)}</span>
                </div>
              </section>
            )}
            {tenants && (
              <QuotaAlerts
                tenants={tenants}
                onOpenTenant={(t) => setDetailTenantId(t.id)}
              />
            )}
            {banner && (
              <div className="platform-banner" role="status">
                {banner}
                <button type="button" className="platform-icon-button" onClick={() => setBanner("")} aria-label="Dismiss">×</button>
              </div>
            )}
            {error && (
              <div className="platform-error" role="alert" data-testid="platform-error">
                <AlertTriangle size={16} /> {error}
              </div>
            )}
            <section className="platform-content">
              {tenants === null ? (
                <div className="platform-muted">Loading tenants…</div>
              ) : (
                <TenantsTable
                  tenants={tenants}
                  onOpenDetail={(tenant) => setDetailTenantId(tenant.id)}
                  onSuspend={(tenant) => setSuspendTarget(tenant)}
                  onUnsuspend={unsuspend}
                  onDelete={deleteTenant}
                  busyId={busyId}
                />
              )}
            </section>
          </>
        )}
      </main>
      {showCreate && (
        <CreateTenantDialog
          csrfToken={csrf}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setBanner("Tenant created.");
            reload();
          }}
        />
      )}
      {suspendTarget && (
        <SuspendTenantDialog
          tenant={suspendTarget}
          busy={busyId === suspendTarget.id}
          onClose={() => setSuspendTarget(null)}
          onConfirm={suspend}
        />
      )}
    </div>
  );
}

export default function PlatformApp() {
  const { session, setSession, checked, sessionError } = useSession();
  if (!checked) {
    return (
      <div className="platform-shell platform-auth-shell">
        <div className="platform-muted">Preparing platform…</div>
      </div>
    );
  }
  if (!session) return <LoginScreen onSession={setSession} initialError={sessionError} />;
  return <Dashboard session={session} onSession={setSession} />;
}
