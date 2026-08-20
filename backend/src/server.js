import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { openDatabase, runMigrations } from "./db.js";
import { SlimService } from "./services.js";

const MAX_JSON_BYTES = 1024 * 1024;
const PUBLIC_ERROR_CODES = new Set([
  "amount_paid_exceeds_total",
  "assigned_user_not_same_tenant",
  "converted_estimate_locked",
  "customer_not_found",
  "discount_exceeds_subtotal",
  "estimate_not_found",
  "invalid_invoice_document_status",
  "invalid_order_status",
  "invalid_shop_email_or_password",
  "invoice_not_found",
  "invoice_void",
  "last_active_owner_required",
  "malformed_json",
  "no_updates",
  "order_not_found",
  "owner_role_locked",
  "owner_role_requires_owner",
  "payload_too_large",
  "permission_denied",
  "quantity_decimal_invalid",
  "quantity_decimal_must_be_positive",
  "tenant_or_user_exists",
  "unauthorized",
  "user_not_found",
]);

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      const err = new Error("payload_too_large");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("malformed_json");
    err.status = 400;
    throw err;
  }
}

function send(res, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Length": data.length,
    "Content-Type": Buffer.isBuffer(body) ? "application/pdf" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(data);
}

function tokenFrom(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function notFound() {
  const err = new Error("not_found");
  err.status = 404;
  return err;
}

async function route(service, req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  if (method === "POST" && url.pathname === "/api/auth/register") {
    return send(res, 201, await service.registerTenant(await readJson(req)));
  }
  if (method === "POST" && url.pathname === "/api/auth/login") {
    return send(res, 200, await service.login(await readJson(req)));
  }

  const actor = service.actorForToken(tokenFrom(req));
  if (method === "GET" && url.pathname === "/api/auth/me") return send(res, 200, { user: actor, tenant: service.tenant(actor.tenant_id) });
  if (method === "POST" && url.pathname === "/api/auth/logout") {
    service.logout(tokenFrom(req));
    return send(res, 200, { ok: true });
  }
  if (method === "GET" && parts[0] === "settings") return send(res, 200, service.settings(actor));
  if (method === "PATCH" && parts[0] === "settings") return send(res, 200, service.updateSettings(actor, await readJson(req)));
  if (method === "POST" && parts[0] === "users") return send(res, 201, await service.addUser(actor, await readJson(req)));
  if (method === "PATCH" && parts[0] === "users" && parts.length === 2) return send(res, 200, service.updateUser(actor, parts[1], await readJson(req)));

  if (parts[0] === "customers") {
    if (method === "GET" && parts.length === 1) {
      return send(res, 200, { items: service.listCustomers(actor, Object.fromEntries(url.searchParams)) });
    }
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createCustomer(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.customer(actor, parts[1]));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateCustomer(actor, parts[1], await readJson(req)));
  }

  if (parts[0] === "estimates") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listEstimates(actor) });
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createEstimate(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.estimate(actor, parts[1]));
    if (method === "PATCH" && parts.length === 2) return send(res, 200, service.updateEstimate(actor, parts[1], await readJson(req)));
    if (method === "POST" && parts[2] === "duplicate") return send(res, 201, service.duplicateEstimate(actor, parts[1]));
    if (method === "POST" && parts[2] === "convert") return send(res, 201, service.convertEstimate(actor, parts[1]));
    if (method === "GET" && parts[2] === "pdf") {
      return send(res, 200, service.documentPdf(actor, "estimate", parts[1]), {
        "Content-Disposition": `attachment; filename="estimate-${parts[1]}.pdf"`,
      });
    }
  }

  if (parts[0] === "orders") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listOrders(actor) });
    if (method === "POST" && parts.length === 1) return send(res, 201, service.createOrder(actor, await readJson(req)));
    if (method === "GET" && parts.length === 2) return send(res, 200, service.order(actor, parts[1]));
    if (method === "POST" && parts[2] === "status") {
      return send(res, 200, service.updateOrderStatus(actor, parts[1], (await readJson(req)).status));
    }
    if (method === "POST" && parts[2] === "invoice") return send(res, 201, service.createOrOpenInvoice(actor, parts[1], await readJson(req)));
  }

  if (parts[0] === "invoices") {
    if (method === "GET" && parts.length === 1) return send(res, 200, { items: service.listInvoices(actor) });
    if (method === "GET" && parts.length === 2) return send(res, 200, service.invoice(actor, parts[1]));
    if (method === "POST" && parts[2] === "document-status") {
      return send(res, 200, service.setInvoiceDocumentStatus(actor, parts[1], (await readJson(req)).document_status));
    }
    if (method === "POST" && parts[2] === "payment") {
      return send(res, 200, service.recordInvoicePayment(actor, parts[1], await readJson(req)));
    }
    if (method === "GET" && parts[2] === "pdf") {
      return send(res, 200, service.documentPdf(actor, "invoice", parts[1]), {
        "Content-Disposition": `attachment; filename="invoice-${parts[1]}.pdf"`,
      });
    }
  }

  if (method === "GET" && parts[0] === "audit" && parts.length === 3) {
    return send(res, 200, { items: service.auditTrail(actor, parts[1], parts[2]) });
  }

  throw notFound();
}

export function createSlimServer(db = null) {
  const ownedDb = db ?? openDatabase();
  runMigrations(ownedDb);
  const service = new SlimService(ownedDb);
  return createServer(async (req, res) => {
    try {
      await route(service, req, res);
    } catch (error) {
      const status = error.status && Number.isInteger(error.status) ? error.status : error.name === "ZodError" ? 400 : 500;
      const message = status === 500
        ? "server_error"
        : error.name === "ZodError"
          ? "validation_failed"
          : PUBLIC_ERROR_CODES.has(error.message)
            ? error.message
            : "request_failed";
      send(res, status, { error: message });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4175);
  createSlimServer().listen(port, () => {
    console.log(`SignGuy Slim API listening on http://localhost:${port}`);
  });
}
