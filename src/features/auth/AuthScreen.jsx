import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { apiRequest } from "../../api.js";
import { Field } from "../general/GeneralPages.jsx";

function authModeFromRoute(route) {
  if (route.startsWith("/register")) return "register";
  if (route.startsWith("/reset-password")) return "reset-complete";
  return "login";
}

function queryParamsFromRoute(route) {
  const query = route.includes("?") ? route.slice(route.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

export function AuthScreen({ onSession, route }) {
  const [mode, setMode] = useState(() => authModeFromRoute(route));
  const [form, setForm] = useState({
    tenant_name: "Acme Signs",
    tenant_slug: "acme-signs",
    owner_name: "Owner",
    owner_email: "owner@example.com",
    owner_password: "",
    email: "owner@example.com",
    password: "",
    invite_token: queryParamsFromRoute(route).get("invite") || "",
    reset_email: "",
    reset_token: queryParamsFromRoute(route).get("token") || "",
    new_password: "",
  });
  const [registrationOptions, setRegistrationOptions] = useState({ public_registration_enabled: false, registration_mode: "invite_only" });
  const [quickAccounts, setQuickAccounts] = useState([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [quickBusyKey, setQuickBusyKey] = useState("");
  const inviteToken = form.invite_token;
  const canRegister = registrationOptions.public_registration_enabled || Boolean(inviteToken);

  useEffect(() => {
    let active = true;
    apiRequest("/auth/registration-options")
      .then((options) => {
        if (active) setRegistrationOptions(options);
      })
      .catch(() => {
        if (active) setRegistrationOptions({ public_registration_enabled: false, registration_mode: "invite_only" });
      });
    apiRequest("/dev/quick-signin")
      .then((res) => {
        if (active && Array.isArray(res?.accounts)) setQuickAccounts(res.accounts);
      })
      .catch(() => {
        if (active) setQuickAccounts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const params = queryParamsFromRoute(route);
    const nextMode = authModeFromRoute(route);
    setMode((current) => (current === nextMode || (current === "reset-request" && nextMode === "login") ? current : nextMode));
    setForm((current) => ({
      ...current,
      invite_token: params.get("invite") || "",
      reset_token: params.get("token") || "",
    }));
  }, [route]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      if (mode === "reset-request") {
        await apiRequest("/auth/password-reset/request", {
          method: "POST",
          body: { email: form.reset_email || form.email },
        });
        setSaved("If an active account matches that email, reset instructions have been sent.");
        return;
      }
      if (mode === "reset-complete") {
        await apiRequest("/auth/password-reset/complete", {
          method: "POST",
          body: { reset_token: form.reset_token, new_password: form.new_password },
        });
        onSession(null);
        setMode("login");
        setForm({ ...form, password: "", new_password: "", reset_token: "" });
        setSaved("Password reset complete. Sign in with the new password.");
        window.location.hash = "#/";
        return;
      }
      const session = mode === "register"
        ? await apiRequest("/auth/register", {
            method: "POST",
            body: {
              tenant_name: form.tenant_name,
              tenant_slug: form.tenant_slug,
              owner_name: form.owner_name,
              owner_email: form.owner_email,
              owner_password: form.owner_password,
              ...(inviteToken ? { invite_token: inviteToken } : {}),
            },
          })
        : await apiRequest("/auth/login", {
            method: "POST",
          body: { tenant_slug: form.tenant_slug, email: form.email, password: form.password },
        });
      onSession(session);
      window.location.hash = "#/";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function quickSignIn(account) {
    const key = `${account.tenant_slug}::${account.email}`;
    setQuickBusyKey(key);
    setError("");
    setSaved("");
    try {
      const session = await apiRequest("/auth/login", {
        method: "POST",
        body: {
          tenant_slug: account.tenant_slug,
          email: account.email,
          password: account.password,
        },
      });
      onSession(session);
      window.location.hash = "#/";
    } catch (err) {
      setError(err.message || "Quick sign-in failed.");
    } finally {
      setQuickBusyKey("");
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={submit}>
        <div className="logo-mark" aria-hidden="true">SG</div>
        <h1>SignGuy Slim</h1>
        <div className="segmented">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
          {canRegister && <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register</button>}
        </div>
        {!registrationOptions.public_registration_enabled && !inviteToken && <div className="notice">New shop registration requires an invitation.</div>}
        {mode === "register" && (
          <>
            {inviteToken && <div className="notice">Invitation accepted for this registration.</div>}
            <Field label="Company" value={form.tenant_name} onChange={(tenant_name) => setForm({ ...form, tenant_name })} />
            <Field label="Owner name" value={form.owner_name} onChange={(owner_name) => setForm({ ...form, owner_name })} />
            <Field label="Owner email" type="email" value={form.owner_email} onChange={(owner_email) => setForm({ ...form, owner_email })} />
            <Field label="Owner password" type="password" value={form.owner_password} onChange={(owner_password) => setForm({ ...form, owner_password })} />
          </>
        )}
        {mode !== "reset-request" && mode !== "reset-complete" && <Field label="Shop slug" value={form.tenant_slug} onChange={(tenant_slug) => setForm({ ...form, tenant_slug })} />}
        {mode === "login" && quickAccounts.length > 0 && (
          <div className="dev-quick-signin" data-testid="dev-quick-signin">
            <div className="dev-quick-signin-heading">
              <span>Dev quick sign-in</span>
              <small>Preview only</small>
            </div>
            <div className="dev-quick-signin-buttons">
              {quickAccounts.map((account) => {
                const key = `${account.tenant_slug}::${account.email}`;
                const busyThis = quickBusyKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className="dev-quick-signin-button"
                    onClick={() => quickSignIn(account)}
                    disabled={Boolean(quickBusyKey)}
                    data-testid={`dev-quick-signin-${account.tenant_slug}`}
                  >
                    <strong>{account.label || account.email}</strong>
                    <span>{account.tenant_slug} · {account.email}</span>
                    {busyThis && <em>Signing in…</em>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {mode === "login" && (
          <>
            <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <Field label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
            <button type="button" className="link-button" onClick={() => { setMode("reset-request"); setSaved(""); setError(""); }}>Forgot password?</button>
          </>
        )}
        {mode === "reset-request" && (
          <>
            <Field label="Email" type="email" value={form.reset_email || form.email} onChange={(reset_email) => setForm({ ...form, reset_email })} />
            <button type="button" className="link-button" onClick={() => { setMode("login"); setSaved(""); setError(""); }}>Back to login</button>
          </>
        )}
        {mode === "reset-complete" && (
          <>
            <Field label="Reset token" value={form.reset_token} onChange={(reset_token) => setForm({ ...form, reset_token })} />
            <Field label="New password" type="password" value={form.new_password} onChange={(new_password) => setForm({ ...form, new_password })} />
          </>
        )}
        {error && <div className="error-state">{error}</div>}
        {saved && <div className="success-state">{saved}</div>}
        <button className="primary-button" disabled={busy || (mode === "register" && !canRegister)}><ShieldCheck size={16} />{busy ? "Working" : mode === "reset-request" ? "Send Reset Link" : mode === "reset-complete" ? "Reset Password" : "Continue"}</button>
        <a className="auth-platform-link" href="/platform" data-testid="auth-goto-platform">
          Platform admin? Go to /platform →
        </a>
      </form>
    </main>
  );
}
