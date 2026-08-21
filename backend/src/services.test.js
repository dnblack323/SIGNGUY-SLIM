import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { migratedMemoryDatabase } from "./db.js";
import { SlimService } from "./services.js";
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
    description: "Banner",
    quantity_decimal: "2.5000",
    unit_price_cents: 1200,
    taxable: true,
    production_required: true,
    ...overrides,
  };
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
    expect(() => service.createEstimate(owner, { customer_id: otherCustomer.id, items: [item()] })).toThrow("customer_not_found");
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
    const estimate = service.createEstimate(owner, { customer_id: c.id, discount_cents: 0, items: [item()] });
    expect(c.portable_id).toMatch(/^sgp_v1_customer_/);
    expect(estimate.customer_tax_exempt_snapshot).toBe(true);
    expect(estimate.tax_cents).toBe(0);
  });

  it("uses decimal-safe quantities and integer cents", () => {
    expect(lineTotalCents("1.3333", 999)).toBe(1332);
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { customer_id: c.id, items: [item({ quantity_decimal: "1.3333", unit_price_cents: 999 })] });
    expect(estimate.items[0].line_total_cents).toBe(1332);
    expect(() => service.createEstimate(owner, { customer_id: c.id, items: [item({ quantity_decimal: "0" })] })).toThrow();
    expect(() => service.createEstimate(owner, { customer_id: c.id, items: [item({ unit_price_cents: Number.MAX_SAFE_INTEGER + 1 })] })).toThrow();
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
    const estimate = service.createEstimate(owner, { customer_id: c.id, items: [item()] });
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
    const estimate = service.createEstimate(owner, { customer_id: c.id, status: "sent", items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item({ taxable: false })] });
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
    expect(() => service.createOrder(owner, { customer_id: c.id, items: [item()] })).toThrow("forced_audit_failure");
    service.audit = originalAudit;
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM order_items").get().count).toBe(0);
  });

  it("keeps invoice document status separate from manual payment status", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const estimate = service.createEstimate(owner, { customer_id: c.id, internal_notes: "Do not print", items: manyItems });
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
        body: JSON.stringify({ customer_id: cust.id, items: [item()] }),
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
        body: JSON.stringify({ customer_id: cust.id, items: [item()] }),
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
        body: JSON.stringify({ customer_id: cust.id, items: [item()] }),
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, discount_cents: 100, items: [item(), item({ description: "Install", taxable: false })] });
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
    const estimate = service.createEstimate(owner, { customer_id: c.id, items: [item({ description: "First" }), item({ description: "Second" })] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item({ description: "Keep" }), item({ description: "Remove" })] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, status: "active", items: [item(), item({ description: "No production", production_required: false })] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
    const workspace = service.orderWorkspace(owner, order.id);
    const status = service.updateOrderStatus(owner, order.id, "on_hold");
    expect(status.status).toBe("on_hold");
    expect(Date.parse(status.updated_at)).toBeGreaterThan(Date.parse(workspace.order.updated_at));
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: workspace.order.updated_at, internal_notes: "stale after status" })).toThrow("order_conflict");
  });

  it("rolls back production mutations when audit insertion fails and validates completion booleans", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
    service.updateOrderWorkspace(owner, order.id, {
      expected_updated_at: order.updated_at,
      items: [{ ...order.items[0], production_stage: "complete", completed: true }],
    });
    const auditActions = db.prepare("SELECT action FROM audit_events WHERE entity_type = 'order_item' ORDER BY occurred_at").all().map((row) => row.action);
    expect(auditActions).toEqual(["production.stage_move", "production.complete"]);
  });

  it("uses effective due dates and filters Unassigned under assigned users", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, due_date: "2020-01-01", items: [item({ due_date: null, assigned_user_id: null }), item({ description: "Assigned", assigned_user_id: owner.id })] });
    const board = service.productionBoard(owner);
    expect(board.items.find((entry) => entry.id === order.items[0].id).due_date).toBe("2020-01-01");
    expect(service.productionBoard(owner, { due_state: "late" }).items.length).toBe(2);
    expect(service.productionBoard(owner, { assigned_user_id: "unassigned" }).items.map((entry) => entry.description)).toEqual(["Banner"]);
  });
});

describe("Version 1 Part 3 attachments", () => {
  it("stores attachment metadata with checksum and no exposed filesystem path", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
    const buffer = Buffer.from("%PDF-1.4");
    const attachment = service.uploadOrderAttachment(owner, order.id, { filename: "../proof.pdf", mime_type: "application/pdf", buffer });
    expect(attachment.original_filename).toBe("proof.pdf");
    expect(attachment.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
    expect(attachment).not.toHaveProperty("storage_key");
    expect(attachment.portable_id).toMatch(/^sgp_v1_order_attachment_/);
  });

  it("blocks active content, path traversal names, and oversized uploads", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
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
    const order = service.createOrder(owner, { customer_id: c.id, status: "active", items: [item({ due_date: "2026-08-21" })] });
    const event = service.createCalendarEvent(owner, calendarPayload({ order_id: order.id, order_item_id: order.items[0].id, assigned_user_id: owner.id }));
    expect(event.portable_id).toMatch(/^sgp_v1_calendar_event_/);
    expect(event.order_number).toBe(order.order_number);
    expect(event.local_start_date).toBe("2026-08-21");
    expect(service.listCalendarEvents(owner, { start_at: "2026-08-21", end_at: "2026-08-22", linked_record_type: "order_item" }).items).toHaveLength(1);
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
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
    const other = await bootstrap("shop-b");
    const otherCustomer = customer(other.user);
    const otherOrder = service.createOrder(other.user, { customer_id: otherCustomer.id, items: [item()] });
    expect(() => service.createCalendarEvent(owner, calendarPayload({ end_at: "2026-08-21T09:00" }))).toThrow("invalid_calendar_range");
    expect(() => service.setCalendarStatus(owner, "missing", "moved")).toThrow("invalid_calendar_status");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ order_id: otherOrder.id }))).toThrow("calendar_link_not_found");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ assigned_user_id: other.user.id }))).toThrow("calendar_assigned_user_not_found");
    expect(() => service.createCalendarEvent(owner, calendarPayload({ order_id: order.id, order_item_id: otherOrder.items[0].id }))).toThrow("calendar_link_not_found");
    const allDay = service.createCalendarEvent(owner, calendarPayload({ title: "All day", all_day: true, start_at: "2026-08-23", end_at: "2026-08-24" }));
    expect(allDay.start_at).toBe("2026-08-23");
    expect(allDay.local_start_date).toBe("2026-08-23");
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

  it("derives dashboard production, rolling calendar, attention distinctions, duplicate prevention, and payment wording", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, due_date: "2020-01-01", status: "active", items: [item({ due_date: "2020-01-01" })] });
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

describe("migration contract", () => {
  it("records additive migration history", () => {
    const migrations = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
    expect(migrations).toEqual(["001_v1_part2_core.sql", "002_v1_part3_order_workspace_production.sql", "003_v1_part4_dashboard_calendar_reminders.sql"]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_attachments'").get().name).toBe("order_attachments");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calendar_events'").get().name).toBe("calendar_events");
  });
});
