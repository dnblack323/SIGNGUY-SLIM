import { AlertTriangle, HardDrive } from "lucide-react";
import { formatBytes } from "./TenantDetail.jsx";

const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;

export function quotaAlertsFor(tenants) {
  return tenants
    .map((t) => {
      const quota = t.storage_quota_bytes ?? DEFAULT_QUOTA_BYTES;
      const used = t.storage_bytes || 0;
      const pct = quota > 0 ? Math.round((used / quota) * 100) : 0;
      let severity = null;
      if (pct >= 100) severity = "danger";
      else if (pct >= 90) severity = "warn";
      else if (pct >= 80) severity = "info";
      return { tenant: t, pct, quota, used, severity };
    })
    .filter((row) => row.severity)
    .sort((a, b) => b.pct - a.pct);
}

export default function QuotaAlerts({ tenants, onOpenTenant }) {
  const alerts = quotaAlertsFor(tenants || []);
  if (!alerts.length) return null;
  const grouped = {
    danger: alerts.filter((a) => a.severity === "danger"),
    warn: alerts.filter((a) => a.severity === "warn"),
    info: alerts.filter((a) => a.severity === "info"),
  };
  return (
    <section className="platform-card platform-quota-alerts" data-testid="platform-quota-alerts">
      <header className="platform-detail-card-header">
        <div className="platform-detail-card-title">
          <AlertTriangle size={16} />
          <h3>Quota alerts</h3>
        </div>
        <div className="platform-quota-alert-counts" data-testid="platform-quota-alert-counts">
          {grouped.danger.length > 0 && (
            <span className="platform-badge danger">{grouped.danger.length} over</span>
          )}
          {grouped.warn.length > 0 && (
            <span className="platform-badge warn">{grouped.warn.length} critical</span>
          )}
          {grouped.info.length > 0 && (
            <span className="platform-badge info">{grouped.info.length} nearing</span>
          )}
        </div>
      </header>
      <ul className="platform-quota-alert-list">
        {alerts.map(({ tenant, pct, quota, used, severity }) => (
          <li
            key={tenant.id}
            className={`platform-quota-alert-item severity-${severity}`}
            data-testid={`platform-quota-alert-${tenant.id}`}
            data-severity={severity}
          >
            <div className="platform-quota-alert-main">
              <div className="platform-quota-alert-titles">
                <strong>{tenant.company_name}</strong>
                <span className="platform-muted">{tenant.slug}</span>
              </div>
              <div className="platform-quota-alert-numbers">
                <span className={`platform-quota-alert-pct severity-${severity}`}>{pct}%</span>
                <span className="platform-muted">
                  <HardDrive size={12} /> {formatBytes(used)} / {formatBytes(quota)}
                </span>
              </div>
            </div>
            <div className="platform-quota-alert-bar" aria-hidden="true">
              <div className={`platform-quota-alert-bar-fill severity-${severity}`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            {onOpenTenant && (
              <button
                type="button"
                className="platform-button small"
                onClick={() => onOpenTenant(tenant)}
                data-testid={`platform-quota-alert-open-${tenant.id}`}
              >
                Open detail
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
