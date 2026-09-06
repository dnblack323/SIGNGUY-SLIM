import assert from "node:assert/strict";
import { migratedMemoryDatabase } from "./db.js";
import { createSlimServer } from "./server.js";

const logs = [];
const logger = {
  log(line) {
    logs.push(JSON.parse(line));
  },
  error(line) {
    logs.push(JSON.parse(line));
  },
};

const db = migratedMemoryDatabase();
const server = createSlimServer(db, { logger });

function listen(app) {
  return new Promise((resolve, reject) => {
    app.once("error", reject);
    app.listen(0, "127.0.0.1", () => {
      app.off("error", reject);
      resolve(app.address().port);
    });
  });
}

function close(app) {
  return new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  });
}

try {
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}/api`;

  const health = await fetch(`${base}/health`, { headers: { "X-Request-Id": "release-d-smoke" } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-request-id"), "release-d-smoke");
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.service, "signguy-slim");
  assert(!JSON.stringify(healthBody).match(/password|secret|cookie|token|authorization/i));

  const ready = await fetch(`${base}/ready`);
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.status, "ready");
  assert(readyBody.checks.every((check) => check.status === "ok"));

  const missingAuth = await fetch(`${base}/customers`, {
    headers: { "X-Request-Id": "x".repeat(128) },
  });
  assert.equal(missingAuth.status, 401);
  assert.notEqual(missingAuth.headers.get("x-request-id"), "x".repeat(128));
  const missingAuthBody = await missingAuth.json();
  assert.equal(missingAuthBody.error, "unauthorized");
  assert(missingAuthBody.request_id);

  const errorLog = logs.find((entry) => entry.event === "http_error" && entry.error === "unauthorized");
  assert(errorLog?.request_id);
  assert(!JSON.stringify(logs).match(/password|secret|cookie|authorization|csrf_token/i));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    health: healthBody.status,
    readiness: readyBody.status,
    request_id_logged: Boolean(errorLog.request_id),
  }, null, 2)}\n`);
} finally {
  await close(server);
  db.close();
}
