import {
  useEffect,
  useState,
} from "react";
import {
  KeyRound,
  Mail,
  RotateCcw,
  Save,
  Upload,
  UserPlus,
} from "lucide-react";
import {
  AddressFields,
  backupPreviewGroups,
  Field,
  useLoad,
  Toolbar,
  TwoColumn,
  AsyncState,
} from "../general/GeneralPages.jsx";

function SettingsPage({ api, session, onSession }) {
  const state = useLoad(() => api.get("/settings"), []);
  const [form, setForm] = useState(null);
  const [emailForm, setEmailForm] = useState({ sender_name: "", sender_email: "", sendgrid_verified: false });
  const [rotationReason, setRotationReason] = useState("");
  const [userForm, setUserForm] = useState({ display_name: "", email: "", password: "", role: "staff", active: true });
  const [action, setAction] = useState({ busy: false, error: "" });
  const canManageUsers = ["owner", "admin"].includes(session.user.role);
  const canEditSettings = ["owner", "admin"].includes(session.user.role);
  const roleOptions = session.user.role === "owner" ? ["staff", "manager", "admin", "owner"] : ["staff", "manager", "admin"];
  useEffect(() => {
    if (state.data?.tenant && !form) setForm({ ...state.data.tenant, address: state.data.tenant.address });
    if (state.data?.email_settings) {
      setEmailForm({
        sender_name: state.data.email_settings.sender_name || state.data.tenant?.company_name || "",
        sender_email: state.data.email_settings.sender_email || "",
        sendgrid_verified: Boolean(state.data.email_settings.sendgrid_verified),
      });
    }
  }, [state.data, form]);
  async function save(event) {
    event.preventDefault();
    if (!canEditSettings) return;
    setAction({ busy: true, error: "" });
    try {
      const updated = await api.patch("/settings", form);
      onSession({ ...session, tenant: updated.tenant });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function saveUser(event) {
    event.preventDefault();
    setAction({ busy: true, error: "" });
    try {
      await api.post("/users", userForm);
      setUserForm({ display_name: "", email: "", password: "", role: "staff", active: true });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setRole(id, role) {
    setAction({ busy: true, error: "" });
    try {
      await api.patch(`/users/${id}`, { role });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function setActive(id, active) {
    setAction({ busy: true, error: "" });
    try {
      await api.patch(`/users/${id}`, { active });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function saveEmailSettings(event) {
    event.preventDefault();
    if (!canEditSettings) return;
    setAction({ busy: true, error: "" });
    try {
      await api.patch("/settings/email", { ...emailForm, sender_email: emailForm.sender_email || null });
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  async function rotateIntake(event) {
    event.preventDefault();
    if (!canEditSettings || !rotationReason.trim()) return;
    setAction({ busy: true, error: "" });
    try {
      await api.post("/settings/intake-address/rotate", { reason: rotationReason });
      setRotationReason("");
      state.refresh();
    } catch (err) {
      setAction({ busy: false, error: err.message });
      return;
    }
    setAction({ busy: false, error: "" });
  }
  if (!form) return <AsyncState state={state} empty="Settings unavailable" />;
  return (
    <TwoColumn>
      <form className="panel form-grid" onSubmit={save}>
        <h2>Company Settings</h2>
        {!canEditSettings && <div className="notice">Company settings are read-only for your role.</div>}
        {action.error && <div className="error-state">{action.error}</div>}
        <Field label="Company name" value={form.company_name} disabled={!canEditSettings} onChange={(company_name) => setForm({ ...form, company_name })} />
        <Field label="Logo reference" value={form.logo_reference || ""} disabled={!canEditSettings} onChange={(logo_reference) => setForm({ ...form, logo_reference })} />
        <AddressFields address={form.address} disabled={!canEditSettings} setAddress={(address) => setForm({ ...form, address })} />
        <Field label="Contact email" value={form.contact_email || ""} disabled={!canEditSettings} onChange={(contact_email) => setForm({ ...form, contact_email })} />
        <Field label="Contact phone" value={form.contact_phone || ""} disabled={!canEditSettings} onChange={(contact_phone) => setForm({ ...form, contact_phone })} />
        <Field label="Sales tax basis points" type="number" value={form.sales_tax_rate_basis_points} disabled={!canEditSettings} onChange={(sales_tax_rate_basis_points) => setForm({ ...form, sales_tax_rate_basis_points: Number(sales_tax_rate_basis_points) })} />
        <Field label="Locale" value={form.locale} disabled={!canEditSettings} onChange={(locale) => setForm({ ...form, locale })} />
        <Field label="Currency" value={form.currency} disabled={!canEditSettings} onChange={(currency) => setForm({ ...form, currency })} />
        <Field label="Timezone" value={form.shop_timezone} disabled={!canEditSettings} onChange={(shop_timezone) => setForm({ ...form, shop_timezone })} />
        {canEditSettings && <button className="primary-button" disabled={action.busy}><Save size={16} />Save Settings</button>}
      </form>
      <section className="panel">
        <Toolbar title="Users" />
        {canManageUsers && <form className="inline-form" onSubmit={saveUser}>
          <input placeholder="Name" value={userForm.display_name} onChange={(event) => setUserForm({ ...userForm, display_name: event.target.value })} />
          <input placeholder="Email" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
          <input placeholder="Password" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
          <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
            {roleOptions.map((role) => <option key={role}>{role}</option>)}
          </select>
          <button disabled={action.busy}><UserPlus size={14} />Add User</button>
        </form>}
        <div className="record-list">
          {(state.data?.users || []).map((user) => (
            <article className="record-row" key={user.id}>
              <div><strong>{user.display_name}</strong><span>{user.email}</span></div>
              {canManageUsers ? (
                <>
                  <select value={user.role} disabled={action.busy || (user.role === "owner" && session.user.role !== "owner")} onChange={(event) => setRole(user.id, event.target.value)}>
                    {(user.role === "owner" && !roleOptions.includes("owner") ? ["owner", ...roleOptions] : roleOptions).map((role) => <option key={role}>{role}</option>)}
                  </select>
                  <label className="check-row"><input type="checkbox" checked={user.active} disabled={action.busy} onChange={(event) => setActive(user.id, event.target.checked)} />Active</label>
                </>
              ) : <span>{user.role}</span>}
            </article>
          ))}
        </div>
      </section>
      <form className="panel form-grid" onSubmit={saveEmailSettings}>
        <h2>Customer Email</h2>
        <div className="notice">SendGrid API keys and webhook secrets are read from server environment variables and are never shown here.</div>
        <Field label="Sender name" value={emailForm.sender_name} disabled={!canEditSettings} onChange={(sender_name) => setEmailForm({ ...emailForm, sender_name })} />
        <Field label="Sender email" type="email" value={emailForm.sender_email} disabled={!canEditSettings} onChange={(sender_email) => setEmailForm({ ...emailForm, sender_email })} />
        <label className="check-row"><input type="checkbox" checked={emailForm.sendgrid_verified} disabled={!canEditSettings} onChange={(event) => setEmailForm({ ...emailForm, sendgrid_verified: event.target.checked })} />Verified sender</label>
        <span className="status-pill"><Mail size={16} />{state.data?.email_settings?.provider_ready ? "Provider key configured" : "Provider key missing"}</span>
        {canEditSettings && <button className="primary-button" disabled={action.busy}><Save size={16} />Save Email Settings</button>}
      </form>
      <form className="panel form-grid" onSubmit={rotateIntake}>
        <h2>Incoming Requests</h2>
        <div className="notice">Forward only order-related email to this private address. Slim does not read Gmail, Outlook, or the full shop mailbox.</div>
        <label><span>Private intake address</span><input readOnly value={state.data?.intake_address?.full_address || ""} /></label>
        <Field label="Rotation reason" value={rotationReason} disabled={!canEditSettings} onChange={setRotationReason} />
        {canEditSettings && <button className="primary-button" disabled={action.busy || !rotationReason.trim()}><RotateCcw size={16} />Rotate Address</button>}
      </form>
      <BackupRestorePanel api={api} session={session} />
    </TwoColumn>
  );
}

function BackupRestorePanel({ api, session }) {
  const canUseBackup = ["owner", "admin"].includes(session.user.role);
  const [exportForm, setExportForm] = useState({ passphrase: "", confirm: "" });
  const [restoreForm, setRestoreForm] = useState({ passphrase: "", confirmation: session.tenant.company_name, policy: false });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [action, setAction] = useState({ busy: false, error: "", saved: "" });

  async function loadHistory() {
    if (!canUseBackup) return;
    try {
      const data = await api.get("/backup/history");
      setHistory(data.items || []);
    } catch {
      setHistory([]);
    }
  }

  useEffect(() => { loadHistory(); }, [canUseBackup]);

  async function createBackup(event) {
    event.preventDefault();
    setAction({ busy: true, error: "", saved: "" });
    try {
      if (exportForm.passphrase !== exportForm.confirm) throw new Error("backup_passphrase_mismatch");
      await api.download("/backup/export", `${session.tenant.company_name}.signguy-backup`, {
        method: "POST",
        body: { passphrase: exportForm.passphrase, passphrase_confirmation: exportForm.confirm },
      });
      setExportForm({ passphrase: "", confirm: "" });
      setAction({ busy: false, error: "", saved: "Encrypted backup downloaded" });
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function previewBackup(event) {
    event.preventDefault();
    if (!file) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      const data = await api.upload("/backup/preview", file, { passphrase: restoreForm.passphrase });
      setPreview(data);
      setAction({ busy: false, error: "", saved: data.restore_permitted ? "Preview ready" : "Preview blocked" });
    } catch (err) {
      setPreview(null);
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  async function restore(event) {
    event.preventDefault();
    if (!file || !preview?.restore_permitted || !window.confirm("Restore this backup into the current empty tenant?")) return;
    setAction({ busy: true, error: "", saved: "" });
    try {
      await api.upload("/backup/restore", file, {
        passphrase: restoreForm.passphrase,
        confirmation_phrase: restoreForm.confirmation,
        unmatched_assignment_policy: restoreForm.policy ? "restore_unassigned" : "",
      });
      setAction({ busy: false, error: "", saved: "Restore completed" });
      setPreview(null);
      setFile(null);
      await loadHistory();
    } catch (err) {
      setAction({ busy: false, error: err.message, saved: "" });
    }
  }

  if (!canUseBackup) {
    return <section className="panel"><Toolbar title="Backup & Restore" /><div className="notice">Backup and restore are available to owners and admins.</div></section>;
  }

  const counts = preview?.counts || {};
  const countGroups = backupPreviewGroups(counts);
  return (
    <section className="panel backup-panel">
      <Toolbar title="Backup & Restore" />
      <div className="notice">Backups include supported Slim shop, scheduling, employee, message, announcement, audit, and attachment records, encrypted with a passphrase. Passwords, sessions, auth tokens, API keys/secrets, logs, temporary URLs, and external credentials are excluded.</div>
      {action.error && <div className="error-state">{action.error}</div>}
      {action.saved && <div className="success-state">{action.saved}</div>}
      <form className="form-grid" onSubmit={createBackup}>
        <h3>Create Backup</h3>
        <Field label="Backup passphrase" type="password" value={exportForm.passphrase} onChange={(passphrase) => setExportForm({ ...exportForm, passphrase })} />
        <Field label="Confirm passphrase" type="password" value={exportForm.confirm} onChange={(confirm) => setExportForm({ ...exportForm, confirm })} />
        <button className="primary-button" disabled={action.busy}><KeyRound size={16} />Create Backup</button>
      </form>
      <form className="form-grid" onSubmit={previewBackup}>
        <h3>Validate Backup</h3>
        <label className="field">
          <span>Backup file</span>
          <input type="file" accept=".signguy-backup,application/vnd.signguy.backup" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} />
        </label>
        <Field label="Backup passphrase" type="password" value={restoreForm.passphrase} onChange={(passphrase) => setRestoreForm({ ...restoreForm, passphrase })} />
        <button className="primary-button" disabled={action.busy || !file}><Upload size={16} />Validate Backup</button>
      </form>
      {preview && (
        <form className="form-grid restore-preview" onSubmit={restore}>
          <h3>Restore Preview</h3>
          {countGroups.length ? (
            <div className="backup-count-groups">
              {countGroups.map((group) => (
                <section className="backup-count-group" key={group.title}>
                  <h4>{group.title}</h4>
                  <div className="backup-counts">
                    {group.items.map(([key, label]) => <span key={key}>{label}: {counts[key] || 0}</span>)}
                  </div>
                </section>
              ))}
            </div>
          ) : <div className="empty-state">No record counts reported</div>}
          <span>Created: {preview.created_at_utc}</span>
          <span>Source: {preview.source_product} / {preview.source_application_version}</span>
          <span>Schema: {preview.source_schema_version}</span>
          <span>Attachment bytes: {preview.total_attachment_bytes || 0}</span>
          {preview.user_mapping?.map((entry) => <span key={entry.source_user_portable_id}>{entry.source_email_label}: {entry.matched ? `matched ${entry.matched_target_display_name}` : "unmatched"}</span>)}
          {preview.warnings?.map((warning) => <div className="notice" key={warning}>{warning}</div>)}
          {preview.blocking_errors?.map((blocking) => <div className="error-state" key={blocking}>{blocking}</div>)}
          {preview.required_unmatched_assignment_policy && <label className="check-row"><input type="checkbox" checked={restoreForm.policy} onChange={(event) => setRestoreForm({ ...restoreForm, policy: event.target.checked })} />Restore unmatched assignments as unassigned</label>}
          <Field label="Type target shop name" value={restoreForm.confirmation} onChange={(confirmation) => setRestoreForm({ ...restoreForm, confirmation })} />
          <button className="primary-button" disabled={action.busy || !preview.restore_permitted || (preview.required_unmatched_assignment_policy && !restoreForm.policy)}><RotateCcw size={16} />Restore Into Empty Tenant</button>
        </form>
      )}
      <section>
        <h3>Restore History</h3>
        {history.length === 0 ? <div className="empty-state">No restores recorded</div> : history.map((entry) => (
          <article className="record-row" key={entry.id}>
            <div><strong>{entry.backup_id}</strong><span>{entry.status} / {entry.completed_at || entry.started_at}</span></div>
            <span>{Object.entries(entry.restored_counts || {}).map(([key, value]) => `${key}:${value}`).slice(0, 3).join(" ")}</span>
          </article>
        ))}
      </section>
    </section>
  );
}

export {
  SettingsPage,
  BackupRestorePanel,
};
