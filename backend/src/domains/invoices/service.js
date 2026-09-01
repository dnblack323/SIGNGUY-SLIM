import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  MANAGER_ROLES,
  WRITE_ROLES,
  bool,
  error,
  mapInvoice,
  now,
  paymentStatus,
  portable,
  randomUUID,
  today,
  z,
} = shared;

class InvoiceDomainMethods {
  createOrOpenInvoice(actor, orderId, payload = {}) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
    if (existing) return { invoice: this.invoice(actor, existing.id), already_exists: true };
    return this.transaction(() => {
      const existingInTxn = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
      if (existingInTxn) return { invoice: this.invoice(actor, existingInTxn.id), already_exists: true };
      const order = this.order(actor, orderId);
      const id = randomUUID();
      const pid = portable("invoice");
      const timestamp = now();
      const number = this.nextNumber(actor.tenant_id, "invoice", "I");
      try {
        this.db
          .prepare(
            `INSERT INTO invoices
             (id, portable_id, tenant_id, order_id, customer_id, invoice_number, document_date, due_date, document_status, payment_status,
              customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
              amount_paid_cents, balance_due_cents, historical_amount_paid_note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unpaid', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, order.id, order.customer_id, number, payload.document_date ?? today(), payload.due_date ?? order.due_date ?? null, bool(order.customer_tax_exempt_snapshot), order.tax_rate_basis_points_snapshot, order.subtotal_cents, order.discount_cents, order.tax_cents, order.total_cents, order.total_cents, "Payment information is manually recorded.", timestamp, timestamp);
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) {
          const winner = this.db.prepare("SELECT * FROM invoices WHERE order_id = ? AND tenant_id = ?").get(orderId, actor.tenant_id);
          if (winner) return { invoice: mapInvoice(winner), already_exists: true };
        }
        throw err;
      }
      this.copyBundles(actor, "order", order.id, "invoice", id);
      this.audit(actor, "invoice.create", "invoice", id, pid, `Invoice ${number} created from ${order.order_number}`, { order_id: order.id });
      return { invoice: this.invoice(actor, id), already_exists: false };
    });
  }

  invoice(actor, id) {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("invoice_not_found", 404);
    const invoice = mapInvoice(row);
    invoice.items = this.order(actor, invoice.order_id).items;
    invoice.bundles = this.listCommercialBundles(actor, "invoice", id);
    return invoice;
  }

  listInvoices(actor) {
    return this.db
      .prepare(
        `SELECT i.*, o.order_number, o.title AS order_title, c.contact_name AS customer_contact_name, c.business_name AS customer_business_name
         FROM invoices i
         LEFT JOIN orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
         LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
         WHERE i.tenant_id = ?
         ORDER BY i.invoice_number DESC`,
      )
      .all(actor.tenant_id)
      .map(mapInvoice);
  }

  setInvoiceDocumentStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!["draft", "issued", "void"].includes(status)) throw error("invalid_invoice_document_status");
    const invoice = this.invoice(actor, id);
    if (invoice.document_status === "void") throw error("invoice_void");
    this.db.prepare("UPDATE invoices SET document_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, now(), id, actor.tenant_id);
    this.audit(actor, "invoice.document_status", "invoice", id, invoice.portable_id, `Invoice document status changed to ${status}`, { from: invoice.document_status, to: status });
    return this.invoice(actor, id);
  }

  recordInvoicePayment(actor, id, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    const input = z.object({ amount_paid_cents: z.number().int().nonnegative(), note: z.string().nullable().optional() }).parse(payload);
    const invoice = this.invoice(actor, id);
    if (invoice.document_status === "void") throw error("invoice_void");
    const status = paymentStatus(invoice.total_cents, input.amount_paid_cents);
    const balance = invoice.total_cents - input.amount_paid_cents;
    this.db
      .prepare(
        "UPDATE invoices SET amount_paid_cents = ?, balance_due_cents = ?, payment_status = ?, historical_amount_paid_note = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      )
      .run(input.amount_paid_cents, balance, status, input.note ?? "Payment information is manually recorded.", now(), id, actor.tenant_id);
    this.audit(actor, "invoice.payment_status", "invoice", id, invoice.portable_id, `Invoice payment manually recorded as ${status}`, { amount_paid_cents: input.amount_paid_cents, balance_due_cents: balance });
    return this.invoice(actor, id);
  }

}

export const invoiceMethods = methodsFromClass(InvoiceDomainMethods);
