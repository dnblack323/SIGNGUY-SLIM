import { beforeEach, describe, expect, it } from "vitest";
import { migratedMemoryDatabase } from "./db.js";
import { SlimService } from "./services.js";
import { lineTotalCents } from "./money.js";

let db;
let service;
let owner;
let token;

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
  db = migratedMemoryDatabase();
  service = new SlimService(db);
  const session = await bootstrap();
  token = session.access_token;
  owner = session.user;
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
  });

  it("renders tenant-scoped estimate and invoice PDFs without internal notes", () => {
    const c = customer(owner);
    const estimate = service.createEstimate(owner, { customer_id: c.id, internal_notes: "Do not print", items: [item()] });
    const order = service.convertEstimate(owner, estimate.id).order;
    const invoice = service.createOrOpenInvoice(owner, order.id).invoice;
    const estimatePdf = service.documentPdf(owner, "estimate", estimate.id).toString("latin1");
    const invoicePdf = service.documentPdf(owner, "invoice", invoice.id).toString("latin1");
    expect(estimatePdf).toContain("Estimate");
    expect(estimatePdf).toContain("Jane Customer");
    expect(estimatePdf).not.toContain("Do not print");
    expect(invoicePdf).toContain("Payment information is manually recorded.");
  });
});

describe("migration contract", () => {
  it("records additive migration history", () => {
    const migrations = db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id);
    expect(migrations).toEqual(["001_v1_part2_core.sql"]);
  });
});
