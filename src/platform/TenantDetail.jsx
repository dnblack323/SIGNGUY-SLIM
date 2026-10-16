import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  ClipboardList,
  Coins,
  HardDrive,
  KeyRound,
  Play,
  RefreshCw,
  ShieldOff,
  Trash2,
  Users,
} from "lucide-react";
import { platformFetch } from "./platformApi.js";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const DEFAULT_QUOTA_BYTES = GB; // Matches backend `defaultTenantStorageQuotaBytes` default.

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatAction(action) {
  return action.replace(/^tenant\.|^user\./, "").replace(/_/g, " ");
}

function StorageQuotaCard({ tenant, csrfToken, onUpdated }) {
  const effectiveQuota = tenant.storage_quota_bytes ?? DEFAULT_QUOTA_BYTES;
  const usingDefault = tenant.storage_quota_bytes === null;
  const [gigabytes, setGigabytes] = useState(String((effectiveQuota / GB).toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const usagePct = Math.min(100, Math.round(((tenant.storage_bytes || 0) / effectiveQuota) * 100));

  useEffect(() => {
    setGigabytes(String((effectiveQuota / GB).toFixed(2)));
    setError("");
    setNotice("");
  }, [effectiveQuota]);

  async function submit(event) {
    event.preventDefault();
    const parsed = Number(gigabytes);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive number of gigabytes.");
      return;
    }
    const bytes = Math.round(parsed * GB);
    if (bytes < MB) {
      setError("Quota must be at least 1 MB.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await platformFetch(`/tenants/${tenant.id}/storage-quota`, {
        method: "POST",
        body: { new_quota_bytes: bytes },
        csrfToken,
      });
      setNotice(`Quota set to ${formatBytes(bytes)}.`);
      onUpdated(updated);
    } catch (err) {
      setError(err.message || "Could not update quota.");
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await platformFetch(`/tenants/${tenant.id}/storage-quota`, {
        method: "POST",
        body: { new_quota_bytes: null },
        csrfToken,
      });
      setNotice("Reverted to platform default quota.");
      onUpdated(updated);
    } catch (err) {
      setError(err.message || "Could not reset quota.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="platform-card platform-detail-card" data-testid="platform-storage-quota-card">
      <header className="platform-detail-card-header">
        <div className="platform-detail-card-title">
          <HardDrive size={16} />
          <h3>Storage quota</h3>
        </div>
        <span className="platform-muted">Audited on save</span>
      </header>
      <div className="platform-storage-meter" aria-label={`Using ${usagePct}% of quota`}>
        <div
          className={`platform-storage-bar ${usagePct >= 90 ? "danger" : usagePct >= 75 ? "warn" : "ok"}`}
          style={{ width: `${usagePct}%` }}
        />
      </div>
      <div className="platform-storage-grid">
        <div>
          <span className="platform-stat-label">Used</span>
          <strong className="platform-stat-value" data-testid="platform-storage-used">{formatBytes(tenant.storage_bytes)}</strong>
        </div>
        <div>
          <span className="platform-stat-label">Current quota</span>
          <strong className="platform-stat-value" data-testid="platform-storage-current-quota">
            {formatBytes(effectiveQuota)}
            {usingDefault && <span className="platform-badge muted" style={{ marginLeft: 8 }}>Default</span>}
          </strong>
        </div>
        <div>
          <span className="platform-stat-label">Utilisation</span>
          <strong className={`platform-stat-value ${usagePct >= 90 ? "danger" : usagePct >= 75 ? "warn" : "ok"}`}>{usagePct}%</strong>
        </div>
      </div>
      <form className="platform-storage-form" onSubmit={submit}>
        <label className="platform-field platform-inline-field">
          <span>New quota (GB)</span>
          <input
            type="number"
            step="any"
            min="0.001"
            value={gigabytes}
            onChange={(e) => setGigabytes(e.target.value)}
            data-testid="platform-storage-new-quota"
            disabled={busy}
          />
        </label>
        <div className="platform-storage-actions">
          <button type="submit" className="platform-button primary" disabled={busy} data-testid="platform-storage-save">
            {busy ? "Saving…" : "Save change"}
          </button>
          {!usingDefault && (
            <button
              type="button"
              className="platform-button ghost"
              onClick={resetToDefault}
              disabled={busy}
              data-testid="platform-storage-reset-default"
            >
              Use platform default
            </button>
          )}
        </div>
      </form>
      {error && <div className="platform-error" role="alert" data-testid="platform-storage-error">{error}</div>}
      {notice && <div className="platform-banner inline" role="status" data-testid="platform-storage-notice">{notice}</div>}
    </section>
  );
}

function SessionsCard({ tenantId, csrfToken, refreshTick, onBumpRefresh }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await platformFetch(`/tenants/${tenantId}/sessions`);
      setSessions(res.items);
    } catch (err) {
      setError(err.message || "Could not load sessions.");
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  async function revoke(sessionId) {
    setBusyId(sessionId);
    setError("");
    try {
      await platformFetch(`/tenants/${tenantId}/sessions/${sessionId}`, { method: "DELETE", csrfToken });
      await load();
      onBumpRefresh?.();
    } catch (err) {
      setError(err.message || "Could not revoke session.");
    } finally {
      setBusyId("");
    }
  }

  async function revokeAll() {
    if (!window.confirm("Force-logout every user in this tenant? Their next request will require signing in again.")) return;
    setBusyId("__all");
    setError("");
    try {
      await platformFetch(`/tenants/${tenantId}/sessions/revoke-all`, { method: "POST", csrfToken });
      await load();
      onBumpRefresh?.();
    } catch (err) {
      setError(err.message || "Could not revoke sessions.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="platform-card platform-detail-card" data-testid="platform-sessions-card">
      <header className="platform-detail-card-header">
        <div className="platform-detail-card-title">
          <ShieldOff size={16} />
          <h3>Active sessions</h3>
        </div>
        <div className="platform-detail-card-actions">
          <button
            type="button"
            className="platform-button small ghost"
            onClick={load}
            disabled={busyId === "__all"}
            data-testid="platform-sessions-refresh"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className="platform-button small warn"
            onClick={revokeAll}
            disabled={busyId === "__all" || !sessions?.length}
            data-testid="platform-force-logout-all"
          >
            <Ban size={14} /> Force logout all
          </button>
        </div>
      </header>
      {error && <div className="platform-error" role="alert">{error}</div>}
      {!sessions ? (
        <div className="platform-muted">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="platform-muted">No active sessions.</div>
      ) : (
        <table className="platform-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Origin</th>
              <th>Signed in</th>
              <th>Expires</th>
              <th className="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} data-testid={`platform-session-row-${session.id}`}>
                <td>
                  <div className="platform-user-cell">
                    <strong>{session.user_display_name}</strong>
                    <span className="platform-muted">{session.user_email} · {session.user_role}</span>
                  </div>
                </td>
                <td>
                  {session.impersonated_by_platform_admin_id ? (
                    <span className="platform-badge warn" title={session.impersonator_email}>Impersonation</span>
                  ) : (
                    <span className="platform-badge muted">User</span>
                  )}
                </td>
                <td>{formatDate(session.created_at)}</td>
                <td>{formatDate(session.expires_at)}</td>
                <td className="right">
                  <button
                    type="button"
                    className="platform-button small warn"
                    disabled={busyId === session.id}
                    onClick={() => revoke(session.id)}
                    data-testid={`platform-revoke-session-${session.id}`}
                  >
                    <Ban size={12} /> Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AuditCard({ tenantId, refreshTick }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await platformFetch(`/tenants/${tenantId}/audit?limit=100`);
        if (alive) setEvents(res.items);
      } catch (err) {
        if (alive) setError(err.message || "Could not load audit trail.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantId, refreshTick]);

  return (
    <section className="platform-card platform-detail-card" data-testid="platform-audit-card">
      <header className="platform-detail-card-header">
        <div className="platform-detail-card-title">
          <ClipboardList size={16} />
          <h3>Audit trail</h3>
        </div>
        <span className="platform-muted">Most recent first</span>
      </header>
      {error && <div className="platform-error" role="alert">{error}</div>}
      {!events ? (
        <div className="platform-muted">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="platform-muted">No audit events for this tenant yet.</div>
      ) : (
        <ol className="platform-audit-list">
          {events.map((event) => (
            <li key={event.id} className="platform-audit-item" data-testid={`platform-audit-item-${event.id}`}>
              <div className="platform-audit-marker" data-action={event.action} aria-hidden="true" />
              <div className="platform-audit-body">
                <div className="platform-audit-headline">
                  <span className={`platform-badge action-${event.action.split('.')[0]}`}>{formatAction(event.action)}</span>
                  <span className="platform-muted">{formatDate(event.occurred_at)}</span>
                </div>
                <div className="platform-audit-summary">{event.summary}</div>
                <div className="platform-audit-meta">
                  <span>by <strong>{event.admin_email || "system"}</strong></span>
                  {event.metadata?.previous_quota_bytes !== undefined && (
                    <span>
                      {formatBytes(event.metadata.previous_quota_bytes)} → {formatBytes(event.metadata.new_quota_bytes)}
                    </span>
                  )}
                  {event.metadata?.sessions_revoked !== undefined && (
                    <span>{event.metadata.sessions_revoked} sessions revoked</span>
                  )}
                  {event.metadata?.reason && <span>Reason: {event.metadata.reason}</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function UsersCard({ tenant, csrfToken, refreshTick, onImpersonated, onChanged }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [passwordFor, setPasswordFor] = useState(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await platformFetch(`/tenants/${tenant.id}/users`);
      setUsers(res.items);
    } catch (err) {
      setError(err.message || "Could not load users.");
    }
  }, [tenant.id]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  async function impersonate(user) {
    setBusyId(user.id);
    setError("");
    try {
      const result = await platformFetch(`/tenants/${tenant.id}/impersonate`, {
        method: "POST",
        body: { user_id: user.id },
        csrfToken,
      });
      onImpersonated(result);
    } catch (err) {
      setError(err.message || "Could not impersonate user.");
    } finally {
      setBusyId("");
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("new_password");
    setBusyId(passwordFor.id);
    setError("");
    try {
      await platformFetch(`/users/${passwordFor.id}/password`, {
        method: "POST",
        body: { new_password: password },
        csrfToken,
      });
      setPasswordFor(null);
      onChanged?.();
    } catch (err) {
      setError(err.message || "Could not reset password.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="platform-card platform-detail-card" data-testid="platform-users-card">
      <header className="platform-detail-card-header">
        <div className="platform-detail-card-title">
          <Users size={16} />
          <h3>Users</h3>
        </div>
        <span className="platform-muted">{users ? `${users.length} total` : ""}</span>
      </header>
      {error && <div className="platform-error" role="alert">{error}</div>}
      {!users ? (
        <div className="platform-muted">Loading…</div>
      ) : users.length === 0 ? (
        <div className="platform-muted">No users in this tenant.</div>
      ) : (
        <table className="platform-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} data-testid={`platform-user-row-${user.id}`}>
                <td>
                  <div className="platform-user-cell">
                    <strong>{user.display_name}</strong>
                    <span className="platform-muted">{user.email}</span>
                  </div>
                </td>
                <td><span className={`platform-badge role-${user.role}`}>{user.role}</span></td>
                <td>{user.active ? <span className="platform-badge ok">Active</span> : <span className="platform-badge muted">Disabled</span>}</td>
                <td className="right">
                  <div className="platform-row-actions">
                    <button
                      type="button"
                      className="platform-button small"
                      onClick={() => setPasswordFor(user)}
                      disabled={busyId === user.id}
                      data-testid={`platform-reset-password-${user.id}`}
                    >
                      <KeyRound size={14} /> Reset password
                    </button>
                    <button
                      type="button"
                      className="platform-button small primary"
                      onClick={() => impersonate(user)}
                      disabled={busyId === user.id || !user.active || tenant.suspended_at}
                      title={tenant.suspended_at ? "Unsuspend the tenant first" : ""}
                      data-testid={`platform-impersonate-${user.id}`}
                    >
                      <Play size={14} /> Impersonate
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {passwordFor && (
        <div className="platform-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPasswordFor(null)}>
          <form
            className="platform-modal small"
            onSubmit={submitPassword}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="platform-modal-header">
              <h3>Reset password for {passwordFor.email}</h3>
              <button type="button" className="platform-icon-button" onClick={() => setPasswordFor(null)} aria-label="Close">×</button>
            </div>
            <div className="platform-modal-body">
              <label className="platform-field">
                <span>New password (8+ characters)</span>
                <input
                  name="new_password"
                  type="text"
                  minLength={8}
                  required
                  autoFocus
                  data-testid="platform-new-password-input"
                />
              </label>
            </div>
            <div className="platform-modal-footer">
              <button type="button" className="platform-button ghost" onClick={() => setPasswordFor(null)}>Cancel</button>
              <button type="submit" className="platform-button primary" data-testid="platform-new-password-submit">Set password</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export default function TenantDetail({ tenantId, csrfToken, onBack, onImpersonated, onTenantChanged }) {
  const [tenant, setTenant] = useState(null);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(async () => {
    setError("");
    try {
      const t = await platformFetch(`/tenants/${tenantId}`);
      setTenant(t);
    } catch (err) {
      setError(err.message || "Could not load tenant.");
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  function bumpRefresh() {
    setRefreshTick((v) => v + 1);
    load();
    onTenantChanged?.();
  }

  const status = useMemo(() => {
    if (!tenant) return null;
    return tenant.suspended_at
      ? { label: "Suspended", tone: "warn", title: tenant.suspended_reason || "" }
      : { label: "Active", tone: "ok", title: "" };
  }, [tenant]);

  if (error && !tenant) {
    return (
      <div>
        <button type="button" className="platform-button ghost" onClick={onBack} data-testid="platform-detail-back">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="platform-error" role="alert">{error}</div>
      </div>
    );
  }
  if (!tenant) return <div className="platform-muted">Loading tenant…</div>;

  return (
    <div className="platform-detail" data-testid={`platform-tenant-detail-${tenant.id}`}>
      <header className="platform-detail-header">
        <button type="button" className="platform-button ghost" onClick={onBack} data-testid="platform-detail-back">
          <ArrowLeft size={14} /> All tenants
        </button>
        <div className="platform-detail-title-row">
          <div>
            <div className="platform-eyebrow">Tenant</div>
            <h1 className="platform-title" data-testid="platform-detail-company">{tenant.company_name}</h1>
            <div className="platform-muted">{tenant.slug} · created {formatDate(tenant.created_at)}</div>
          </div>
          <span className={`platform-badge ${status.tone}`} title={status.title}>{status.label}</span>
        </div>
      </header>

      <section className="platform-detail-stats" data-testid="platform-detail-stats">
        <div className="platform-stat">
          <span className="platform-stat-label"><Users size={12} /> Users</span>
          <span className="platform-stat-value">{tenant.active_user_count} <span className="platform-muted">/ {tenant.user_count}</span></span>
        </div>
        <div className="platform-stat">
          <span className="platform-stat-label"><Coins size={12} /> Orders</span>
          <span className="platform-stat-value">{tenant.order_count}</span>
        </div>
        <div className="platform-stat">
          <span className="platform-stat-label"><HardDrive size={12} /> Storage used</span>
          <span className="platform-stat-value">{formatBytes(tenant.storage_bytes)}</span>
        </div>
        <div className="platform-stat">
          <span className="platform-stat-label"><Trash2 size={12} /> Suspended</span>
          <span className="platform-stat-value">{tenant.suspended_at ? formatDate(tenant.suspended_at) : "—"}</span>
        </div>
      </section>

      <div className="platform-detail-grid">
        <StorageQuotaCard tenant={tenant} csrfToken={csrfToken} onUpdated={(t) => { setTenant(t); bumpRefresh(); }} />
        <SessionsCard tenantId={tenant.id} csrfToken={csrfToken} refreshTick={refreshTick} onBumpRefresh={bumpRefresh} />
        <UsersCard tenant={tenant} csrfToken={csrfToken} refreshTick={refreshTick} onImpersonated={onImpersonated} onChanged={bumpRefresh} />
        <AuditCard tenantId={tenant.id} refreshTick={refreshTick} />
      </div>
    </div>
  );
}
