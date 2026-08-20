import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratedMemoryDatabase } from "./db.js";
import { SlimService } from "./services.js";
import { createSlimServer } from "./server.js";
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
});

describe("Version 1 Part 3 order workspace and production", () => {
  it("loads workspace data, enforces tenant isolation, and rejects stale saves", async () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, items: [item()] });
    const workspace = service.orderWorkspace(owner, order.id);
    expect(workspace.customer.contact_name).toBe("Jane Customer");
    expect(workspace.order.production_progress).toEqual({ completed: 0, total: 1, percent: 0 });
    const other = await bootstrap("shop-b");
    expect(() => service.orderWorkspace(other.user, order.id)).toThrow("order_not_found");
    expect(() => service.updateOrderWorkspace(owner, order.id, { expected_updated_at: "stale", internal_notes: "stale" })).toThrow("order_conflict");
  });

  it("saves order and item edits transactionally and recalculates totals", () => {
    const c = customer(owner);
    const order = service.createOrder(owner, { customer_id: c.id, discount_cents: 100, items: [item(), item({ description: "Install", taxable: false })] });
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
    const originalInsert = service.insertOrderItems;
    service.insertOrderItems = () => {
      throw new Error("forced_item_failure");
    };
    expect(() => service.updateOrderWorkspace(owner, updated.id, { expected_updated_at: updated.updated_at, items: [{ ...updated.items[0], description: "Nope" }] })).toThrow("forced_item_failure");
    service.insertOrderItems = originalInsert;
    expect(service.order(owner, updated.id).items[0].description).toBe("Install");
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
    const auditActions = db.prepare("SELECT action FROM audit_events WHERE entity_type = 'order_item' ORDER BY occurred_at").all().map((row) => row.action);
    expect(auditActions).toEqual(["production.stage_move", "production.reopen"]);
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
    process.env.SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES = "2";
    expect(() => service.uploadOrderAttachment(owner, order.id, { filename: "big.txt", mime_type: "text/plain", buffer: Buffer.from("123") })).toThrow("attachment_too_large");
  });

  it("enforces tenant authorization, safe headers, soft deletion, and missing-file handling", async () => {
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
    unlinkSync(service.attachmentPath(row.storage_key));
    expect(() => service.attachmentDownload(owner, order.id, attachment.id)).toThrow("attachment_file_missing");
    const second = service.uploadOrderAttachment(owner, order.id, { filename: "delete.txt", mime_type: "text/plain", buffer: Buffer.from("delete") });
    service.deleteOrderAttachment(owner, order.id, second.id);
    expect(service.listOrderAttachments(owner, order.id).some((entry) => entry.id === second.id)).toBe(false);
    expect(db.prepare("SELECT deleted_at FROM order_attachments WHERE id = ?").get(second.id).deleted_at).toBeTruthy();
  });
});

describe("migration contract", () => {
  it("records additive migration history", () => {
    const migrations = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
    expect(migrations).toEqual(["001_v1_part2_core.sql", "002_v1_part3_order_workspace_production.sql"]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_attachments'").get().name).toBe("order_attachments");
  });
});
