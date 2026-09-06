import { createHash } from "node:crypto";

const ONE_MINUTE_SECONDS = 60;
const ONE_HOUR_SECONDS = 60 * ONE_MINUTE_SECONDS;
const ONE_DAY_SECONDS = 24 * ONE_HOUR_SECONDS;
const DEFAULT_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;
const DEFAULT_APP_URL = "http://localhost:5173";
const DEFAULT_PASSWORD_RESET_REQUEST_MAX_MATCHES = 3;

const RATE_LIMIT_DEFAULTS = {
  login_ip: { limit: 20, windowSeconds: 15 * ONE_MINUTE_SECONDS },
  login_account: { limit: 8, windowSeconds: 15 * ONE_MINUTE_SECONDS },
  register_ip: { limit: 8, windowSeconds: ONE_HOUR_SECONDS },
  password_reset_request_ip: { limit: 10, windowSeconds: ONE_HOUR_SECONDS },
  password_reset_request_email: { limit: 5, windowSeconds: ONE_HOUR_SECONDS },
  password_reset_complete_ip: { limit: 20, windowSeconds: ONE_HOUR_SECONDS },
  password_reset_complete_token: { limit: 8, windowSeconds: ONE_HOUR_SECONDS },
  onboarding_invitation: { limit: 20, windowSeconds: ONE_HOUR_SECONDS },
  operator_password_reset: { limit: 20, windowSeconds: ONE_HOUR_SECONDS },
  email_send: { limit: 60, windowSeconds: ONE_HOUR_SECONDS },
  upload: { limit: 120, windowSeconds: ONE_HOUR_SECONDS },
  backup: { limit: 12, windowSeconds: ONE_HOUR_SECONDS },
};

function envKey(scope, suffix) {
  return `SIGNGUY_SLIM_RATE_LIMIT_${scope.toUpperCase()}_${suffix}`;
}

export function envFlag(name, defaultValue = false, env = process.env) {
  const value = env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseConfiguredFlag(env, name, defaultValue) {
  const value = env[name];
  if (value === undefined || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (env.NODE_ENV === "production") throw new Error(`${name.toLowerCase()}_invalid`);
  return false;
}

export function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function parseConfiguredPositiveInteger(env, name, fallback, options) {
  const value = env[name];
  const parsed = parsePositiveInteger(value, fallback, options);
  if (env.NODE_ENV === "production" && value !== undefined && value !== null && value !== "" && parsed === fallback) {
    const raw = Number(value);
    if (!Number.isInteger(raw) || raw < (options?.min || 1) || raw > (options?.max || Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${name.toLowerCase()}_invalid`);
    }
  }
  return parsed;
}

export function publicRegistrationEnabled(env = process.env) {
  return parseConfiguredFlag(env, "SIGNGUY_SLIM_PUBLIC_REGISTRATION_ENABLED", env.NODE_ENV !== "production");
}

export function defaultTenantStorageQuotaBytes(env = process.env) {
  return parseConfiguredPositiveInteger(env, "SIGNGUY_SLIM_DEFAULT_TENANT_STORAGE_QUOTA_BYTES", DEFAULT_STORAGE_QUOTA_BYTES, {
    min: 1024 * 1024,
    max: Number.MAX_SAFE_INTEGER,
  });
}

export function passwordResetLifetimeSeconds(env = process.env) {
  return parseConfiguredPositiveInteger(env, "SIGNGUY_SLIM_PASSWORD_RESET_LIFETIME_SECONDS", ONE_HOUR_SECONDS, {
    min: 5 * ONE_MINUTE_SECONDS,
    max: ONE_DAY_SECONDS,
  });
}

export function signupInvitationLifetimeSeconds(env = process.env) {
  return parseConfiguredPositiveInteger(env, "SIGNGUY_SLIM_SIGNUP_INVITATION_LIFETIME_SECONDS", 7 * ONE_DAY_SECONDS, {
    min: ONE_HOUR_SECONDS,
    max: 90 * ONE_DAY_SECONDS,
  });
}

export function appPublicUrl(env = process.env) {
  const configured = env.SIGNGUY_SLIM_APP_URL;
  if (env.NODE_ENV === "production" && (!configured || !String(configured).trim())) {
    throw new Error("production_app_url_required");
  }
  const value = String(configured || DEFAULT_APP_URL).trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("app_url_invalid");
  }
  if (env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("production_app_url_must_be_https");
  }
  if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new Error("app_url_must_be_origin");
  }
  return parsed.origin;
}

export function appLink(hashPath, env = process.env) {
  const path = String(hashPath || "/").startsWith("/") ? hashPath : `/${hashPath}`;
  return `${appPublicUrl(env)}/#${path}`;
}

export function rateLimitPolicy(scope, env = process.env) {
  const defaults = RATE_LIMIT_DEFAULTS[scope];
  if (!defaults) throw new Error("rate_limit_scope_unknown");
  return {
    limit: parseConfiguredPositiveInteger(env, envKey(scope, "LIMIT"), defaults.limit, { min: 1, max: 100000 }),
    windowSeconds: parseConfiguredPositiveInteger(env, envKey(scope, "WINDOW_SECONDS"), defaults.windowSeconds, { min: 1, max: 30 * ONE_DAY_SECONDS }),
  };
}

export function passwordResetRequestMaxMatches(env = process.env) {
  return parseConfiguredPositiveInteger(env, "SIGNGUY_SLIM_PASSWORD_RESET_REQUEST_MAX_MATCHES", DEFAULT_PASSWORD_RESET_REQUEST_MAX_MATCHES, {
    min: 1,
    max: 10,
  });
}

export function recoveryFromEmail(env = process.env) {
  const value = env.SIGNGUY_SLIM_RECOVERY_FROM_EMAIL;
  if (value === undefined || value === null || value === "") return null;
  const email = String(value).trim().toLowerCase();
  if (!validEmailAddress(email)) throw new Error("signguy_slim_recovery_from_email_invalid");
  return email;
}

function validEmailAddress(email) {
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)) return false;
  const [local, domain] = email.split("@");
  if (!local || !domain || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return domain.split(".").every((label) => label && !label.startsWith("-") && !label.endsWith("-"));
}

export function rateLimitKeyHash(scope, parts) {
  return createHash("sha256")
    .update(JSON.stringify({ scope, parts }), "utf8")
    .digest("hex");
}

export function rateLimitRetryAfterSeconds(windowEndAt, nowMs = Date.now()) {
  const remainingMs = new Date(windowEndAt).getTime() - nowMs;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
