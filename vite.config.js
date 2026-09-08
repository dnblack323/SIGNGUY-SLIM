import { isIP } from "node:net";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function isLoopbackAddress(value) {
  const raw = String(value || "").trim();
  const normalized = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (!isIP(normalized)) return false;
  return normalized === "::1" || /^127\./.test(normalized);
}

function devAutoLoginPlugin(env) {
  const enabled = env.SIGNGUY_SLIM_DEV_AUTO_LOGIN === "1";
  const credentials = {
    tenant_slug: String(env.SIGNGUY_SLIM_DEV_AUTO_LOGIN_TENANT_SLUG || "").trim(),
    email: String(env.SIGNGUY_SLIM_DEV_AUTO_LOGIN_EMAIL || "").trim(),
    password: String(env.SIGNGUY_SLIM_DEV_AUTO_LOGIN_PASSWORD || ""),
  };

  return {
    name: "signguy-slim-dev-auto-login",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__signguy-slim-dev-auto-login", async (req, res, next) => {
        if (req.method !== "POST") return next();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        if (!enabled) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "dev_auto_login_disabled" }));
          return;
        }
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "dev_auto_login_loopback_only" }));
          return;
        }
        if (!credentials.tenant_slug || !credentials.email || !credentials.password) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: "dev_auto_login_credentials_missing" }));
          return;
        }

        try {
          const response = await fetch("http://127.0.0.1:4175/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
          });
          const body = Buffer.from(await response.arrayBuffer());
          const setCookies = response.headers.getSetCookie?.() || [];
          if (setCookies.length) res.setHeader("Set-Cookie", setCookies);
          res.statusCode = response.status;
          res.end(body);
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "dev_auto_login_backend_unavailable" }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), devAutoLoginPlugin(env)],
    server: {
      proxy: {
        "/api": "http://localhost:4175",
      },
    },
  };
});
