import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  WRITE_ROLES,
  bool,
  documentTotals,
  error,
  mapEstimate,
  mapItem,
  now,
  portable,
  quickItemSchema,
  randomUUID,
  today,
  z,
} = shared;

class QuoteDomainMethods {
  customerSnapshot(actor, customerId) {
    const customer = this.customer(actor, customerId);
    const tenant = this.tenant(actor.tenant_id);
    return { customer, tenant, tax_exempt: customer.tax_exempt, tax_rate: tenant.sales_tax_rate_basis_points };
  }

  createEstimate(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        customer_id: z.string().min(1),
        document_date: z.string().default(today),
        expires_at: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
        status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).default("draft"),
        discount_cents: z.number().int().nonnegative().default(0),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1),
      })
      .parse(payload);
    const items = this.prepareItems(actor, input.items);
    const snapshot = this.customerSnapshot(actor, input.customer_id);
    const totals = documentTotals(items, input.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
    return this.transaction(() => {
      const id = randomUUID();
      const pid = portable("estimate");
      const timestamp = now();
      const number = this.nextNumber(actor.tenant_id, "estimate", "E");
      this.db
        .prepare(
          `INSERT INTO estimates
           (id, portable_id, tenant_id, customer_id, estimate_number, document_date, expires_at, follow_up_at, status,
            customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
            internal_notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, input.customer_id, number, input.document_date, input.expires_at ?? null, input.follow_up_at ?? null, input.status, bool(snapshot.tax_exempt), snapshot.tax_rate, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, input.internal_notes ?? null, timestamp, timestamp);
      this.insertEstimateItems(actor, id, items, timestamp);
      this.audit(actor, "estimate.create", "estimate", id, pid, `Quote ${number} created`, totals);
      return this.estimate(actor, id);
    });
  }

  insertEstimateItems(actor, estimateId, items, timestamp = now()) {
    for (const item of items) {
      this.db
        .prepare(
          `INSERT INTO estimate_items
           (id, portable_id, tenant_id, estimate_id, position, title, description, quantity_decimal, unit_price_cents, line_total_cents,
            taxable, production_required, due_date, assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(item.id || randomUUID(), portable("estimate_item"), actor.tenant_id, estimateId, item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    }
  }

  estimate(actor, id) {
    const row = this.db.prepare("SELECT * FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("estimate_not_found", 404);
    const items = this.db
      .prepare("SELECT * FROM estimate_items WHERE estimate_id = ? AND tenant_id = ? ORDER BY position")
      .all(id, actor.tenant_id)
      .map((item) => mapItem(item, "estimate_id"));
    const estimate = mapEstimate(row, items);
    estimate.bundles = this.listCommercialBundles(actor, "estimate", id);
    return estimate;
  }

  listEstimates(actor) {
    return this.db.prepare("SELECT * FROM estimates WHERE tenant_id = ? ORDER BY estimate_number DESC").all(actor.tenant_id).map((row) => mapEstimate(row));
  }

  updateEstimate(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const existing = this.estimate(actor, id);
    if (existing.converted_order_id) throw error("converted_estimate_locked", 409);
    const input = z
      .object({
        document_date: z.string().optional(),
        expires_at: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
        status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).optional(),
        discount_cents: z.number().int().nonnegative().optional(),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1).optional(),
      })
      .parse(payload);
    if (!Object.keys(input).length) throw error("no_updates");
    const fields = [];
    const values = [];
    return this.transaction(() => {
      if (input.items || input.discount_cents !== undefined) {
        const snapshot = { tax_exempt: existing.customer_tax_exempt_snapshot, tax_rate: existing.tax_rate_basis_points_snapshot };
        const items = input.items ? this.prepareItems(actor, input.items) : existing.items;
        if (input.items) this.assertBundledItemChanges(actor, "estimate", id, existing.items, items);
        const totals = documentTotals(items, input.discount_cents ?? existing.discount_cents, snapshot.tax_rate, snapshot.tax_exempt);
        Object.assign(input, totals);
        if (input.items) {
          this.db.prepare("DELETE FROM estimate_items WHERE estimate_id = ? AND tenant_id = ?").run(id, actor.tenant_id);
          this.insertEstimateItems(actor, id, items);
        }
      }
      for (const [key, value] of Object.entries(input)) {
        if (key === "items") continue;
        fields.push(`${key} = ?`);
        values.push(typeof value === "boolean" ? bool(value) : value ?? null);
      }
      fields.push("updated_at = ?");
      values.push(now(), id, actor.tenant_id);
      this.db.prepare(`UPDATE estimates SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values);
      if (this.db.prepare("SELECT id FROM commercial_bundles WHERE tenant_id = ? AND document_type = 'estimate' AND document_id = ? AND active = 1 LIMIT 1").get(actor.tenant_id, id)) {
        this.recalculateDocumentTotalsForBundles(actor, "estimate", id);
      }
      const updated = this.estimate(actor, id);
      this.audit(actor, "estimate.update", "estimate", id, updated.portable_id, "Quote updated", input);
      return updated;
    });
  }

  duplicateEstimate(actor, id) {
    const source = this.estimate(actor, id);
    return this.createEstimate(actor, {
      customer_id: source.customer_id,
      document_date: today(),
      expires_at: source.expires_at,
      follow_up_at: source.follow_up_at,
      status: "draft",
      discount_cents: source.discount_cents,
      internal_notes: source.internal_notes,
      items: source.items.map(({ title, description, quantity_decimal, unit_price_cents, taxable, production_required, due_date, assigned_user_id, internal_note }) => ({
        title,
        description,
        quantity_decimal,
        unit_price_cents,
        taxable,
        production_required,
        due_date,
        assigned_user_id,
        internal_note,
      })),
    });
  }

  convertEstimate(actor, id) {
    this.requireRole(actor, WRITE_ROLES);
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT converted_order_id FROM estimates WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
      if (!existing) throw error("estimate_not_found", 404);
      if (existing.converted_order_id) {
        const order = this.order(actor, existing.converted_order_id);
        return { order, already_converted: true };
      }
      const estimate = this.estimate(actor, id);
      const order = this.createOrderInternal(actor, {
        customer_id: estimate.customer_id,
        source_estimate_id: id,
        title: `Order from Quote ${estimate.estimate_number}`,
        document_date: today(),
        due_date: null,
        status: "active",
        discount_cents: estimate.discount_cents,
        internal_notes: estimate.internal_notes,
        snapshot: {
          customer_tax_exempt_snapshot: estimate.customer_tax_exempt_snapshot,
          tax_rate_basis_points_snapshot: estimate.tax_rate_basis_points_snapshot,
        },
        items: estimate.items.map((item) => ({
          ...item,
          source_estimate_item_id: item.id,
        })),
      });
      const itemIdMap = new Map(order.items.map((item) => [item.source_estimate_item_id, item.id]));
      this.copyBundles(actor, "estimate", id, "order", order.id, itemIdMap);
      this.db.prepare("UPDATE estimates SET status = 'accepted', converted_order_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(order.id, now(), id, actor.tenant_id);
      this.audit(actor, "estimate.convert", "estimate", id, estimate.portable_id, `Quote ${estimate.estimate_number} converted to ${order.order_number}`, { order_id: order.id });
      return { order: this.order(actor, order.id), already_converted: false };
    });
  }

}

export const quoteMethods = methodsFromClass(QuoteDomainMethods);
