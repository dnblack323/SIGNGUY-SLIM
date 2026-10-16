import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Filter, RefreshCw } from "lucide-react";
import { platformFetch } from "./platformApi.js";
import { formatBytes } from "./TenantDetail.jsx";

const SINCE_PRESETS = [
  { value: "", label: "All time" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

function sincePresetToIso(value) {
  if (!value) return null;
  const now = Date.now();
  const map = { "24h": 1, "7d": 7, "30d": 30 };
  const days = map[value];
  if (!days) return null;
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function actionCategory(action) {
  return action.split(".")[0];
}

function formatAction(action) {
  return action.replace(/^tenant\.|^user\./, "").replace(/_/g, " ");
}

function ResourceCell({ event }) {
  if (event.target_type === "tenant") {
    return (
      <span className="platform-muted">
        tenant · <strong>{event.tenant_slug || event.target_id}</strong>
      </span>
    );
  }
  if (event.target_type === "user") {
    const email = event.metadata?.email || event.metadata?.target_email;
    return (
      <span className="platform-muted">
        user · <strong>{email || event.target_id}</strong>
      </span>
    );
  }
  if (event.target_type === "session") {
    return (
      <span className="platform-muted">
        session · <strong>{event.target_id.slice(0, 8)}…</strong>
      </span>
    );
  }
  return <span className="platform-muted">{event.target_type} · {event.target_id}</span>;
}

function EventExtras({ event }) {
  const bits = [];
  const md = event.metadata || {};
  if (md.previous_quota_bytes !== undefined) {
    bits.push(`${formatBytes(md.previous_quota_bytes)} → ${formatBytes(md.new_quota_bytes)}`);
  }
  if (md.sessions_revoked !== undefined) bits.push(`${md.sessions_revoked} sessions revoked`);
  if (md.reason) bits.push(`Reason: ${md.reason}`);
  if (md.kind && md.results) {
    const sent = md.results.filter((r) => r.status === "sent").length;
    const skipped = md.results.filter((r) => r.status !== "sent").length;
    bits.push(`${sent} sent · ${skipped} skipped/error`);
  }
  if (!bits.length) return null;
  return (
    <div className="platform-audit-meta" data-testid={`platform-activity-extras-${event.id}`}>
      {bits.map((bit, idx) => (
        <span key={idx}>{bit}</span>
      ))}
    </div>
  );
}

export default function GlobalAudit({ tenants }) {
  const [items, setItems] = useState(null);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ action: "", tenant_id: "", since: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filters.action) params.set("action", filters.action);
      if (filters.tenant_id) params.set("tenant_id", filters.tenant_id);
      const since = sincePresetToIso(filters.since);
      if (since) params.set("since", since);
      const res = await platformFetch(`/audit?${params}`);
      setItems(res.items);
      setActions(res.actions || []);
    } catch (err) {
      setError(err.message || "Could not load activity.");
    } finally {
      setBusy(false);
    }
  }, [filters.action, filters.tenant_id, filters.since]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!items) return null;
    const map = new Map();
    for (const event of items) {
      const day = new Date(event.occurred_at).toLocaleDateString(undefined, { dateStyle: "full" });
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(event);
    }
    return [...map.entries()];
  }, [items]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const tenantOptions = useMemo(() => {
    return [...(tenants || [])].sort((a, b) => a.slug.localeCompare(b.slug));
  }, [tenants]);

  return (
    <section className="platform-card platform-detail-card platform-activity-card" data-testid="platform-global-audit">
      <header className="platform-detail-card-header">
        <div className="platform-detail-card-title">
          <ClipboardList size={16} />
          <h3>Recent activity</h3>
        </div>
        <div className="platform-detail-card-actions">
          <button
            type="button"
            className="platform-button small ghost"
            onClick={load}
            disabled={busy}
            data-testid="platform-activity-refresh"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </header>
      <div className="platform-activity-filters" data-testid="platform-activity-filters">
        <div className="platform-activity-filter-icon">
          <Filter size={14} /> Filters
        </div>
        <select
          value={filters.action}
          onChange={(e) => updateFilter("action", e.target.value)}
          data-testid="platform-activity-filter-action"
        >
          <option value="">All actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <select
          value={filters.tenant_id}
          onChange={(e) => updateFilter("tenant_id", e.target.value)}
          data-testid="platform-activity-filter-tenant"
        >
          <option value="">All tenants</option>
          {tenantOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.slug} · {t.company_name}</option>
          ))}
        </select>
        <select
          value={filters.since}
          onChange={(e) => updateFilter("since", e.target.value)}
          data-testid="platform-activity-filter-since"
        >
          {SINCE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
        </select>
        {(filters.action || filters.tenant_id || filters.since) && (
          <button
            type="button"
            className="platform-button small ghost"
            onClick={() => setFilters({ action: "", tenant_id: "", since: "" })}
            data-testid="platform-activity-filter-clear"
          >
            Clear
          </button>
        )}
      </div>
      {error && <div className="platform-error" role="alert">{error}</div>}
      {!items ? (
        <div className="platform-muted">Loading activity…</div>
      ) : items.length === 0 ? (
        <div className="platform-muted" data-testid="platform-activity-empty">
          No events matched your filters.
        </div>
      ) : (
        <div className="platform-activity-groups">
          {grouped.map(([day, events]) => (
            <div key={day} className="platform-activity-group">
              <div className="platform-activity-day">{day}</div>
              <ol className="platform-activity-list">
                {events.map((event) => (
                  <li key={event.id} className="platform-activity-row" data-testid={`platform-activity-row-${event.id}`}>
                    <div className={`platform-activity-dot category-${actionCategory(event.action)}`} aria-hidden="true" />
                    <div className="platform-activity-when" title={event.occurred_at}>
                      {new Date(event.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="platform-activity-action">
                      <span className={`platform-badge action-${actionCategory(event.action)}`}>{formatAction(event.action)}</span>
                    </div>
                    <div className="platform-activity-body">
                      <div className="platform-activity-summary">{event.summary}</div>
                      <div className="platform-activity-meta">
                        <span>by <strong>{event.admin_email || "system"}</strong></span>
                        {event.tenant_slug && (
                          <span>on <strong>{event.tenant_slug}</strong></span>
                        )}
                        <ResourceCell event={event} />
                      </div>
                      <EventExtras event={event} />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
