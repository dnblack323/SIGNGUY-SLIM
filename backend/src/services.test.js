import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { migratedMemoryDatabase } from "./db.js";
import { SlimService } from "./services.js";
import { decryptBackup } from "./backup.js";
import { createSlimServer, readMultipartFile } from "./server.js";
import { documentTotals, lineTotalCents, paymentStatus } from "./money.js";

let db;
let service;
let owner;
let token;
let attachmentRoot;

const address = {
  line1: "10 Main St",
  line2: null,
  city: "Austin",
  state: "TX",
  postal_code: "78701",
  country: "US",
};

async function bootstrap(slug = "shop-a", tax = 825) {
  const session = await service.registerTenant({
    tenant_name: slug,
    tenant_slug: slug,
    owner_name: "Owner",
    owner_email: `${slug}@example.com`,
    owner_password: "password123",
    sales_tax_rate_basis_points: tax,
  });
  return session;
}

function customer(actor, overrides = {}) {
  return service.createCustomer(actor, {
    contact_name: "Jane Customer",
    business_name: "Jane Co",
    email: "jane@example.com",
    phone: "555-0100",
    billing_address: address,
    ...overrides,
  });
}

function item(overrides = {}) {
  return {
    title: "Banner",
    description: "Banner",
    quantity_decimal: "2.5000",
    unit_price_cents: 1200,
    taxable: true,
    production_required: true,
    ...overrides,
  };
}

function tinyPng() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
}

function annotationOps(overrides = {}) {
  return [{
    id: "op-1",
    type: "rectangle",
    color: "#d92d20",
    stroke_width: 4,
    start: { x: 0.1, y: 0.1 },
    end: { x: 0.8, y: 0.8 },
    ...overrides,
  }];
}

function countFiles(path) {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    const full = join(path, entry.name);
    return total + (entry.isDirectory() ? countFiles(full) : 1);
  }, 0);
}

function tempUploadDirs(path) {
  return existsSync(path) ? readdirSync(path).filter((name) => name.startsWith("signguy-slim-upload-")) : [];
}

function multipartRequest(body, { boundary = "test-boundary", headers = {} } = {}) {
  const req = new PassThrough();
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, ...headers };
  queueMicrotask(() => req.end(body));
  return req;
}

function multipartBody(content = "proof", { boundary = "test-boundary", filename = "proof.txt", mime = "text/plain" } = {}) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n${content}\r\n--${boundary}--\r\n`);
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("promise_timeout")), 1000)),
  ]);
}

beforeEach(async () => {
  attachmentRoot = mkdtempSync(join(tmpdir(), "signguy-slim-test-"));
  process.env.SIGNGUY_SLIM_ATTACHMENT_ROOT = attachmentRoot;
  delete process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES;
  db = migratedMemoryDatabase();
  service = new SlimService(db);
  const session = await bootstrap();
  token = session.access_token;
  owner = session.user;
});

afterEach(() => {
  if (attachmentRoot) rmSync(attachmentRoot, { recursive: true, force: true });
  delete process.env.SIGNGUY_SLIM_ATTACHMENT_ROOT;
  delete process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES;
});

describe("authentication and tenant boundaries", () => {
  it("hashes passwords and issues database-backed sessions", async () => {
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(owner.id);
    expect(row.password_hash).not.toContain("password123");
    const login = await service.login({ tenant_slug: "shop-a", email: "shop-a@example.com", password: "password123" });
    expect(login.access_token).toBeTruthy();
    expect(service.actorForToken(token).id).toBe(owner.id);
  });

  it("rejects same-tenant relationship violations", async () => {
    const other = await bootstrap("shop-b");
    const otherCustomer = customer(other.user);
    expect(() => service.createEstimate(owner, { title: "Test Order", customer_id: otherCustomer.id, items: [item()] })).toThrow("customer_not_found");
  });

  it("enforces role permissions for settings and manual payment recording", async () => {
    const staff = await service.addUser(owner, {
      display_name: "Staff",
      email: "staff@example.com",
      password: "password123",
      role: "staff",
    });
    expect(() => service.updateSettings(staff, { company_name: "Nope" })).toThrow("permission_denied");
    const manager = service.updateUser(owner, staff.id, { role: "manager" });
    expect(manager.role).toBe("manager");
  });

  it("enforces owner/admin privilege boundaries and revokes deactivated sessions", async () => {
    const admin = await service.addUser(owner, {
      display_name: "Admin",
      email: "admin@example.com",
      password: "password123",
      role: "admin",
    });
    await expect(service.addUser(admin, {
      display_name: "Owner Two",
      email: "owner2@example.com",
      password: "password123",
      role: "owner",
    })).rejects.toThrow("owner_role_requires_owner");
    expect(() => service.updateUser(owner, owner.id, { role: "admin" })).toThrow("last_active_owner_required");
    expect(() => service.updateUser(owner, owner.id, { active: false })).toThrow("last_active_owner_required");
    const ownerTwo = await service.addUser(owner, {
      display_name: "Owner Two",
      email: "owner2@example.com",
      password: "password123",
      role: "owner",
    });
    const ownerTwoLogin = await service.login({ tenant_slug: "shop-a", email: "owner2@example.com", password: "password123" });
    service.updateUser(owner, ownerTwo.id, { active: false });
    expect(() => service.actorForToken(ownerTwoLogin.access_token)).toThrow("unauthorized");
  });
});

describe("customers, quick entry, estimates, orders, invoices", () => {
  it("creates portable customers and preserves tax-exempt snapshots", () => {
    const c = customer(owner, { tax_exempt: true, tax_exemption_note: "TX resale" });
    const estimate = service.createEstimate(owner, { title: "Test Order", customer_id: c.id, discount_cents: 0, items: [item()] });
    expect(c.portable_id).toMatch(/^sgp_v1_customer_/);
    expect(estimate.customer_tax_exempt_snapshot).toBe(true);
    expect(estimate.tax_cents).toBe(0);
  });

  it("uses decimal-safe quantities and integer cents", () => {
    expect(lineTotalCents("1.3333", 999)).toBe(1332);
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { title: "Test Order", customer_id: c.id, items: [item({ quantity_decimal: "1.3333", unit_price_cents: 999 })] });
    expect(estimate.items[0].line_total_cents).toBe(1332);
    expect(() => service.createEstimate(owner, { title: "Test Order", customer_id: c.id, items: [item({ quantity_decimal: "0" })] })).toThrow();
    expect(() => service.createEstimate(owner, { title: "Test Order", customer_id: c.id, items: [item({ unit_price_cents: Number.MAX_SAFE_INTEGER + 1 })] })).toThrow();
  });

  it("allocates discounts before tax across taxable and non-taxable lines", () => {
    expect(documentTotals([item({ line_total_cents: 10000, taxable: true })], 1000, 1000, false)).toMatchObject({
      subtotal_cents: 10000,
      tax_cents: 900,
      total_cents: 9900,
    });
    expect(documentTotals([item({ line_total_cents: 10000, taxable: false })], 1000, 1000, false).tax_cents).toBe(0);
    expect(documentTotals([
      item({ line_total_cents: 10000, taxable: true }),
      item({ line_total_cents: 10000, taxable: false }),
    ], 2000, 1000, false).tax_cents).toBe(900);
    expect(documentTotals([item({ line_total_cents: 10000, taxable: true })], 0, 1000, true).tax_cents).toBe(0);
    expect(documentTotals([item({ line_total_cents: 10000, taxable: true })], 10000, 1000, false).total_cents).toBe(0);
  });

  it("duplicates estimates with new IDs and converts idempotently to one order", () => {
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const duplicate = service.duplicateEstimate(owner, estimate.id);
    expect(duplicate.id).not.toBe(estimate.id);
    expect(duplicate.items[0].portable_id).not.toBe(estimate.items[0].portable_id);
    const first = service.convertEstimate(owner, estimate.id);
    const second = service.convertEstimate(owner, estimate.id);
    expect(first.already_converted).toBe(false);
    expect(second.already_converted).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE source_estimate_id = ?").get(estimate.id).count).toBe(1);
  });

  it("preserves estimate status, recalculates discount-only changes, and rolls back failed item replacement", () => {
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { title: "Test Order", customer_id: c.id, status: "sent", items: [item()] });
    const updated = service.updateEstimate(owner, estimate.id, { discount_cents: 500 });
    expect(updated.status).toBe("sent");
    expect(updated.discount_cents).toBe(500);
    expect(updated.total_cents).toBeLessThan(estimate.total_cents);
    const originalInsert = service.insertEstimateItems;
    service.insertEstimateItems = () => {
      throw new Error("forced_insert_failure");
    };
    expect(() => service.updateEstimate(owner, estimate.id, { items: [item({ description: "Replacement" })] })).toThrow("forced_insert_failure");
    service.insertEstimateItems = originalInsert;
    const after = service.estimate(owner, estimate.id);
    expect(after.items[0].description).toBe("Banner");
    expect(() => service.updateEstimate(owner, estimate.id, {})).toThrow("no_updates");
    const converted = service.convertEstimate(owner, estimate.id).order;
    expect(converted.id).toBeTruthy();
    expect(() => service.updateEstimate(owner, estimate.id, { internal_notes: "locked" })).toThrow("converted_estimate_locked");
  });

  it("creates direct orders and enforces one invoice per order", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item({ taxable: false })] });
    expect(order.source_estimate_id).toBe(null);
    const first = service.createOrOpenInvoice(owner, order.id);
    const second = service.createOrOpenInvoice(owner, order.id);
    expect(first.already_exists).toBe(false);
    expect(second.already_exists).toBe(true);
    expect(second.invoice.id).toBe(first.invoice.id);
  });

  it("rolls back direct order creation when audit fails", () => {
    const c = customer(owner);
    const originalAudit = service.audit;
    service.audit = () => {
      throw new Error("forced_audit_failure");
    };
    expect(() => service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] })).toThrow("forced_audit_failure");
    service.audit = originalAudit;
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM order_items").get().count).toBe(0);
  });

  it("keeps invoice document status separate from manual payment status", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    const issued = service.setInvoiceDocumentStatus(owner, invoice.id, "issued");
    const paid = service.recordInvoicePayment(owner, invoice.id, { amount_paid_cents: 1200 });
    expect(issued.document_status).toBe("issued");
    expect(paid.payment_status).toBe("partial");
    expect(paid.document_status).toBe("issued");
    expect(paid.balance_due_cents).toBeGreaterThan(0);
    expect(() => service.recordInvoicePayment(owner, invoice.id, { amount_paid_cents: invoice.total_cents + 1 })).toThrow("amount_paid_exceeds_total");
    expect(paymentStatus(invoice.total_cents, invoice.total_cents)).toBe("paid");
  });

  it("renders multipage tenant-scoped PDFs with formatted currency and without internal notes", () => {
    const c = customer(owner);
    service.updateSettings(owner, {
      company_name: "Acme Signs",
      address,
      contact_email: "shop@example.com",
      contact_phone: "555-0199",
      sales_tax_rate_basis_points: 825,
      locale: "en-US",
      currency: "USD",
      shop_timezone: "America/New_York",
    });
    const manyItems = Array.from({ length: 55 }, (_, index) => item({
      description: `Very long wrapped description ${index} with extra words to prove line wrapping inside the generated PDF document`,
    }));
    const estimate = service.createEstimate(owner, { title: "Test Order", customer_id: c.id, internal_notes: "Do not print", items: manyItems });
    const order = service.convertEstimate(owner, estimate.id).order;
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    const estimatePdf = service.documentPdf(owner, "estimate", estimate.id).toString("latin1");
    const invoicePdf = service.documentPdf(owner, "invoice", invoice.id).toString("latin1");
    expect(estimatePdf).toContain("Estimate");
    expect(estimatePdf).toContain("Jane Customer");
    expect(estimatePdf).toContain("$30.00");
    expect((estimatePdf.match(/\/Type \/Page/g) || []).length).toBeGreaterThan(1);
    expect(estimatePdf).not.toContain("Do not print");
    expect(invoicePdf).toContain("Payment information is manually recorded.");
  });
});

describe("HTTP API safety", () => {
  async function withServer(work) {
    const httpDb = migratedMemoryDatabase();
    const server = createSlimServer(httpDb);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    try {
      await work(base);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("authenticates PDFs, rejects unauthenticated access, and handles malformed JSON", async () => {
    await withServer(async (base) => {
      const bad = await fetch(`${base}/auth/register`, { method: "POST", body: "{" });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: "malformed_json" });

      const registered = await fetch(`${base}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_name: "HTTP Shop", tenant_slug: "http-shop", owner_name: "Owner", owner_email: "owner@example.com", owner_password: "password123" }),
      });
      const session = await registered.json();
      const unauth = await fetch(`${base}/estimates/nope/pdf`);
      expect(unauth.status).toBe(401);

      const cust = await fetch(`${base}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ contact_name: "PDF Customer", billing_address: address }),
      }).then((res) => res.json());
      const estimate = await fetch(`${base}/estimates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ title: "Test Order", customer_id: cust.id, items: [item()] }),
      }).then((res) => res.json());
      const pdf = await fetch(`${base}/estimates/${estimate.id}/pdf`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
    });
  });

  it("enforces tenant isolation and logout revocation at route level", async () => {
    await withServer(async (base) => {
      const a = await fetch(`${base}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_name: "A", tenant_slug: "a", owner_name: "A", owner_email: "a@example.com", owner_password: "password123" }),
      }).then((res) => res.json());
      const b = await fetch(`${base}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_name: "B", tenant_slug: "b", owner_name: "B", owner_email: "b@example.com", owner_password: "password123" }),
      }).then((res) => res.json());
      const cust = await fetch(`${base}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.access_token}` },
        body: JSON.stringify({ contact_name: "Tenant A", billing_address: address }),
      }).then((res) => res.json());
      const crossTenant = await fetch(`${base}/customers/${cust.id}`, { headers: { Authorization: `Bearer ${b.access_token}` } });
      expect(crossTenant.status).toBe(404);
      const logout = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${a.access_token}` } });
      expect(logout.status).toBe(200);
      const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${a.access_token}` } });
      expect(me.status).toBe(401);
    });
  });

  it("returns one invoice for concurrent Create/Open Invoice requests", async () => {
    await withServer(async (base) => {
      const registered = await fetch(`${base}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_name: "Race Shop", tenant_slug: "race-shop", owner_name: "Owner", owner_email: "race@example.com", owner_password: "password123" }),
      });
      const session = await registered.json();
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
      const cust = await fetch(`${base}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ contact_name: "Race Customer", billing_address: address }),
      }).then((res) => res.json());
      const order = await fetch(`${base}/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Test Order", customer_id: cust.id, items: [item()] }),
      }).then((res) => res.json());
      const [first, second] = await Promise.all([
        fetch(`${base}/orders/${order.id}/invoice`, { method: "POST", headers, body: "{}" }).then((res) => res.json()),
        fetch(`${base}/orders/${order.id}/invoice`, { method: "POST", headers, body: "{}" }).then((res) => res.json()),
      ]);
      expect(first.invoice.id).toBe(second.invoice.id);
      expect([first.already_exists, second.already_exists].sort()).toEqual([false, true]);
    });
  });

  it("streams multipart uploads and rejects malformed multipart cleanly", async () => {
    await withServer(async (base) => {
      const session = await fetch(`${base}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_name: "Upload Shop", tenant_slug: "upload-shop", owner_name: "Owner", owner_email: "upload@example.com", owner_password: "password123" }),
      }).then((res) => res.json());
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
      const cust = await fetch(`${base}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ contact_name: "Upload Customer", billing_address: address }),
      }).then((res) => res.json());
      const order = await fetch(`${base}/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Test Order", customer_id: cust.id, items: [item()] }),
      }).then((res) => res.json());
      const form = new FormData();
      form.append("file", new Blob(["proof"], { type: "text/plain" }), "proof.txt");
      const uploaded = await fetch(`${base}/orders/${order.id}/attachments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      expect(uploaded.status).toBe(201);
      expect((await uploaded.json()).sha256).toBe(createHash("sha256").update("proof").digest("hex"));
      const malformed = await fetch(`${base}/orders/${order.id}/attachments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "multipart/form-data; boundary=bad" },
        body: "--bad\r\nbroken",
      });
      expect(malformed.status).toBe(400);
      expect(["malformed_multipart", "attachment_empty"]).toContain((await malformed.json()).error);
    });
  });
});

describe("streaming multipart parser resilience", () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "signguy-slim-parser-test-"));
  });

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES;
  });

  it("rejects missing multipart boundary without creating temp upload directories", async () => {
    const req = new PassThrough();
    req.headers = { "content-type": "multipart/form-data" };

    await expect(withTimeout(readMultipartFile(req, { tempRoot }))).rejects.toMatchObject({ message: "malformed_multipart", status: 400 });
    expect(tempUploadDirs(tempRoot)).toEqual([]);
  });

  it("rejects aborted multipart requests and removes temp directories", async () => {
    const req = new PassThrough();
    req.headers = { "content-type": "multipart/form-data; boundary=test-boundary" };
    const promise = withTimeout(readMultipartFile(req, { tempRoot }));
    req.write("--test-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"proof.txt\"\r\nContent-Type: text/plain\r\n\r\npartial");
    req.emit("aborted");

    await expect(promise).rejects.toMatchObject({ message: "malformed_multipart", status: 400 });
    expect(tempUploadDirs(tempRoot)).toEqual([]);
  });

  it("rejects request stream errors and removes temp directories", async () => {
    const req = new PassThrough();
    req.headers = { "content-type": "multipart/form-data; boundary=test-boundary" };
    const promise = withTimeout(readMultipartFile(req, { tempRoot }));
    req.emit("error", new Error("socket failed"));

    await expect(promise).rejects.toMatchObject({ message: "malformed_multipart", status: 400 });
    expect(tempUploadDirs(tempRoot)).toEqual([]);
  });

  it("rejects oversized files with 413 and removes temp directories", async () => {
    process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES = "4";
    const req = multipartRequest(multipartBody("too-large"), {});

    await expect(withTimeout(readMultipartFile(req, { tempRoot }))).rejects.toMatchObject({ message: "attachment_too_large", status: 413 });
    expect(tempUploadDirs(tempRoot)).toEqual([]);
  });

  it("rejects output stream failures and removes temp directories", async () => {
    const req = multipartRequest(multipartBody("proof"), {});
    const failingWriter = () => new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("disk failed"));
      },
    });

    await expect(withTimeout(readMultipartFile(req, { tempRoot, createWriteStreamImpl: failingWriter }))).rejects.toMatchObject({ message: "malformed_multipart", status: 400 });
    expect(tempUploadDirs(tempRoot)).toEqual([]);
  });
});

describe("Version 1 Part 3 order workspace and production", () => {
  it("loads workspace data, includes timestamps, enforces tenant isolation, and rejects stale saves", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const workspace = service.orderWorkspace(owner, order.id);
    expect(workspace.customer.contact_name).toBe("Jane Customer");
    expect(workspace.order.created_at).toBeTruthy();
    expect(workspace.order.updated_at).toBe(order.updated_at);
    expect(workspace.order.production_progress).toEqual({ completed: 0, total: 1, percent: 0 });
    const other = await bootstrap("shop-b");
    expect(() => service.orderWorkspace(other.user, order.id)).toThrow("order_not_found");
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: "stale", internal_notes: "stale" })).toThrow("order_conflict");
    expect(() => service.updateOrderWorkspace(owner, order.id, { internal_notes: "missing expected timestamp" })).toThrow();
  });

  it("saves order and item edits transactionally, advances real timestamps, and recalculates totals", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, discount_cents: 100, items: [item(), item({ description: "Install", taxable: false })] });
    const originalItems = order.items.map((entry) => ({ id: entry.id, portable_id: entry.portable_id, source_estimate_item_id: entry.source_estimate_item_id, created_at: entry.created_at }));
    const updated = service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: order.updated_at,
      discount_cents: 200,
      items: [
        { ...order.items[1], position: undefined, quantity_decimal: "3", unit_price_cents: 1000, production_stage: "ready", completed: false },
        { ...order.items[0], description: "Banner edited", production_stage: "in_progress", completed: false },
      ],
    }).order;
    expect(updated.items.map((entry) => entry.description)).toEqual(["Install", "Banner edited"]);
    expect(updated.subtotal_cents).toBe(6000);
    expect(updated.discount_cents).toBe(200);
    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(order.updated_at));
    expect(updated.items.map((entry) => entry.id)).toEqual([originalItems[1].id, originalItems[0].id]);
    expect(updated.items.map((entry) => entry.portable_id)).toEqual([originalItems[1].portable_id, originalItems[0].portable_id]);
    expect(updated.items.map((entry) => entry.created_at)).toEqual([originalItems[1].created_at, originalItems[0].created_at]);
    const originalUpdate = service.updateOrderItemsDifferential;
    service.updateOrderItemsDifferential = () => {
      throw new Error("forced_item_failure");
    };
    expect(() => service.updateOrderWorkspace(owner, updated.id, { expected_updated_at: updated.updated_at, items: [{ ...updated.items[0], description: "Nope" }] })).toThrow("forced_item_failure");
    service.updateOrderItemsDifferential = originalUpdate;
    expect(service.order(owner, updated.id).items[0].description).toBe("Install");
  });

  it("preserves converted Estimate item links and portable IDs after editing and reordering", () => {
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { title: "Test Order", customer_id: c.id, items: [item({ description: "First" }), item({ description: "Second" })] });
    const order = service.convertEstimate(owner, estimate.id).order;
    const before = order.items.map((entry) => ({ id: entry.id, portable_id: entry.portable_id, source_estimate_item_id: entry.source_estimate_item_id, created_at: entry.created_at }));
    const saved = service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: order.updated_at,
      items: [
        { ...order.items[1], description: "Second edited", production_stage: "ready", completed: false },
        { ...order.items[0], production_stage: "not_started", completed: false },
      ],
    }).order;
    expect(saved.items.map((entry) => entry.id)).toEqual([before[1].id, before[0].id]);
    expect(saved.items.map((entry) => entry.portable_id)).toEqual([before[1].portable_id, before[0].portable_id]);
    expect(saved.items.map((entry) => entry.source_estimate_item_id)).toEqual([estimate.items[1].id, estimate.items[0].id]);
    expect(saved.items.map((entry) => entry.created_at)).toEqual([before[1].created_at, before[0].created_at]);
  });

  it("adds, duplicates, removes, edits, and reorders Order items without accepting client-selected new IDs", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item({ description: "Keep" }), item({ description: "Remove" })] });
    expect(() => service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: order.updated_at,
      items: [{ ...order.items[0] }, { ...item({ id: "client-picked-id", description: "Invalid new ID" }), production_stage: "not_started", completed: false }],
    })).toThrow("order_item_not_found");
    const saved = service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: order.updated_at,
      items: [
        { ...order.items[0], description: "Keep edited", production_stage: "ready", completed: false },
        { ...item({ description: "Added" }), production_stage: "not_started", completed: false },
        { ...item({ description: "Duplicate" }), production_stage: "not_started", completed: false },
      ],
    }).order;
    expect(saved.items.map((entry) => entry.description)).toEqual(["Keep edited", "Added", "Duplicate"]);
    expect(saved.items[0].id).toBe(order.items[0].id);
    expect(saved.items[1].id).not.toBe(order.items[0].id);
    expect(saved.items[2].portable_id).not.toBe(saved.items[1].portable_id);
    expect(saved.items.some((entry) => entry.id === order.items[1].id)).toBe(false);
  });

  it("keeps invoiced order financial data locked while allowing production-safe edits", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    service.createOrOpenInvoice(owner, order.id);
    expect(() => service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: service.order(owner, order.id).updated_at,
      items: [{ ...service.order(owner, order.id).items[0], description: "Changed" }],
    })).toThrow("invoiced_order_financial_lock");
    const safe = service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: service.order(owner, order.id).updated_at,
      due_date: "2026-08-30",
      items: [{ ...service.order(owner, order.id).items[0], production_stage: "waiting", production_required: true, completed: false, internal_note: "safe" }],
    }).order;
    expect(safe.due_date).toBe("2026-08-30");
    expect(safe.items[0].production_stage).toBe("waiting");
  });

  it("lists only production-required items, moves stages, completes, reopens, and leaves order status unchanged", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, status: "active", items: [item(), item({ description: "No production", production_required: false })] });
    const workspace = service.orderWorkspace(owner, order.id);
    let board = service.productionBoard(owner);
    expect(board.items.map((entry) => entry.description)).toEqual(["Banner"]);
    service.setProductionStage(owner, board.items[0].id, "complete");
    let after = service.order(owner, order.id);
    expect(after.items[0].completed).toBe(true);
    expect(after.status).toBe("active");
    expect(after.production_progress).toEqual({ completed: 1, total: 1, percent: 100 });
    service.setItemCompletion(owner, after.items[0].id, false);
    after = service.order(owner, order.id);
    expect(after.items[0].production_stage).toBe("in_progress");
    expect(after.items[0].completed).toBe(false);
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(workspace.order.updated_at));
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: workspace.order.updated_at, internal_notes: "stale after production" })).toThrow("order_conflict");
    const auditActions = db.prepare("SELECT action FROM audit_events WHERE entity_type = 'order_item' ORDER BY occurred_at").all().map((row) => row.action);
    expect(auditActions).toEqual(["production.stage_move", "production.complete", "production.stage_move", "production.reopen"]);
  });

  it("rejects stale workspace saves after status changes", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const workspace = service.orderWorkspace(owner, order.id);
    const status = service.updateOrderStatus(owner, order.id, "on_hold");
    expect(status.status).toBe("on_hold");
    expect(Date.parse(status.updated_at)).toBeGreaterThan(Date.parse(workspace.order.updated_at));
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: workspace.order.updated_at, internal_notes: "stale after status" })).toThrow("order_conflict");
  });

  it("rolls back production mutations when audit insertion fails and validates completion booleans", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    expect(() => service.setItemCompletion(owner, order.items[0].id, "yes")).toThrow("invalid_completion");
    const originalAudit = service.audit;
    service.audit = (...args) => {
      if (args[1] === "production.complete") throw new Error("forced_audit_failure");
      return originalAudit.call(service, ...args);
    };
    expect(() => service.setProductionStage(owner, order.items[0].id, "complete")).toThrow("forced_audit_failure");
    service.audit = originalAudit;
    const after = service.order(owner, order.id);
    expect(after.items[0].production_stage).toBe("not_started");
    expect(after.items[0].completed).toBe(false);
  });

  it("records production audit events for Workspace stage and completion changes", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: order.updated_at,
      items: [{ ...order.items[0], production_stage: "complete", completed: true }],
    });
    const auditActions = db.prepare("SELECT action FROM audit_events WHERE entity_type = 'order_item' ORDER BY occurred_at").all().map((row) => row.action);
    expect(auditActions).toEqual(["production.stage_move", "production.complete"]);
  });

  it("uses effective due dates and filters Unassigned under assigned users", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, due_date: "2020-01-01", items: [item({ due_date: null, assigned_user_id: null }), item({ description: "Assigned", assigned_user_id: owner.id })] });
    const board = service.productionBoard(owner);
    expect(board.items.find((entry) => entry.id === order.items[0].id).due_date).toBe("2020-01-01");
    expect(service.productionBoard(owner, { due_state: "late" }).items.length).toBe(2);
    expect(service.productionBoard(owner, { assigned_user_id: "unassigned" }).items.map((entry) => entry.description)).toEqual(["Banner"]);
  });
});

describe("Version 1 Part 3 attachments", () => {
  it("stores attachment metadata with checksum and no exposed filesystem path", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const buffer = Buffer.from("%PDF-1.4");
    const attachment = service.uploadOrderAttachment(owner, order.id, { filename: "../proof.pdf", mime_type: "application/pdf", buffer });
    expect(attachment.original_filename).toBe("proof.pdf");
    expect(attachment.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
    expect(attachment).not.toHaveProperty("storage_key");
    expect(attachment.portable_id).toMatch(/^sgp_v1_order_attachment_/);
  });

  it("blocks active content, path traversal names, and oversized uploads", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "x.svg", mime_type: "image/svg+xml", buffer: Buffer.from("<svg />") })).toThrow("attachment_type_not_allowed");
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "../run.js", mime_type: "text/plain", buffer: Buffer.from("alert(1)") })).toThrow("attachment_type_not_allowed");
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "fake.pdf", mime_type: "application/pdf", buffer: Buffer.from("not a pdf") })).toThrow("attachment_type_not_allowed");
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "fake.txt", mime_type: "text/plain", buffer: Buffer.from("<svg><script /></svg>") })).toThrow("attachment_type_not_allowed");
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "data.json", mime_type: "application/json", buffer: Buffer.from("{bad") })).toThrow("attachment_type_not_allowed");
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "wrong.csv", mime_type: "application/json", buffer: Buffer.from("{}") })).toThrow("attachment_type_not_allowed");
    process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES = "2";
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "big.txt", mime_type: "text/plain", buffer: Buffer.from("123") })).toThrow("attachment_too_large");
  });

  it("enforces tenant authorization, safe headers, integrity checks, soft deletion, and missing-file handling", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const attachment = service.uploadOrderAttachment(owner, order.id, { filename: "proof.txt", mime_type: "text/plain", buffer: Buffer.from("proof") });
    const other = await bootstrap("shop-b");
    expect(() => service.attachmentDownload(other.user, order.id, attachment.id)).toThrow("order_not_found");
    const download = service.attachmentDownload(owner, order.id, attachment.id);
    expect(download.headers["Content-Disposition"]).toContain('filename="proof.txt"');
    expect(download.headers["X-Content-Type-Options"]).toBe("nosniff");
    await new Promise((resolve) => download.stream.on("end", resolve).on("error", resolve).resume());
    const row = db.prepare("SELECT storage_key FROM order_attachments WHERE id = ?").get(attachment.id);
    db.prepare("UPDATE order_attachments SET byte_size = ? WHERE id = ?").run(999, attachment.id);
    expect(() => service.attachmentDownload(owner, order.id, attachment.id)).toThrow("attachment_integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'attachment.download'").get().count).toBe(1);
    db.prepare("UPDATE order_attachments SET byte_size = ? WHERE id = ?").run(5, attachment.id);
    writeFileSync(service.attachmentPath(row.storage_key), "tampered");
    expect(() => service.attachmentDownload(owner, order.id, attachment.id, { preview: true })).toThrow("attachment_integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'attachment.preview'").get().count).toBe(0);
    writeFileSync(service.attachmentPath(row.storage_key), "proof");
    unlinkSync(service.attachmentPath(row.storage_key));
    expect(() => service.attachmentDownload(owner, order.id, attachment.id)).toThrow("attachment_file_missing");
    const second = service.uploadOrderAttachment(owner, order.id, { filename: "delete.txt", mime_type: "text/plain", buffer: Buffer.from("delete") });
    service.deleteOrderAttachment(owner, order.id, second.id);
    expect(service.listOrderAttachments(owner, order.id).some((entry) => entry.id === second.id)).toBe(false);
    expect(db.prepare("SELECT deleted_at FROM order_attachments WHERE id = ?").get(second.id).deleted_at).toBeTruthy();
  });

  it("rolls back upload metadata when audit fails and removes orphan files", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const originalAudit = service.audit;
    service.audit = (...args) => {
      if (args[1] === "attachment.upload") throw new Error("forced_audit_failure");
      return originalAudit.call(service, ...args);
    };
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "proof.txt", mime_type: "text/plain", buffer: Buffer.from("proof") })).toThrow("forced_audit_failure");
    service.audit = originalAudit;
    expect(db.prepare("SELECT COUNT(*) AS count FROM order_attachments").get().count).toBe(0);
    expect(countFiles(attachmentRoot)).toBe(0);
  });

  it("cleans streamed temp files on metadata mismatch failures", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const tempDir = mkdtempSync(join(attachmentRoot, "incoming-"));
    const tempPath = join(tempDir, "upload.tmp");
    writeFileSync(tempPath, "proof");
    expect(() => service.uploadOrderAttachment(owner, order.id, {
      filename: "proof.txt",
      mime_type: "text/plain",
      temp_path: tempPath,
      byte_size: 999,
      sha256: createHash("sha256").update("proof").digest("hex"),
      cleanup_dir: tempDir,
    })).toThrow("attachment_integrity_mismatch");
    expect(existsSync(tempDir)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM order_attachments").get().count).toBe(0);
  });

  it("rejects attachment storage through symlink ancestors when supported", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const attachment = service.uploadOrderAttachment(owner, order.id, { filename: "proof.txt", mime_type: "text/plain", buffer: Buffer.from("proof") });
    const escapeDir = mkdtempSync(join(attachmentRoot, "escape-target-"));
    const linkPath = join(attachmentRoot, "link");
    try {
      symlinkSync(escapeDir, linkPath, "junction");
    } catch {
      return;
    }
    db.prepare("UPDATE order_attachments SET storage_key = ? WHERE id = ?").run("link/proof.txt", attachment.id);
    expect(() => service.attachmentDownload(owner, order.id, attachment.id)).toThrow("attachment_path_invalid");
  });

  it("rejects a symlinked attachment root before buffer fallback writes through it when supported", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const target = mkdtempSync(join(attachmentRoot, "root-target-"));
    const linkPath = join(attachmentRoot, "root-link");
    try {
      symlinkSync(target, linkPath, "junction");
    } catch {
      return;
    }
    process.env.SIGNGUY_SLIM_ATTACHMENT_ROOT = linkPath;

    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "proof.txt", mime_type: "text/plain", buffer: Buffer.from("proof") })).toThrow("attachment_path_invalid");
    expect(countFiles(target)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM order_attachments").get().count).toBe(0);
  });
});

describe("Version 1 Part 4 calendar and dashboard", () => {
  function calendarPayload(overrides = {}) {
    return {
      title: "Install appointment",
      start_at: "2026-08-21T09:00",
      end_at: "2026-08-21T10:00",
      all_day: false,
      ...overrides,
    };
  }

  it("creates, lists, edits, reschedules, completes, reopens, and cancels calendar events without changing Orders or production", () => {
    service.updateSettings(owner, { shop_timezone: "America/New_York" });
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, status: "active", items: [item({ due_date: "2026-08-21" })] });
    const event = service.createCalendarEvent(owner, calendarPayload({ order_id: order.id, order_item_id: order.items[0].id, assigned_user_id: owner.id }));
    expect(event.portable_id).toMatch(/^sgp_v1_calendar_event_/);
    expect(event.entry_type).toBe("event");
    expect(event.order_number).toBe(order.order_number);
    expect(event.local_start_date).toBe("2026-08-21");
    const orderItemEntries = service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", linked_record_type: "order_item" }).items;
    expect(orderItemEntries.filter((entry) => !entry.derived)).toHaveLength(1);
    expect(orderItemEntries.some((entry) => entry.derived && entry.source_type === "production")).toBe(true);
    const rescheduled = service.updateCalendarEvent(owner, event.id, calendarPayload({ title: "Rescheduled install", order_id: order.id, order_item_id: order.items[0].id, start_at: "2026-08-22T11:00", end_at: "2026-08-22T12:00" }));
    expect(rescheduled.title).toBe("Rescheduled install");
    expect(rescheduled.local_start_date).toBe("2026-08-22");
    const completed = service.setCalendarStatus(owner, event.id, "complete");
    expect(completed.status).toBe("complete");
    expect(service.order(owner, order.id).status).toBe("active");
    expect(service.order(owner, order.id).items[0].completed).toBe(false);
    expect(service.setCalendarStatus(owner, event.id, "scheduled").status).toBe("scheduled");
    expect(service.setCalendarStatus(owner, event.id, "cancelled").status).toBe("cancelled");
    const auditActions = db.prepare("SELECT action FROM audit_events WHERE entity_type = 'calendar_event' ORDER BY occurred_at").all().map((row) => row.action);
    expect(auditActions).toEqual(["calendar.create", "calendar.reschedule", "calendar.complete", "calendar.reopen", "calendar.cancel"]);
  });

  it("validates calendar ranges, statuses, same-tenant links, active users, and all-day dates", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item()] });
    const other = await bootstrap("shop-b");
    const otherCustomer = customer(other.user);
    const otherOrder = service.createOrder(other.user, { title: "Test Order", customer_id: otherCustomer.id, items: [item()] });
    expect(() => service.createCalendarEvent(owner, calendarPayload({ end_at: "2026-08-21T09:00" }))).toThrow("invalid_calendar_range");
    expect(() => service.setCalendarStatus(owner, "missing", "moved")).toThrow("invalid_calendar_status");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ order_id: otherOrder.id }))).toThrow("calendar_link_not_found");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ assigned_user_id: other.user.id }))).toThrow("calendar_assigned_user_not_found");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ order_id: order.id, order_item_id: otherOrder.items[0].id }))).toThrow("calendar_link_not_found");
    const allDay = service.createCalendarEvent(owner, calendarPayload({ title: "All day", all_day: true, start_at: "2026-08-23", end_at: "2026-08-24" }));
    expect(allDay.start_at).toBe("2026-08-23");
    expect(allDay.local_start_date).toBe("2026-08-23");
    const task = service.createCalendarEvent(owner, calendarPayload({ entry_type: "task", title: "Permit deadline", task_priority: "urgent", all_day: true, start_at: "2026-08-24", end_at: "2026-08-25" }));
    expect(task.entry_type).toBe("task");
    expect(task.task_priority).toBe("urgent");
    const appointment = service.createCalendarEvent(owner, calendarPayload({ entry_type: "appointment", title: "Site survey", appointment_type: "Survey", customer_name: "Jane Co", customer_contact: "jane@example.com", location: "10 Main St" }));
    expect(appointment.entry_type).toBe("appointment");
    expect(appointment.customer_contact).toBe("jane@example.com");
  });

  it("keeps calendar audit writes atomic", () => {
    const originalAudit = service.audit;
    service.audit = (...args) => {
      if (args[1] === "calendar.create") throw new Error("forced_audit_failure");
      return originalAudit.call(service, ...args);
    };
    expect(() => service.createCalendarEvent(owner, calendarPayload())).toThrow("forced_audit_failure");
    service.audit = originalAudit;
    expect(db.prepare("SELECT COUNT(*) AS count FROM calendar_events").get().count).toBe(0);
  });

  it("manages shared views, personal views, departments, memberships, resources, My Schedule, and conflicts without duplicated entries", async () => {
    const staff = await service.addUser(owner, { display_name: "Installer", email: "installer@example.com", password: "password123", role: "staff" });
    const departments = service.listDepartments(owner).items;
    const installDept = departments.find((department) => department.name === "Installation");
    expect(service.listScheduleViews(owner).items.map((view) => view.name)).toContain("All Shop Schedules");
    service.updateDepartment(owner, installDept.id, {
      name: installDept.name,
      color: installDept.color,
      active: true,
      display_order: installDept.display_order,
      memberships: [{ user_id: staff.id, primary_department: true, active: true }],
    });
    const resource = service.createResource(owner, { name: "Bucket Truck", resource_type: "vehicle", capacity: 1, department_id: installDept.id });
    const installView = service.createScheduleView(owner, {
      name: "North Installations",
      visibility: "shared",
      color: "#336699",
      filters: { schedule_categories: ["installation"], entry_types: [], department_ids: [installDept.id], employee_ids: [], resource_ids: [], statuses: [], linked: "all" },
    });
    const personal = service.createScheduleView(staff, {
      name: "My installs",
      visibility: "personal",
      filters: { schedule_categories: ["installation"], entry_types: [], department_ids: [], employee_ids: [staff.id], resource_ids: [], statuses: [], linked: "all" },
    });
    expect(service.listScheduleViews(staff).items.map((view) => view.name)).toContain("My installs");
    expect(service.listScheduleViews(owner).items.map((view) => view.name)).not.toContain("My installs");
    expect(() => service.scheduleView(owner, personal.id)).toThrow("permission_denied");

    const entry = service.createCalendarEvent(owner, {
      title: "Install channel letters",
      entry_type: "appointment",
      schedule_category: "installation",
      department_id: installDept.id,
      start_at: "2026-08-21T09:00",
      end_at: "2026-08-21T10:00",
      assigned_user_id: owner.id,
      assignee_user_ids: [owner.id, staff.id],
      resource_reservations: [{ resource_id: resource.id, quantity: 1 }],
    });
    expect(entry.assignees.map((assignee) => assignee.user_id).sort()).toEqual([owner.id, staff.id].sort());
    expect(entry.assigned_user_id).toBe(owner.id);
    expect(entry.resource_reservations[0].resource_id).toBe(resource.id);
    expect(service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", view_id: installView.id }).items.filter((item) => item.id === entry.id)).toHaveLength(1);
    expect(service.listCalendarEvents(staff, { start_at: "2026-08-21", end_at: "2026-08-22", my_schedule: true }).items.map((item) => item.id)).toContain(entry.id);

    expect(() => service.createCalendarEvent(owner, {
      title: "Overlapping truck",
      schedule_category: "installation",
      start_at: "2026-08-21T09:30",
      end_at: "2026-08-21T10:30",
      assignee_user_ids: [staff.id],
      resource_reservations: [{ resource_id: resource.id, quantity: 1 }],
    })).toThrow("schedule_conflict");
    expect(() => service.createCalendarEvent(staff, {
      title: "Staff override",
      schedule_category: "installation",
      start_at: "2026-08-21T09:30",
      end_at: "2026-08-21T10:30",
      assignee_user_ids: [staff.id],
      conflict_override: true,
      conflict_override_reason: "Needs same slot",
    })).toThrow("permission_denied");
    const override = service.createCalendarEvent(owner, {
      title: "Manager override",
      schedule_category: "installation",
      start_at: "2026-08-21T09:30",
      end_at: "2026-08-21T10:30",
      assignee_user_ids: [staff.id],
      conflict_override: true,
      conflict_override_reason: "Owner approved double coverage",
    });
    expect(override.conflict_override_reason).toBe("Owner approved double coverage");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'calendar.create' AND diff_json LIKE '%Owner approved double coverage%'").get().count).toBe(1);
    const defaultViews = service.listScheduleViews(owner).items;
    expect(defaultViews.find((view) => view.system_key === "all_shop").color).toBe("#75638F");
    expect(defaultViews.find((view) => view.system_key === "production").color).toBe("#7B3DA6");
    expect(defaultViews.find((view) => view.system_key === "installation").color).toBe("#3F7FC4");
    expect(defaultViews.find((view) => view.system_key === "sales").color).toBe("#E06F00");
    expect(defaultViews.find((view) => view.system_key === "customer_appointments").color).toBe("#E06F00");
    const defaultDepartments = service.listDepartments(owner).items;
    expect(defaultDepartments.find((department) => department.name === "Production").color).toBe("#7B3DA6");
    expect(defaultDepartments.find((department) => department.name === "Installation").color).toBe("#3F7FC4");
    expect(defaultDepartments.find((department) => department.name === "Sales").color).toBe("#E06F00");
    expect(() => service.updateScheduleView(owner, defaultViews.find((view) => view.system_key === "all_shop").id, { active: false })).toThrow("system_view_protected");
  });

  it("rejects cross-tenant Stage 2 relationship IDs and unauthorized staff management directly", async () => {
    const staff = await service.addUser(owner, { display_name: "Staff", email: "calendar-staff@example.com", password: "password123", role: "staff" });
    const other = await bootstrap("foreign-shop");
    const foreignDept = service.listDepartments(other.user).items.find((department) => department.name === "Installation");
    const foreignResource = service.createResource(other.user, { name: "Foreign Truck", resource_type: "vehicle", capacity: 1, department_id: foreignDept.id });
    const foreignUser = await service.addUser(other.user, { display_name: "Foreign Staff", email: "foreign-staff@example.com", password: "password123", role: "staff" });
    const foreignCustomer = customer(other.user);
    const foreignOrder = service.createOrder(other.user, { title: "Test Order", customer_id: foreignCustomer.id, items: [item()] });

    expect(() => service.createDepartment(staff, { name: "Nope", color: "#111111" })).toThrow("permission_denied");
    expect(() => service.createResource(staff, { name: "Nope", resource_type: "equipment", capacity: 1 })).toThrow("permission_denied");
    expect(() => service.createScheduleView(staff, { name: "Shared Nope", visibility: "shared", filters: { schedule_categories: [], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all" } })).toThrow("permission_denied");
    const systemView = service.listScheduleViews(owner).items.find((view) => view.system_key === "production");
    expect(() => service.updateScheduleView(owner, systemView.id, { name: "Renamed Production" })).toThrow("system_view_protected");

    expect(() => service.createCalendarEvent(owner, calendarPayload({ department_id: foreignDept.id }))).toThrow("department_not_found");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ assignee_user_ids: [foreignUser.id] }))).toThrow("calendar_assigned_user_not_found");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ resource_reservations: [{ resource_id: foreignResource.id, quantity: 1 }] }))).toThrow("resource_not_found");
    expect(() => service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", department_ids: [foreignDept.id] })).toThrow("department_not_found");
    expect(() => service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", employee_ids: [foreignUser.id] })).toThrow("user_not_found");
    expect(() => service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", resource_ids: [foreignResource.id] })).toThrow("resource_not_found");
    expect(() => service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", order_id: foreignOrder.id })).toThrow("calendar_link_not_found");
    expect(() => service.listCalendarEvents(staff, { start_at: "2026-08-21", end_at: "2026-08-22", employee_ids: [owner.id] })).toThrow("permission_denied");
    expect(() => service.createScheduleView(owner, { name: "Foreign Filter", visibility: "shared", filters: { schedule_categories: [], entry_types: [], department_ids: [foreignDept.id], employee_ids: [], resource_ids: [], statuses: [], linked: "all" } })).toThrow("department_not_found");
    expect(() => service.createScheduleView(owner, { name: "Bad Filter", visibility: "personal", filters: { schedule_categories: [], entry_types: [], department_ids: [], employee_ids: [], resource_ids: [], statuses: [], linked: "all", sql: "DROP TABLE calendar_events" } })).toThrow();
  });

  it("synchronizes primary and additional assignees without drift and preserves rollback state", async () => {
    const staff = await service.addUser(owner, { display_name: "Installer Two", email: "installer-two@example.com", password: "password123", role: "staff" });
    const entry = service.createCalendarEvent(owner, calendarPayload({ assigned_user_id: owner.id }));
    expect(entry.assigned_user_id).toBe(owner.id);
    expect(entry.assignees).toMatchObject([{ user_id: owner.id, primary_assignee: true }]);

    const reassigned = service.updateCalendarEvent(owner, entry.id, calendarPayload({
      title: "Reassigned install",
      primary_assignee_user_id: staff.id,
      assignee_user_ids: [owner.id, staff.id, staff.id],
    }));
    expect(reassigned.assigned_user_id).toBe(staff.id);
    expect(reassigned.assignees.map((assignee) => assignee.user_id).sort()).toEqual([owner.id, staff.id].sort());
    expect(reassigned.assignees.filter((assignee) => assignee.primary_assignee)).toHaveLength(1);

    const originalWrite = service.writeCalendarResources;
    service.writeCalendarResources = () => {
      throw new Error("forced_resource_write_failure");
    };
    expect(() => service.updateCalendarEvent(owner, entry.id, calendarPayload({ title: "Failed write", primary_assignee_user_id: owner.id, assignee_user_ids: [owner.id] }))).toThrow("forced_resource_write_failure");
    service.writeCalendarResources = originalWrite;
    expect(service.calendarEvent(owner, entry.id).assigned_user_id).toBe(staff.id);

    const unassigned = service.updateCalendarEvent(owner, entry.id, calendarPayload({ title: "Unassigned", assigned_user_id: null, primary_assignee_user_id: null, assignee_user_ids: [] }));
    expect(unassigned.assigned_user_id).toBe(null);
    expect(unassigned.assignees).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM calendar_event_assignees WHERE calendar_event_id = ?").get(entry.id).count).toBe(0);
  });

  it("deduplicates My Schedule responsibility and excludes inactive department memberships", async () => {
    const staff = await service.addUser(owner, { display_name: "Department Staff", email: "department-staff@example.com", password: "password123", role: "staff" });
    const installDept = service.listDepartments(owner).items.find((department) => department.name === "Installation");
    service.updateDepartment(owner, installDept.id, { memberships: [{ user_id: staff.id, primary_department: true, active: true }] });
    const entry = service.createCalendarEvent(owner, {
      ...calendarPayload({ title: "Many matching relationships", assigned_user_id: staff.id, department_id: installDept.id }),
      assignee_user_ids: [staff.id],
    });
    expect(service.listCalendarEvents(staff, { start_at: "2026-08-21", end_at: "2026-08-22", my_schedule: true }).items.filter((item) => item.id === entry.id)).toHaveLength(1);
    service.updateDepartment(owner, installDept.id, { memberships: [{ user_id: staff.id, primary_department: false, active: false }] });
    service.updateCalendarEvent(owner, entry.id, { assigned_user_id: null, primary_assignee_user_id: null, assignee_user_ids: [] });
    expect(service.listCalendarEvents(staff, { start_at: "2026-08-21", end_at: "2026-08-22", my_schedule: true }).items.filter((item) => item.id === entry.id)).toHaveLength(0);
  });

  it("enforces resource capacity, unavailable periods, adjacent intervals, and audited overrides", async () => {
    const resource = service.createResource(owner, {
      name: "Wrap Bay",
      resource_type: "production_area",
      capacity: 2,
      unavailable: [{ start_at: "2026-08-22T09:00", end_at: "2026-08-22T10:00", reason: "Maintenance", hard_block: true }],
    });
    service.createCalendarEvent(owner, calendarPayload({ title: "First bay slot", resource_reservations: [{ resource_id: resource.id, quantity: 1 }] }));
    service.createCalendarEvent(owner, calendarPayload({ title: "Second bay slot", resource_reservations: [{ resource_id: resource.id, quantity: 1 }] }));
    expect(() => service.createCalendarEvent(owner, calendarPayload({ title: "Over capacity", resource_reservations: [{ resource_id: resource.id, quantity: 1 }] }))).toThrow("schedule_conflict");
    expect(service.createCalendarEvent(owner, calendarPayload({ title: "Adjacent bay slot", start_at: "2026-08-21T10:00", end_at: "2026-08-21T11:00", resource_reservations: [{ resource_id: resource.id, quantity: 2 }] }))).toBeTruthy();
    expect(() => service.createCalendarEvent(owner, calendarPayload({ title: "Maintenance overlap", start_at: "2026-08-22T09:30", end_at: "2026-08-22T09:45", resource_reservations: [{ resource_id: resource.id, quantity: 1 }] }))).toThrow("schedule_conflict");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ title: "Weak reason", resource_reservations: [{ resource_id: resource.id, quantity: 1 }], conflict_override: true, conflict_override_reason: "   " }))).toThrow("conflict_override_reason_required");
    const override = service.createCalendarEvent(owner, calendarPayload({ title: "Override capacity", resource_reservations: [{ resource_id: resource.id, quantity: 1 }], conflict_override: true, conflict_override_reason: "Manager approved short overlap" }));
    expect(override.conflict_override_reason).toBe("Manager approved short overlap");
    const audit = db.prepare("SELECT actor_user_id, diff_json, occurred_at FROM audit_events WHERE action = 'calendar.create' AND entity_id = ?").get(override.id);
    expect(audit.actor_user_id).toBe(owner.id);
    expect(audit.occurred_at).toBeTruthy();
    expect(JSON.parse(audit.diff_json).conflicts[0].resource_id).toBe(resource.id);
  });

  it("keeps calendar responses free of restricted financial fields for staff", async () => {
    const staff = await service.addUser(owner, { display_name: "Calendar Staff", email: "calendar-redaction@example.com", password: "password123", role: "staff" });
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, items: [item({ unit_price_cents: 9999 })] });
    service.createOrOpenInvoice(owner, order.id);
    service.createCalendarEvent(owner, calendarPayload({ title: "Linked but redacted", order_id: order.id, order_item_id: order.items[0].id, assigned_user_id: staff.id }));
    const event = service.listCalendarEvents(staff, { start_at: "2026-08-21", end_at: "2026-08-22", my_schedule: true }).items[0];
    expect(event.order_number).toBe(order.order_number);
    expect(JSON.stringify(event)).not.toMatch(/unit_price_cents|line_total_cents|subtotal_cents|total_cents|invoice|payment|cost|margin|pricing/i);
  });

  it("derives dashboard production, rolling calendar, attention distinctions, duplicate prevention, and payment wording", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Test Order", customer_id: c.id, due_date: "2020-01-01", status: "active", items: [item({ due_date: "2020-01-01" })] });
    service.createCalendarEvent(owner, { title: "Missed install", all_day: true, start_at: "2020-01-01", end_at: "2020-01-02", order_id: order.id });
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    service.setInvoiceDocumentStatus(owner, invoice.id, "issued");
    const attention = service.attentionItems(owner, "2020-01-02");
    expect(attention.map((entry) => `${entry.reason}:${entry.severity}`)).toEqual(expect.arrayContaining([
      "order_due:overdue",
      "production_due:overdue",
      "calendar_due:overdue",
      "payment_attention:overdue",
    ]));
    expect(attention.filter((entry) => entry.reason === "order_due" && entry.source_id === order.id)).toHaveLength(1);
    db.prepare("UPDATE invoices SET due_date = NULL WHERE id = ?").run(invoice.id);
    const payment = service.attentionItems(owner, "2020-01-02").find((entry) => entry.reason === "payment_attention");
    expect(payment.severity).toBe("payment attention");
    const dashboard = service.dashboard(owner);
    expect(dashboard.production.stages.map((stage) => stage.stage)).toEqual(["not_started", "ready", "in_progress", "waiting", "complete"]);
    expect(dashboard.calendar.days).toHaveLength(14);
  });
});

describe("Stage 3 Work Orders and commercial bundles", () => {
  function calendarPayload(overrides = {}) {
    return {
      title: "Production block",
      entry_type: "event",
      schedule_category: "production",
      start_at: "2026-08-21T09:00",
      end_at: "2026-08-21T10:00",
      all_day: false,
      ...overrides,
    };
  }

  it("requires new Order and Order Item titles while preserving fallback display for existing rows", () => {
    const c = customer(owner);
    expect(() => service.createOrder(owner, { customer_id: c.id, items: [item()] })).toThrow();
    expect(() => service.createOrder(owner, { title: "   ", customer_id: c.id, items: [item()] })).toThrow();
    expect(() => service.createOrder(owner, { title: "Pole Banner Project", customer_id: c.id, items: [item({ title: "   " })] })).toThrow();
    const order = service.createOrder(owner, { title: "Pole Banner Project", customer_id: c.id, items: [item({ title: "Main Street Banner" })] });
    db.prepare("UPDATE orders SET title = NULL WHERE id = ?").run(order.id);
    db.prepare("UPDATE order_items SET title = NULL WHERE id = ?").run(order.items[0].id);
    const fallback = service.order(owner, order.id);
    expect(fallback.title).toBe(`Order ${order.order_number}`);
    expect(fallback.items[0].title).toBe("Banner");
  });

  it("generates whole, individual, custom, and mixed-independent Work Orders idempotently", () => {
    const c = customer(owner);
    const whole = service.createOrder(owner, { title: "Whole Order", customer_id: c.id, items: [item({ title: "Sign" }), item({ title: "Install" }), item({ title: "Permit", production_required: false })] });
    const sent = service.sendOrderToProduction(owner, whole.id, { mode: "whole_order" });
    const again = service.sendOrderToProduction(owner, whole.id, { mode: "whole_order" });
    expect(sent.work_orders).toHaveLength(1);
    expect(sent.work_orders[0].items.map((entry) => entry.title)).toEqual(["Sign", "Install"]);
    expect(again.already_sent).toBe(true);
    expect(again.work_orders[0].id).toBe(sent.work_orders[0].id);

    const individual = service.createOrder(owner, { title: "Individual Order", customer_id: c.id, items: [item({ title: "Door" }), item({ title: "Hood" })] });
    expect(service.sendOrderToProduction(owner, individual.id, { mode: "individual_items" }).work_orders.map((entry) => entry.title)).toEqual(["Door", "Hood"]);

    const custom = service.createOrder(owner, { title: "Custom Order", customer_id: c.id, items: [item({ title: "Building Signs" }), item({ title: "Door Lettering" }), item({ title: "Installation" })] });
    const grouped = service.sendOrderToProduction(owner, custom.id, {
      mode: "custom_groups",
      groups: [{ title: "Main Building Signs", item_ids: [custom.items[0].id, custom.items[1].id] }],
      independent_item_ids: [custom.items[2].id],
    });
    expect(grouped.work_orders.map((entry) => `${entry.title}:${entry.item_count}`)).toEqual(["Main Building Signs:2", "Installation:1"]);
    expect(() => service.regroupOrderProduction(owner, custom.id, { mode: "custom_groups", groups: [{ title: "Bad", item_ids: [custom.items[0].id] }], independent_item_ids: [] })).toThrow("production_items_unassigned");
  });

  it("links calendar entries to Work Orders and keeps completion independent with staff financial redaction", async () => {
    const staff = await service.addUser(owner, { display_name: "Production Staff", email: "wo-staff@example.com", password: "password123", role: "staff" });
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Truck Lettering", customer_id: c.id, items: [item({ title: "Driver Door", unit_price_cents: 9999 })] });
    const workOrder = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" }).work_orders[0];
    const event = service.createCalendarEvent(owner, calendarPayload({ title: "Design block", order_id: order.id, work_order_id: workOrder.id, assigned_user_id: staff.id }));
    expect(event.work_order_id).toBe(workOrder.id);
    service.setCalendarStatus(owner, event.id, "complete");
    expect(service.workOrderSummary(owner, workOrder.id).completed).toBe(false);
    service.setWorkOrderCompletion(owner, workOrder.id, true);
    expect(service.calendarEvent(owner, event.id).status).toBe("complete");
    const board = service.productionBoard(staff).items.find((entry) => entry.id === workOrder.id);
    expect(board.title).toBe("Truck Lettering");
    expect(JSON.stringify(service.workOrderSummary(staff, workOrder.id))).not.toMatch(/unit_price_cents|line_total_cents|subtotal_cents|total_cents|invoice|payment|pricing|margin|cost/i);
  });

  it("guards regrouping after production begins and handles future calendar links explicitly", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Regroup Order", customer_id: c.id, items: [item({ title: "Panel A" }), item({ title: "Panel B" })] });
    const workOrder = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" }).work_orders[0];
    service.setWorkOrderStage(owner, workOrder.id, "in_progress");
    service.createCalendarEvent(owner, calendarPayload({ order_id: order.id, work_order_id: workOrder.id, start_at: "2999-01-01T09:00", end_at: "2999-01-01T10:00" }));
    expect(() => service.regroupOrderProduction(owner, order.id, { mode: "individual_items", reason: "x" })).toThrow("production_regroup_reason_required");
    expect(() => service.regroupOrderProduction(owner, order.id, { mode: "individual_items", reason: "Separate panels for finishing" })).toThrow("calendar_resolution_required");
    const regrouped = service.regroupOrderProduction(owner, order.id, { mode: "individual_items", reason: "Separate panels for finishing", calendar_resolution: "return_to_order" });
    expect(regrouped.work_orders).toHaveLength(2);
    expect(service.listCalendarEvents(owner, { start_at: "2999-01-01", end_at: "2999-01-02" }).items[0].work_order_id).toBe(null);
  });

  it("saves commercial bundles, allocates manual totals server-side, propagates estimate bundles, and locks issued invoices", () => {
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { title: "Ignored", customer_id: c.id, items: [item({ title: "Sign", unit_price_cents: 1000 }), item({ title: "Install", unit_price_cents: 500 })] });
    const saved = service.saveCommercialBundles(owner, "estimate", estimate.id, {
      bundles: [{
        title: "Sign Package",
        pricing_mode: "bundle_price",
        manual_total_cents: 3333,
        override_reason: "Package price approved",
        show_member_prices: false,
        item_ids: estimate.items.map((entry) => entry.id),
      }],
    }).items[0];
    expect(saved.total_cents).toBe(3333);
    expect(saved.items.reduce((sum, entry) => sum + entry.allocated_cents, 0)).toBe(3333);
    expect(() => service.saveCommercialBundles(owner, "estimate", estimate.id, { bundles: [{ title: "Duplicate", pricing_mode: "itemized_subtotal", item_ids: [estimate.items[0].id, estimate.items[0].id] }] })).toThrow("bundle_item_assigned_twice");
    const order = service.convertEstimate(owner, estimate.id).order;
    expect(service.order(owner, order.id).bundles[0].title).toBe("Sign Package");
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    expect(service.invoice(owner, invoice.id).bundles[0].title).toBe("Sign Package");
    service.setInvoiceDocumentStatus(owner, invoice.id, "issued");
    expect(() => service.saveCommercialBundles(owner, "invoice", invoice.id, { bundles: [] })).toThrow("bundle_document_locked");
  });

  it("enforces Stage 3 schema invariants for Work Order membership, calendar links, and bundles", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Invariant Order", customer_id: c.id, items: [item({ title: "Production" }), item({ title: "Office", production_required: false })] });
    const otherOrder = service.createOrder(owner, { title: "Other Order", customer_id: c.id, items: [item({ title: "Other" })] });
    const workOrder = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" }).work_orders[0];
    expect(() => db.prepare("INSERT INTO work_order_items (id, tenant_id, work_order_id, order_item_id, position, active, created_at) VALUES ('bad-non-production', ?, ?, ?, 0, 1, ?)").run(owner.tenant_id, workOrder.id, order.items[1].id, new Date().toISOString())).toThrow(/work_order_item_relationship_invalid/);
    expect(() => db.prepare("INSERT INTO work_order_items (id, tenant_id, work_order_id, order_item_id, position, active, created_at) VALUES ('bad-cross-order', ?, ?, ?, 0, 1, ?)").run(owner.tenant_id, workOrder.id, otherOrder.items[0].id, new Date().toISOString())).toThrow(/work_order_item_relationship_invalid/);
    expect(() => service.createCalendarEvent(owner, calendarPayload({ order_id: otherOrder.id, work_order_id: workOrder.id }))).toThrow("invalid_calendar_link");
    expect(() => service.saveCommercialBundles(owner, "order", order.id, { bundles: [{ title: "Foreign", pricing_mode: "itemized_subtotal", item_ids: [otherOrder.items[0].id] }] })).toThrow("bundle_item_not_found");
  });

  it("keeps Send to Production transactional and idempotent across retries and failures", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Retry Order", customer_id: c.id, items: [item({ title: "Face" }), item({ title: "Frame" })] });
    const originalAudit = service.audit;
    service.audit = () => {
      throw new Error("forced_audit_failure");
    };
    expect(() => service.sendOrderToProduction(owner, order.id, { mode: "whole_order" })).toThrow("forced_audit_failure");
    service.audit = originalAudit;
    expect(db.prepare("SELECT COUNT(*) AS count FROM work_orders WHERE tenant_id = ? AND order_id = ?").get(owner.tenant_id, order.id).count).toBe(0);
    expect(db.prepare("SELECT sent_to_production_at FROM orders WHERE id = ?").get(order.id).sent_to_production_at).toBe(null);
    const first = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" });
    const second = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" });
    expect(second.already_sent).toBe(true);
    expect(first.work_orders[0].id).toBe(second.work_orders[0].id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM work_orders WHERE tenant_id = ? AND order_id = ? AND status = 'active'").get(owner.tenant_id, order.id).count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM work_order_items WHERE tenant_id = ? AND active = 1").get(owner.tenant_id).count).toBe(2);
  });

  it("protects post-release production history and completed Work Order reopen permissions", async () => {
    const staff = await service.addUser(owner, { display_name: "Shop Staff", email: "shop-staff@example.com", password: "password123", role: "staff" });
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Protected Order", customer_id: c.id, items: [item({ title: "Panel A" }), item({ title: "Panel B" })] });
    const workOrder = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" }).work_orders[0];
    const released = service.order(owner, order.id);
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: released.updated_at, items: [...released.items, item({ title: "Late Add" })] })).toThrow("released_production_item_assignment_required");
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: released.updated_at, items: released.items.slice(0, 1) })).toThrow("released_production_item_history_protected");
    expect(() => service.setProductionStage(owner, released.items[0].id, "in_progress")).toThrow("work_order_item_stage_managed_by_work_order");
    service.setWorkOrderCompletion(owner, workOrder.id, true);
    expect(() => service.setWorkOrderCompletion(staff, workOrder.id, false)).toThrow("permission_denied");
    expect(service.setWorkOrderCompletion(owner, workOrder.id, false).work_order.production_stage).toBe("in_progress");
    expect(service.auditTrail(owner, "work_order", workOrder.id).some((entry) => entry.action === "work_order.reopen")).toBe(true);
  });

  it("moves future calendar entries to one replacement Work Order without touching order-level schedule entries", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Calendar Move", customer_id: c.id, items: [item({ title: "Panel A" }), item({ title: "Panel B" })] });
    const oldWorkOrder = service.sendOrderToProduction(owner, order.id, { mode: "whole_order" }).work_orders[0];
    const workEvent = service.createCalendarEvent(owner, calendarPayload({ title: "Work block", order_id: order.id, work_order_id: oldWorkOrder.id, start_at: "2999-02-01T09:00", end_at: "2999-02-01T10:00" }));
    const orderEvent = service.createCalendarEvent(owner, calendarPayload({ title: "Customer call", schedule_category: "sales", order_id: order.id, start_at: "2999-02-01T11:00", end_at: "2999-02-01T12:00" }));
    service.setWorkOrderStage(owner, oldWorkOrder.id, "in_progress");
    const regrouped = service.regroupOrderProduction(owner, order.id, { mode: "whole_order", reason: "Reissue production packet", calendar_resolution: "move_to_replacement" });
    const moved = service.calendarEvent(owner, workEvent.id);
    const untouched = service.calendarEvent(owner, orderEvent.id);
    expect(moved.work_order_id).toBe(regrouped.work_orders[0].id);
    expect(untouched.work_order_id).toBe(null);
    expect(untouched.status).toBe("scheduled");
    expect(service.auditTrail(owner, "order", order.id).some((entry) => entry.action === "calendar.work_order_resolution")).toBe(true);
  });

  it("keeps Work Order and bundle APIs tenant-isolated and redacts legacy production item prices for staff", async () => {
    const staff = await service.addUser(owner, { display_name: "Legacy Staff", email: "legacy-staff@example.com", password: "password123", role: "staff" });
    const c = customer(owner);
    const legacy = service.createOrder(owner, { title: "Legacy Board", customer_id: c.id, items: [item({ title: "Legacy Item", unit_price_cents: 7777 })] });
    expect(JSON.stringify(service.productionBoard(staff))).not.toMatch(/unit_price_cents|line_total_cents|total_cents|payment|pricing|cost|margin/i);
    const workOrder = service.sendOrderToProduction(owner, legacy.id, { mode: "whole_order" }).work_orders[0];
    const other = await bootstrap("other-tenant");
    expect(() => service.workOrderSummary(other.user, workOrder.id)).toThrow("work_order_not_found");
    expect(() => service.saveCommercialBundles(other.user, "order", legacy.id, { bundles: [{ title: "Foreign", pricing_mode: "itemized_subtotal", item_ids: [legacy.items[0].id] }] })).toThrow("order_not_found");
  });

  it("uses exact deterministic bundle allocations for totals, taxes, PDFs, and conversion retries", () => {
    service.updateSettings(owner, { sales_tax_rate_basis_points: 825 });
    const c = customer(owner);
    const estimate = service.createEstimate(owner, {
      title: "Ignored",
      customer_id: c.id,
      items: [
        item({ title: "Taxed", quantity_decimal: "1.0000", unit_price_cents: 1000, taxable: true }),
        item({ title: "Untaxed", quantity_decimal: "1.0000", unit_price_cents: 2000, taxable: false }),
      ],
    });
    const result = service.saveCommercialBundles(owner, "estimate", estimate.id, {
      bundles: [{ title: "Manual Package", pricing_mode: "bundle_price", manual_total_cents: 1001, override_reason: "Approved package price", show_member_prices: true, item_ids: estimate.items.map((entry) => entry.id) }],
    });
    expect(result.items[0].items.reduce((sum, entry) => sum + entry.allocated_cents, 0)).toBe(1001);
    expect(service.estimate(owner, estimate.id)).toMatchObject({ subtotal_cents: 1001, tax_cents: 27, total_cents: 1028 });
    const order = service.convertEstimate(owner, estimate.id).order;
    const retry = service.convertEstimate(owner, estimate.id).order;
    expect(retry.id).toBe(order.id);
    expect(service.order(owner, order.id)).toMatchObject({ subtotal_cents: 1001, tax_cents: 27, total_cents: 1028 });
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    const invoiceRetry = service.createOrOpenInvoice(owner, order.id).invoice;
    expect(invoiceRetry.id).toBe(invoice.id);
    expect(service.invoice(owner, invoice.id)).toMatchObject({ subtotal_cents: 1001, tax_cents: 27, total_cents: 1028, balance_due_cents: 1028 });
    const pdf = service.documentPdf(owner, "invoice", invoice.id).toString("latin1");
    expect(pdf).toContain("Manual Package");
    expect(pdf).toContain("$10.28");

    const zero = service.createEstimate(owner, { title: "Ignored", customer_id: c.id, items: [item({ title: "Zero A", quantity_decimal: "1.0000", unit_price_cents: 0 }), item({ title: "Zero B", quantity_decimal: "1.0000", unit_price_cents: 0 })] });
    const zeroBundle = service.saveCommercialBundles(owner, "estimate", zero.id, { bundles: [{ title: "Zero Base", pricing_mode: "bundle_price", manual_total_cents: 5, override_reason: "Documented zero base allocation", item_ids: zero.items.map((entry) => entry.id) }] }).items[0];
    const sortedAllocations = [...zeroBundle.items].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => entry.allocated_cents);
    expect(sortedAllocations).toEqual([3, 2]);
  });
});

describe("Version 1 Part 5 backup export and empty-tenant restore", () => {
  function backupFile(backup, name = "backup.signguy-backup") {
    const dir = mkdtempSync(join(tmpdir(), "signguy-slim-backup-test-"));
    const tempPath = join(dir, name);
    writeFileSync(tempPath, backup.buffer);
    return { filename: name, mime_type: "application/vnd.signguy.backup", temp_path: tempPath, byte_size: backup.buffer.length, cleanup_dir: dir };
  }

  function seedOperationalData(actor = owner) {
    const c = customer(actor, { business_name: "Backup Co", internal_notes: "Backup note" });
    const estimate = service.createEstimate(actor, { title: "Test Order", customer_id: c.id, discount_cents: 100, items: [item({ assigned_user_id: actor.id, internal_note: "Estimate item note" })] });
    const order = service.convertEstimate(actor, estimate.id).order;
    service.setProductionStage(actor, order.items[0].id, "in_progress");
    const invoice = service.createOrOpenInvoice(actor, order.id).invoice;
    service.setInvoiceDocumentStatus(actor, invoice.id, "issued");
    service.recordInvoicePayment(actor, invoice.id, { amount_paid_cents: 500 });
    service.createCalendarEvent(actor, { title: "Install", order_id: order.id, order_item_id: order.items[0].id, start_at: "2026-08-22T09:00", end_at: "2026-08-22T10:00", assigned_user_id: actor.id });
    const attachment = service.uploadOrderAttachment(actor, order.id, {
      filename: "proof.txt",
      mime_type: "text/plain",
      buffer: Buffer.from("backup proof"),
    });
    return { c, estimate, order: service.order(actor, order.id), invoice: service.invoice(actor, invoice.id), attachment };
  }

  function sha256Buffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
  }

  function dataFile(path, value) {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    return { path, media_type: "application/json", size_bytes: bytes.length, sha256: sha256Buffer(bytes) };
  }

  function refreshManifest(payload) {
    const sections = ["tenants", "users", "customers", "estimates", "estimate_items", "orders", "order_items", "invoices", "calendar_events", "tenant_sequences", "reminders", "notes", "audit_events"];
    payload.manifest.record_counts = Object.fromEntries(sections.map((section) => [section, payload.data[section].length]));
    payload.manifest.record_counts.attachments = payload.attachments.length;
    payload.manifest.data_file_inventory = sections.map((section) => dataFile(`data/${section}.json`, payload.data[section]));
    payload.manifest.attachment_inventory = payload.attachments.map((entry) => {
      const bytes = Buffer.from(entry.content_base64, "base64");
      return {
        path: entry.logical_path,
        content_type: entry.metadata.mime_type,
        size_bytes: bytes.length,
        sha256: sha256Buffer(bytes),
        source_portable_id: entry.metadata.portable_id,
      };
    });
    payload.manifest.attachment_count = payload.attachments.length;
    payload.manifest.total_attachment_bytes = payload.attachments.reduce((sum, entry) => sum + Buffer.from(entry.content_base64, "base64").length, 0);
    payload.manifest.overall_backup_integrity = `sha256:${sha256Buffer(Buffer.from(JSON.stringify({ data: payload.data, attachments: payload.manifest.attachment_inventory }), "utf8"))}`;
    return payload;
  }

  function encryptedPayload(payload, passphrase = "long-passphrase-4") {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const aad = { signature: "SIGNGUY-SLIM-BACKUP", container_version: "1.0.0", algorithm: "AES-256-GCM", kdf: "PBKDF2-HMAC-SHA256", kdf_iterations: 310000 };
    const cipher = createCipheriv("aes-256-gcm", pbkdf2Sync(passphrase, salt, 310000, 32, "sha256"), nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(aad), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
    return {
      buffer: Buffer.from(JSON.stringify({
        ...aad,
        salt_b64: salt.toString("base64"),
        nonce_b64: nonce.toString("base64"),
        tag_b64: cipher.getAuthTag().toString("base64"),
        ciphertext_b64: ciphertext.toString("base64"),
      }), "utf8"),
    };
  }

  it("requires owner/admin, encrypts data, excludes secrets, and uses unique salt/nonce", async () => {
    const seeded = seedOperationalData();
    const staff = await service.addUser(owner, { display_name: "Staff", email: "staff@example.com", password: "password123", role: "staff" });
    expect(() => service.createBackup(staff, { passphrase: "long-passphrase-1", passphrase_confirmation: "long-passphrase-1" })).toThrow("permission_denied");
    const first = service.createBackup(owner, { passphrase: "long-passphrase-1", passphrase_confirmation: "long-passphrase-1" });
    const second = service.createBackup(owner, { passphrase: "long-passphrase-1", passphrase_confirmation: "long-passphrase-1" });
    const text = first.buffer.toString("utf8");
    expect(text).toContain("SIGNGUY-SLIM-BACKUP");
    expect(text).not.toContain("Jane Customer");
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("backup proof");
    expect(text).not.toContain(seeded.c.email);
    expect(first.buffer.equals(second.buffer)).toBe(false);
    expect(first.filename.endsWith(".signguy-backup")).toBe(true);
  });

  it("validates passphrases, tampering, target emptiness, and preview without mutation", async () => {
    seedOperationalData();
    const backup = service.createBackup(owner, { passphrase: "long-passphrase-2", passphrase_confirmation: "long-passphrase-2" });
    const targetSession = await bootstrap("target-preview");
    const targetActor = targetSession.user;
    expect(() => service.previewBackup(targetActor, backupFile(backup), { passphrase: "wrong-passphrase" })).toThrow("backup_decryption_failed");
    const tampered = Buffer.from(backup.buffer);
    tampered[tampered.length - 10] = tampered[tampered.length - 10] === 65 ? 66 : 65;
    expect(() => service.previewBackup(targetActor, backupFile({ buffer: tampered }), { passphrase: "long-passphrase-2" })).toThrow();
    const before = db.prepare("SELECT COUNT(*) AS count FROM customers WHERE tenant_id = ?").get(targetActor.tenant_id).count;
    const preview = service.previewBackup(targetActor, backupFile(backup), { passphrase: "long-passphrase-2" });
    const after = db.prepare("SELECT COUNT(*) AS count FROM customers WHERE tenant_id = ?").get(targetActor.tenant_id).count;
    expect(before).toBe(0);
    expect(after).toBe(0);
    expect(preview.restore_permitted).toBe(true);
    expect(preview.counts.customers).toBe(1);
    expect(preview.attachment_count).toBe(1);
    expect(preview.user_mapping[0].matched).toBe(false);
    customer(targetActor);
    const blocked = service.previewBackup(targetActor, backupFile(backup), { passphrase: "long-passphrase-2" });
    expect(blocked.restore_permitted).toBe(false);
    expect(blocked.blocking_errors.some((entry) => entry.startsWith("customers:"))).toBe(true);
  });

  it("rejects unsupported crypto headers and malformed authenticated payloads during preview", async () => {
    seedOperationalData();
    const passphrase = "long-passphrase-4";
    const backup = service.createBackup(owner, { passphrase, passphrase_confirmation: passphrase });
    const targetSession = await bootstrap("target-malformed");
    const targetActor = targetSession.user;
    const header = JSON.parse(backup.buffer.toString("utf8"));
    expect(() => service.previewBackup(targetActor, backupFile({ buffer: Buffer.from(JSON.stringify({ ...header, algorithm: "AES-128-CBC" }), "utf8") }), { passphrase })).toThrow("backup_format_unsupported");
    expect(() => service.previewBackup(targetActor, backupFile({ buffer: Buffer.from(JSON.stringify({ ...header, kdf_iterations: 1 }), "utf8") }), { passphrase })).toThrow("backup_format_unsupported");
    expect(() => service.previewBackup(targetActor, backupFile({ buffer: Buffer.from(JSON.stringify({ ...header, tag_b64: Buffer.alloc(16).toString("base64") }), "utf8") }), { passphrase })).toThrow("backup_decryption_failed");

    const checksumPayload = decryptBackup(backup.buffer, passphrase);
    checksumPayload.data.customers[0].contact_name = "Tampered after manifest";
    expect(() => service.previewBackup(targetActor, backupFile(encryptedPayload(checksumPayload, passphrase)), { passphrase })).toThrow("backup_checksum_mismatch");

    const relationshipPayload = refreshManifest(decryptBackup(backup.buffer, passphrase));
    relationshipPayload.data.orders[0].customer_id = "missing-customer";
    refreshManifest(relationshipPayload);
    expect(() => service.previewBackup(targetActor, backupFile(encryptedPayload(relationshipPayload, passphrase)), { passphrase })).toThrow("backup_relationship_invalid");

    const attachmentPayload = refreshManifest(decryptBackup(backup.buffer, passphrase));
    attachmentPayload.attachments[0].metadata.original_filename = "payload.html";
    refreshManifest(attachmentPayload);
    expect(() => service.previewBackup(targetActor, backupFile(encryptedPayload(attachmentPayload, passphrase)), { passphrase })).toThrow("backup_attachment_type_unsupported");
  });

  it("enforces backup permissions, schema compatibility, failure audits, and restore temp cleanup", async () => {
    seedOperationalData();
    const passphrase = "long-passphrase-5";
    const backup = service.createBackup(owner, { passphrase, passphrase_confirmation: passphrase });
    const staff = await service.addUser(owner, { display_name: "Viewer", email: "viewer@example.com", password: "password123", role: "staff" });
    expect(() => service.previewBackup(staff, backupFile(backup), { passphrase })).toThrow("permission_denied");
    expect(() => service.restoreBackup(staff, backupFile(backup), { passphrase, confirmation_phrase: "shop-a" })).toThrow("permission_denied");

    const targetSession = await bootstrap("target-schema");
    const targetActor = targetSession.user;
    const schemaPayload = refreshManifest(decryptBackup(backup.buffer, passphrase));
    schemaPayload.manifest.source_schema_version = "999_future_schema.sql";
    const schemaPreview = service.previewBackup(targetActor, backupFile(encryptedPayload(schemaPayload, passphrase)), { passphrase });
    expect(schemaPreview.restore_permitted).toBe(false);
    expect(schemaPreview.blocking_errors).toContain("schema_incompatible");

    expect(() => service.previewBackup(targetActor, backupFile(backup), { passphrase: "wrong-passphrase" })).toThrow("backup_decryption_failed");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ? AND action = 'backup.validation_failed'").get(targetActor.tenant_id).count).toBe(1);

    const wrongRestore = backupFile(backup);
    expect(() => service.restoreBackup(targetActor, wrongRestore, { passphrase: "wrong-passphrase", confirmation_phrase: "target-schema" })).toThrow("backup_decryption_failed");
    expect(existsSync(wrongRestore.cleanup_dir)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ? AND action = 'backup.restore_failed'").get(targetActor.tenant_id).count).toBe(1);

    expect(() => service.createBackup(owner, { passphrase: "short", passphrase_confirmation: "short" })).toThrow("backup_passphrase_invalid");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id = ? AND action = 'backup.failed'").get(owner.tenant_id).count).toBe(1);
  });

  it("restores into an empty tenant, preserves relationships and attachments, advances sequences, and blocks duplicates", async () => {
    const seeded = seedOperationalData();
    const backup = service.createBackup(owner, { passphrase: "long-passphrase-3", passphrase_confirmation: "long-passphrase-3" });
    const targetSession = await bootstrap("target-restore");
    const targetActor = targetSession.user;
    const targetName = service.tenant(targetActor.tenant_id).company_name;
    expect(() => service.restoreBackup(targetActor, backupFile(backup), { passphrase: "long-passphrase-3", confirmation_phrase: targetName })).toThrow("backup_assignment_policy_required");
    const report = service.restoreBackup(targetActor, backupFile(backup), {
      passphrase: "long-passphrase-3",
      confirmation_phrase: targetName,
      unmatched_assignment_policy: "restore_unassigned",
    });
    expect(report.restored_counts.customers).toBe(1);
    const restoredCustomer = db.prepare("SELECT * FROM customers WHERE tenant_id = ?").get(targetActor.tenant_id);
    const restoredOrder = db.prepare("SELECT * FROM orders WHERE tenant_id = ?").get(targetActor.tenant_id);
    const restoredInvoice = db.prepare("SELECT * FROM invoices WHERE tenant_id = ?").get(targetActor.tenant_id);
    const restoredEvent = db.prepare("SELECT * FROM calendar_events WHERE tenant_id = ?").get(targetActor.tenant_id);
    expect(restoredCustomer.contact_name).toBe(seeded.c.contact_name);
    expect(restoredInvoice.order_id).toBe(restoredOrder.id);
    expect(restoredEvent.status).toBe("scheduled");
    expect(db.prepare("SELECT COUNT(*) AS count FROM order_attachments WHERE tenant_id = ? AND deleted_at IS NULL").get(targetActor.tenant_id).count).toBe(1);
    expect(service.createCustomer(targetActor, { contact_name: "Next", billing_address: address }).customer_number).toBe("C-00002");
    expect(() => service.restoreBackup(targetActor, backupFile(backup), {
      passphrase: "long-passphrase-3",
      confirmation_phrase: service.tenant(targetActor.tenant_id).company_name,
      unmatched_assignment_policy: "restore_unassigned",
    })).toThrow("backup_restore_blocked");
  });
});

describe("Version 2 Stage 1 customer communications", () => {
  it("sends Estimate email idempotently and records honest delivery states", async () => {
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { title: "Lobby Sign", customer_id: c.id, items: [item()] });
    const deliveries = [];
    service.emailTransport = async (payload) => {
      deliveries.push(payload);
      return { provider_message_id: "sg-message-1" };
    };
    service.updateEmailSettings(owner, { sender_name: "Acme Signs", sender_email: "sales@example.com", sendgrid_verified: true });
    const payload = {
      idempotency_key: "estimate-send-001",
      subject: "Estimate ready",
      body_text: "Please review the estimate.",
      attach_document: true,
    };
    const first = await service.sendCustomerEmail(owner, "estimate", estimate.id, payload);
    const second = await service.sendCustomerEmail(owner, "estimate", estimate.id, payload);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].attachments[0].filename).toContain("estimate");
    expect(service.estimate(owner, estimate.id).status).toBe("sent");
    expect(service.listCommunications(owner, { customer_id: c.id })).toHaveLength(1);
    const eventResult = service.processSendGridEvents([{ sg_event_id: "event-1", sg_message_id: "sg-message-1", event: "delivered", timestamp: 1893456000 }]);
    expect(eventResult.processed[0]).toMatchObject({ status: "recorded", delivery_state: "delivered" });
    expect(service.listCommunications(owner, { customer_id: c.id })[0].delivery_state).toBe("delivered");
    const duplicateEvent = service.processSendGridEvents([{ sg_event_id: "event-1", sg_message_id: "sg-message-1", event: "delivered" }]);
    expect(duplicateEvent.processed[0].status).toBe("duplicate");
  });

  it("requires confirmation for changed recipients and does not mark failed Invoice sends issued", async () => {
    const c = customer(owner, { email: "saved@example.com" });
    const order = service.createOrder(owner, { title: "Window Vinyl", customer_id: c.id, items: [item()] });
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    service.updateEmailSettings(owner, { sender_name: "Acme Signs", sender_email: "sales@example.com" });
    await expect(service.sendCustomerEmail(owner, "invoice", invoice.id, {
      idempotency_key: "invoice-send-001",
      to_email: "other@example.com",
      subject: "Invoice",
      body_text: "Please review.",
    })).rejects.toThrow("email_changed_recipient_confirmation_required");
    service.emailTransport = async () => {
      throw new Error("provider_down");
    };
    await expect(service.sendCustomerEmail(owner, "invoice", invoice.id, {
      idempotency_key: "invoice-send-002",
      to_email: "saved@example.com",
      subject: "Invoice",
      body_text: "Please review.",
    })).rejects.toThrow("provider_down");
    expect(service.invoice(owner, invoice.id).document_status).toBe("draft");
    expect(service.invoice(owner, invoice.id).payment_status).toBe("unpaid");
    expect(db.prepare("SELECT delivery_state FROM outbound_email_sends WHERE idempotency_key = ?").get("invoice-send-002").delivery_state).toBe("failed");
  });

  it("adds manual communication notes with same-tenant related-record validation", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Wall Sign", customer_id: c.id, items: [item()] });
    const note = service.createManualCommunication(owner, {
      customer_id: c.id,
      channel: "phone",
      direction: "inbound",
      subject: "Approved colors",
      body_text: "Customer confirmed the color palette by phone.",
      related_entity_type: "order",
      related_entity_id: order.id,
    });
    expect(note.summary).toBe("Approved colors");
    expect(service.listCommunications(owner, { related_entity_type: "order", related_entity_id: order.id })).toHaveLength(1);
    const other = await bootstrap("comm-other");
    const otherCustomer = customer(other.user);
    const otherOrder = service.createOrder(other.user, { title: "Other", customer_id: otherCustomer.id, items: [item()] });
    expect(() => service.createManualCommunication(owner, {
      customer_id: c.id,
      channel: "phone",
      body_text: "bad",
      related_entity_type: "order",
      related_entity_id: otherOrder.id,
    })).toThrow("order_not_found");
  });
});

describe("Version 2 Stage 2 email Order Intake", () => {
  it("receives forwarded email only through the tenant intake address and deduplicates provider retries", () => {
    const settings = service.settings(owner);
    const payload = {
      provider_message_id: "mail-001",
      intake_address: settings.intake_address.full_address,
      sender_name: "Buyer",
      sender_email: "buyer@example.com",
      recipients: [settings.intake_address.full_address],
      subject: "Need a banner",
      text_body: "Please quote a 4x8 banner.",
      attachments: [{ original_filename: "art.pdf", mime_type: "application/pdf", byte_size: 1200, sha256: "a".repeat(64) }],
    };
    const first = service.receiveEmailIntake(payload);
    const second = service.receiveEmailIntake(payload);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.item.status).toBe("new");
    expect(first.item.attachments[0]).toMatchObject({ original_filename: "art.pdf", accepted: true });
    expect(() => service.receiveEmailIntake({ ...payload, provider_message_id: "mail-002", intake_address: "bad@example.com" })).toThrow("intake_address_not_found");
  });

  it("matches a Customer and creates exactly one Draft Order from an Intake Item", () => {
    const intake = service.receiveEmailIntake({
      provider_message_id: "mail-003",
      intake_address: service.settings(owner).intake_address.full_address,
      sender_name: "New Buyer",
      sender_email: "newbuyer@example.com",
      recipients: [],
      subject: "Yard signs",
      text_body: "I need 20 yard signs.",
    }).item;
    const customer = service.createCustomer(owner, { contact_name: "New Buyer", email: "newbuyer@example.com", billing_address: address });
    service.updateIntakeItem(owner, intake.id, { customer_id: customer.id, assigned_user_id: owner.id, follow_up_at: "2026-09-01", status: "ready_to_create" });
    const first = service.createDraftOrderFromIntake(owner, intake.id, {});
    const second = service.createDraftOrderFromIntake(owner, intake.id, {});
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.order.status).toBe("draft");
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE tenant_id = ? AND customer_id = ?").get(owner.tenant_id, customer.id).count).toBe(1);
    expect(service.intakeItem(owner, intake.id).status).toBe("converted_to_order");
  });

  it("links Intake Items to existing tenant-owned Orders without creating another Order", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Existing Order", customer_id: c.id, items: [item()] });
    const before = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE tenant_id = ?").get(owner.tenant_id).count;
    const intake = service.receiveEmailIntake({
      provider_message_id: "mail-004",
      intake_address: service.settings(owner).intake_address.full_address,
      sender_email: "buyer2@example.com",
      recipients: [],
      subject: "Add to existing",
      text_body: "This belongs with the open order.",
      attachments: [{
        original_filename: "notes.txt",
        mime_type: "text/plain",
        byte_size: Buffer.byteLength("field notes"),
        sha256: createHash("sha256").update("field notes").digest("hex"),
        content_base64: Buffer.from("field notes").toString("base64"),
      }],
    }).item;
    const linked = service.linkIntakeToOrder(owner, intake.id, { order_id: order.id });
    expect(linked.item.status).toBe("attached_to_existing_order");
    expect(linked.item.linked_order_id).toBe(order.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE tenant_id = ?").get(owner.tenant_id).count).toBe(before);
    expect(service.listOrderAttachments(owner, order.id)[0].original_filename).toBe("notes.txt");
    const other = await bootstrap("intake-other");
    const otherCustomer = customer(other.user);
    const otherOrder = service.createOrder(other.user, { title: "Other", customer_id: otherCustomer.id, items: [item()] });
    expect(() => service.linkIntakeToOrder(owner, intake.id, { order_id: otherOrder.id })).toThrow("order_not_found");
  });
});

describe("Version 2 Stages 3-4 camera capture and photo annotation", () => {
  it("stores captured photos through the private attachment pipeline with device-capture audit metadata", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Camera Order", customer_id: c.id, items: [item()] });
    const attachment = service.uploadOrderAttachment(owner, order.id, {
      filename: "../field-photo.png",
      mime_type: "image/png",
      buffer: tinyPng(),
      fields: { source_type: "device_capture" },
    });

    expect(attachment).toMatchObject({
      original_filename: "field-photo.png",
      source_type: "device_capture",
      annotatable: true,
      image_width: 1,
      image_height: 1,
    });
    expect(attachment).not.toHaveProperty("storage_key");
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'attachment.device_capture' AND actor_user_id = ?").get(owner.id).count).toBe(1);
  });

  it("creates separate annotated derivatives without changing original bytes or overwriting prior derivatives", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Annotated Order", customer_id: c.id, items: [item()] });
    const original = service.uploadOrderAttachment(owner, order.id, {
      filename: "original.png",
      mime_type: "image/png",
      buffer: tinyPng(),
    });
    const originalRow = db.prepare("SELECT * FROM order_attachments WHERE id = ?").get(original.id);
    const originalBytes = readFileSync(service.attachmentPath(originalRow.storage_key));

    const first = service.createAnnotatedAttachment(owner, order.id, original.id, {
      filename: "annotated-one.png",
      mime_type: "image/png",
      buffer: tinyPng(),
      fields: { annotation_json: JSON.stringify(annotationOps()) },
    });
    const second = service.createAnnotatedAttachment(owner, order.id, original.id, {
      filename: "annotated-two.png",
      mime_type: "image/png",
      buffer: tinyPng(),
      fields: { annotation_json: JSON.stringify(annotationOps({ id: "op-2", color: "#2563eb" })) },
    });

    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      source_type: "annotation_derivative",
      original_attachment_id: original.id,
      derivative_type: "annotation",
      image_width: 1,
      image_height: 1,
    });
    expect(first.annotation_operations[0]).toMatchObject({ type: "rectangle", start: { x: 0.1, y: 0.1 } });
    expect(service.listOrderAttachments(owner, order.id).filter((entry) => entry.original_attachment_id === original.id)).toHaveLength(2);
    const refreshedOriginalRow = db.prepare("SELECT * FROM order_attachments WHERE id = ?").get(original.id);
    expect(readFileSync(service.attachmentPath(refreshedOriginalRow.storage_key))).toEqual(originalBytes);
    expect(refreshedOriginalRow.sha256).toBe(originalRow.sha256);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'attachment.annotation_create' AND actor_user_id = ?").get(owner.id).count).toBe(2);
  });

  it("rejects unauthorized, cross-order, cross-tenant, non-image, malformed, and excessive annotation attempts", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { title: "Reject Order", customer_id: c.id, items: [item()] });
    const otherSameTenantOrder = service.createOrder(owner, { title: "Other Same Tenant", customer_id: c.id, items: [item()] });
    const image = service.uploadOrderAttachment(owner, order.id, { filename: "proof.png", mime_type: "image/png", buffer: tinyPng() });
    const text = service.uploadOrderAttachment(owner, order.id, { filename: "notes.txt", mime_type: "text/plain", buffer: Buffer.from("notes") });
    const payload = { filename: "marked.png", mime_type: "image/png", buffer: tinyPng(), fields: { annotation_json: JSON.stringify(annotationOps()) } };

    expect(() => service.createAnnotatedAttachment({ ...owner, role: "viewer" }, order.id, image.id, payload)).toThrow("permission_denied");
    expect(() => service.createAnnotatedAttachment(owner, otherSameTenantOrder.id, image.id, payload)).toThrow("attachment_not_found");
    const other = await bootstrap("annotation-other");
    const otherCustomer = customer(other.user);
    const otherOrder = service.createOrder(other.user, { title: "Other Tenant", customer_id: otherCustomer.id, items: [item()] });
    expect(() => service.createAnnotatedAttachment(owner, otherOrder.id, image.id, payload)).toThrow("order_not_found");
    expect(() => service.createAnnotatedAttachment(owner, order.id, text.id, payload)).toThrow("annotation_source_not_image");
    expect(() => service.createAnnotatedAttachment(owner, order.id, image.id, { ...payload, fields: { annotation_json: "{}" } })).toThrow("annotation_payload_invalid");
    expect(() => service.createAnnotatedAttachment(owner, order.id, image.id, { ...payload, fields: { annotation_json: " ".repeat(130 * 1024) } })).toThrow("annotation_payload_too_large");
  });
});

describe("migration contract", () => {
  it("records additive migration history", () => {
    const migrations = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
    expect(migrations).toEqual(["001_v1_part2_core.sql", "002_v1_part3_order_workspace_production.sql", "003_v1_part4_dashboard_calendar_reminders.sql", "004_v1_part5_backup_restore.sql", "005_stage1_full_calendar.sql", "006_stage2_shared_scheduling.sql", "007_stage2_calendar_hardening.sql", "008_stage3_work_orders_bundles.sql", "009_stage3_hardening.sql", "010_v2_stage1_2_communications_intake.sql", "011_v2_stage3_4_camera_annotation.sql"]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_attachments'").get().name).toBe("order_attachments");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calendar_events'").get().name).toBe("calendar_events");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_restore_receipts'").get().name).toBe("backup_restore_receipts");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbound_email_sends'").get().name).toBe("outbound_email_sends");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_intake_items'").get().name).toBe("order_intake_items");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_order_attachment_derivative_insert'").get().name).toBe("trg_order_attachment_derivative_insert");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ux_schedule_views_shared_name'").get().name).toBe("ux_schedule_views_shared_name");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_work_order_items_membership_insert'").get().name).toBe("trg_work_order_items_membership_insert");
  });
});
