import * as shared from "../shared.js";
import { methodsFromClass } from "../install.js";

const {
  ACTIVE_REOPEN_STAGE,
  BUNDLE_DOCUMENT_TYPES,
  MANAGER_ROLES,
  PRODUCTION_STAGES,
  WRITE_ROLES,
  activeProductionWorkOrderForItem,
  bool,
  bundleSchema,
  canViewFinancials,
  compatibilitySnapshotForItem,
  completedForProductionStage,
  decorateOrderItemsWithProductionState,
  deriveOrderItemProductionState,
  documentTotals,
  error,
  isProductionStage,
  lineTotalCents,
  mapBundle,
  mapCalendarEvent,
  mapEstimate,
  mapInvoice,
  mapItem,
  mapOrder,
  mapWorkOrder,
  normalizeTitle,
  now,
  orderWorkspaceSchema,
  paymentStatus,
  portable,
  productionSetupSchema,
  quickItemSchema,
  randomUUID,
  stripFinancialFields,
  today,
  workspaceItemSchema,
  z,
} = shared;

class OrderDomainMethods {
  validateSameTenantUser(actor, userId) {
    if (!userId) return null;
    const user = this.db.prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND active = 1").get(userId, actor.tenant_id);
    if (!user) throw error("assigned_user_not_same_tenant", 400);
    return userId;
  }

  prepareItems(actor, items) {
    return z.array(quickItemSchema).min(1).parse(items).map((item, position) => ({
      ...item,
      position,
      title: normalizeTitle(item.title),
      assigned_user_id: this.validateSameTenantUser(actor, item.assigned_user_id ?? null),
      line_total_cents: lineTotalCents(item.quantity_decimal, item.unit_price_cents),
    }));
  }

  prepareWorkspaceItems(actor, items) {
    return z.array(workspaceItemSchema).min(1).parse(items).map((item, position) => ({
      ...item,
      position,
      title: normalizeTitle(item.title),
      production_stage: "not_started",
      completed: false,
      assigned_user_id: this.validateSameTenantUser(actor, item.assigned_user_id ?? null),
      line_total_cents: lineTotalCents(item.quantity_decimal, item.unit_price_cents),
    }));
  }

  insertOrderItems(actor, orderId, items, timestamp = now()) {
    for (const item of items) {
      this.db
        .prepare(
          `INSERT INTO order_items
           (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, title, description, quantity_decimal,
            unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
            assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(item.id || randomUUID(), item.portable_id || portable("order_item"), actor.tenant_id, orderId, item.source_estimate_item_id ?? null, item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), "not_started", 0, item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    }
  }

  auditProductionTransitions(actor, current, next, timestamp) {
    if (current.production_stage !== next.production_stage) {
      this.audit(actor, "production.stage_move", "order_item", current.id, current.portable_id, `Item moved from ${current.production_stage} to ${next.production_stage}`, { from: current.production_stage, to: next.production_stage, order_id: current.order_id });
    }
    if (!current.completed && next.completed) {
      this.audit(actor, "production.complete", "order_item", current.id, current.portable_id, "Production item completed", { order_id: current.order_id, stage: next.production_stage, occurred_with_order_updated_at: timestamp });
    }
    if (current.completed && !next.completed) {
      this.audit(actor, "production.reopen", "order_item", current.id, current.portable_id, "Production item reopened", { order_id: current.order_id, stage: next.production_stage, occurred_with_order_updated_at: timestamp });
    }
  }

  activeWorkOrderMembership(actor, orderItemId) {
    return activeProductionWorkOrderForItem(this.db, actor.tenant_id, orderItemId);
  }

  syncWorkOrderItemProductionSnapshots(actor, workOrderId, timestamp = now()) {
    const workOrder = this.db.prepare("SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?").get(workOrderId, actor.tenant_id);
    if (!workOrder) throw error("work_order_not_found", 404);
    const completed = completedForProductionStage(workOrder.production_stage);
    this.db
      .prepare(
        `UPDATE order_items
         SET production_stage = ?, completed = ?, updated_at = ?
         WHERE tenant_id = ?
           AND id IN (
             SELECT order_item_id
             FROM work_order_items
             WHERE tenant_id = ? AND work_order_id = ? AND active = 1
           )`,
      )
      .run(workOrder.production_stage, bool(completed), timestamp, actor.tenant_id, actor.tenant_id, workOrderId);
  }

  syncOrderProductionSnapshots(actor, orderId, timestamp = now()) {
    const activeWorkOrders = this.workOrderRows(actor, orderId);
    for (const workOrder of activeWorkOrders) this.syncWorkOrderItemProductionSnapshots(actor, workOrder.id, timestamp);
    this.db
      .prepare(
        `UPDATE order_items
         SET production_stage = 'not_started', completed = 0, updated_at = ?
         WHERE tenant_id = ? AND order_id = ?
           AND (production_stage <> 'not_started' OR completed <> 0)
           AND NOT EXISTS (
             SELECT 1
             FROM work_order_items woi
             JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
             WHERE woi.tenant_id = order_items.tenant_id
               AND woi.order_item_id = order_items.id
               AND woi.active = 1
               AND wo.status = 'active'
           )`,
      )
      .run(timestamp, actor.tenant_id, orderId);
  }

  assertPostReleaseItemChanges(actor, existing, nextItems) {
    const released = Boolean(existing.sent_to_production_at || existing.work_orders?.length);
    if (!released) return;
    const currentById = new Map(existing.items.map((item) => [item.id, item]));
    const nextById = new Map(nextItems.filter((item) => item.id).map((item) => [item.id, item]));
    for (const current of existing.items) {
      const hasHistory = this.db.prepare("SELECT id FROM work_order_items WHERE tenant_id = ? AND order_item_id = ? LIMIT 1").get(actor.tenant_id, current.id);
      if (!nextById.has(current.id) && (current.production_required || hasHistory)) throw error("released_production_item_history_protected", 409);
    }
    for (const next of nextItems) {
      if (!next.id) {
        if (next.production_required) throw error("released_production_item_assignment_required", 409);
        continue;
      }
      const current = currentById.get(next.id);
      if (!current) continue;
      const activeMembership = this.activeWorkOrderMembership(actor, next.id);
      if (Boolean(current.production_required) !== Boolean(next.production_required)) throw error("released_production_required_change_requires_regroup", 409);
      if (activeMembership && (!["not_started", "ready"].includes(activeMembership.production_stage) || activeMembership.completed)) {
        const identityChanged =
          current.title !== next.title ||
          current.description !== next.description ||
          current.quantity_decimal !== next.quantity_decimal;
        if (identityChanged) throw error("started_work_order_item_history_protected", 409);
      }
    }
  }

  orderItemProductionSnapshot(actor, item) {
    if (!item.production_required) return { production_stage: "not_started", completed: false };
    return compatibilitySnapshotForItem(item, this.activeWorkOrderMembership(actor, item.id));
  }

  assertBundledItemChanges(actor, documentType, documentId, currentItems, nextItems) {
    const bundleRows = this.db
      .prepare("SELECT item_id FROM commercial_bundle_items WHERE tenant_id = ? AND document_type = ? AND document_id = ? AND active = 1")
      .all(actor.tenant_id, documentType, documentId);
    if (!bundleRows.length) return;
    const bundledIds = new Set(bundleRows.map((row) => row.item_id));
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const nextById = new Map(nextItems.filter((item) => item.id).map((item) => [item.id, item]));
    for (const itemId of bundledIds) {
      const current = currentById.get(itemId);
      const next = nextById.get(itemId);
      if (!current || !next) throw error("bundle_membership_requires_resave", 409);
      if (
        current.quantity_decimal !== next.quantity_decimal ||
        current.unit_price_cents !== next.unit_price_cents ||
        Boolean(current.taxable) !== Boolean(next.taxable)
      ) throw error("bundle_membership_requires_resave", 409);
    }
  }

  updateOrderItemsDifferential(actor, orderId, existingItems, nextItems, timestamp) {
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const submittedExistingIds = new Set();
    for (const item of nextItems) {
      if (!item.id) continue;
      if (!existingById.has(item.id)) throw error("order_item_not_found", 404);
      submittedExistingIds.add(item.id);
    }
    const tempPosition = this.db.prepare("UPDATE order_items SET position = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND order_id = ?");
    nextItems.forEach((item, index) => {
      if (item.id) tempPosition.run(-(index + 1), timestamp, item.id, actor.tenant_id, orderId);
    });
    for (const current of existingItems) {
      if (!submittedExistingIds.has(current.id)) {
        this.db.prepare("DELETE FROM order_items WHERE id = ? AND tenant_id = ? AND order_id = ?").run(current.id, actor.tenant_id, orderId);
      }
    }
    const update = this.db.prepare(
      `UPDATE order_items
       SET position = ?, title = ?, description = ?, quantity_decimal = ?, unit_price_cents = ?, line_total_cents = ?,
           taxable = ?, production_required = ?, production_stage = ?, completed = ?, due_date = ?,
           assigned_user_id = ?, internal_note = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND order_id = ?`,
    );
    const insert = this.db.prepare(
      `INSERT INTO order_items
       (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, title, description, quantity_decimal,
        unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
        assigned_user_id, internal_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of nextItems) {
      if (item.id) {
        const current = existingById.get(item.id);
        const next = { ...current, ...item };
        const snapshot = this.orderItemProductionSnapshot(actor, next);
        update.run(item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), snapshot.production_stage, bool(snapshot.completed), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, item.id, actor.tenant_id, orderId);
      } else {
        insert.run(randomUUID(), portable("order_item"), actor.tenant_id, orderId, item.position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), "not_started", 0, item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
      }
    }
  }

  assertInvoicedFinancialLock(existing, nextItems, nextDiscount) {
    if (nextDiscount !== undefined && nextDiscount !== existing.discount_cents) throw error("invoiced_order_financial_lock", 409);
    const currentIds = existing.items.map((item) => item.id);
    const nextIds = nextItems.map((item) => item.id).filter(Boolean);
    if (currentIds.length !== nextIds.length || currentIds.some((id, index) => nextIds[index] !== id)) throw error("invoiced_order_financial_lock", 409);
    const currentById = new Map(existing.items.map((item) => [item.id, item]));
    for (const next of nextItems) {
      const current = currentById.get(next.id);
      if (
        !current ||
        current.description !== next.description ||
        current.quantity_decimal !== next.quantity_decimal ||
        current.unit_price_cents !== next.unit_price_cents ||
        Boolean(current.taxable) !== Boolean(next.taxable)
      ) throw error("invoiced_order_financial_lock", 409);
    }
  }


  createOrder(actor, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z
      .object({
        customer_id: z.string().min(1),
        title: z.string().trim().min(1).max(160),
        document_date: z.string().default(today),
        due_date: z.string().nullable().optional(),
        status: z.enum(["draft", "active", "on_hold", "complete", "cancelled"]).default("draft"),
        discount_cents: z.number().int().nonnegative().default(0),
        internal_notes: z.string().nullable().optional(),
        items: z.array(quickItemSchema).min(1),
      })
      .parse(payload);
    this.customer(actor, input.customer_id);
    const items = this.prepareItems(actor, input.items);
    return this.transaction(() => this.createOrderInternal(actor, { ...input, items }));
  }

  createOrderInternal(actor, payload) {
    const snapshot = payload.snapshot ?? this.customerSnapshot(actor, payload.customer_id);
    const taxExempt = snapshot.customer_tax_exempt_snapshot ?? snapshot.tax_exempt;
    const taxRate = snapshot.tax_rate_basis_points_snapshot ?? snapshot.tax_rate;
    const totals = documentTotals(payload.items, payload.discount_cents ?? 0, taxRate, taxExempt);
    const id = randomUUID();
    const pid = portable("order");
    const timestamp = now();
    const number = this.nextNumber(actor.tenant_id, "order", "O");
    this.db
      .prepare(
        `INSERT INTO orders
         (id, portable_id, tenant_id, customer_id, source_estimate_id, order_number, document_date, due_date, status,
          customer_tax_exempt_snapshot, tax_rate_basis_points_snapshot, subtotal_cents, discount_cents, tax_cents, total_cents,
          internal_notes, title, production_grouping_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, pid, actor.tenant_id, payload.customer_id, payload.source_estimate_id ?? null, number, payload.document_date ?? today(), payload.due_date ?? null, payload.status ?? "draft", bool(taxExempt), taxRate, totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, payload.internal_notes ?? null, normalizeTitle(payload.title, `Order ${number}`), payload.production_grouping_mode ?? null, timestamp, timestamp);
    payload.items.forEach((item, position) => {
      this.db
        .prepare(
          `INSERT INTO order_items
           (id, portable_id, tenant_id, order_id, source_estimate_item_id, position, title, description, quantity_decimal,
            unit_price_cents, line_total_cents, taxable, production_required, production_stage, completed, due_date,
            assigned_user_id, internal_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), portable("order_item"), actor.tenant_id, id, item.source_estimate_item_id ?? null, position, item.title, item.description, item.quantity_decimal, item.unit_price_cents, item.line_total_cents, bool(item.taxable), bool(item.production_required), item.due_date ?? null, item.assigned_user_id ?? null, item.internal_note ?? null, timestamp, timestamp);
    });
    this.audit(actor, "order.create", "order", id, pid, `Order ${number} created`, totals);
    return this.order(actor, id);
  }

  listOrders(actor) {
    return this.db.prepare("SELECT * FROM orders WHERE tenant_id = ? ORDER BY order_number DESC").all(actor.tenant_id).map((row) => {
      const rawItems = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(row.id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
      const workOrders = this.workOrderRows(actor, row.id).map((workOrder) => mapWorkOrder(workOrder, this.workOrderItems(actor, workOrder.id)));
      const items = decorateOrderItemsWithProductionState(rawItems, workOrders);
      const order = mapOrder(row, items);
      order.customer_summary = this.db.prepare("SELECT contact_name, business_name FROM customers WHERE id = ? AND tenant_id = ?").get(row.customer_id, actor.tenant_id) ?? null;
      order.invoice = this.db.prepare("SELECT id, invoice_number, document_status, payment_status FROM invoices WHERE order_id = ? AND tenant_id = ?").get(row.id, actor.tenant_id) ?? null;
      return order;
    });
  }

  order(actor, id) {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?").get(id, actor.tenant_id);
    if (!row) throw error("order_not_found", 404);
    const workOrders = this.workOrderRows(actor, id).map((workOrder) => mapWorkOrder(workOrder, this.workOrderItems(actor, workOrder.id)));
    const rawItems = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
    const items = decorateOrderItemsWithProductionState(rawItems, workOrders);
    const order = mapOrder(row, items);
    order.work_orders = workOrders;
    order.invoice = this.db.prepare("SELECT id, invoice_number, document_status, payment_status FROM invoices WHERE order_id = ? AND tenant_id = ?").get(id, actor.tenant_id) ?? null;
    order.bundles = this.listCommercialBundles(actor, "order", id);
    return order;
  }

  orderWorkspace(actor, id) {
    const order = this.order(actor, id);
    return {
      order,
      customer: this.customer(actor, order.customer_id),
      users: this.users(actor).filter((user) => user.active),
      attachments: this.listOrderAttachments(actor, id),
    };
  }


  updateOrderWorkspace(actor, id, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = orderWorkspaceSchema.parse(payload);
    if (!Object.keys(input).filter((key) => key !== "expected_updated_at").length) throw error("no_updates");
    return this.transaction(() => {
      const existing = this.order(actor, id);
      if (input.expected_updated_at !== existing.updated_at) throw error("order_conflict", 409);
      const nextItems = input.items ? this.prepareWorkspaceItems(actor, input.items) : existing.items;
      if (input.items) this.assertPostReleaseItemChanges(actor, existing, nextItems);
      if (input.items) this.assertBundledItemChanges(actor, "order", id, existing.items, nextItems);
      if (existing.invoice && input.items) this.assertInvoicedFinancialLock(existing, nextItems, input.discount_cents);
      if (existing.invoice && input.discount_cents !== undefined && input.discount_cents !== existing.discount_cents) throw error("invoiced_order_financial_lock", 409);
      const totals = input.items || input.discount_cents !== undefined
        ? documentTotals(nextItems, input.discount_cents ?? existing.discount_cents, existing.tax_rate_basis_points_snapshot, existing.customer_tax_exempt_snapshot)
        : null;
      const timestamp = now();
      const fields = [];
      const values = [];
      for (const key of ["document_date", "due_date", "status", "internal_notes"]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
          fields.push(`${key} = ?`);
          values.push(input[key] ?? null);
        }
      }
      if (Object.prototype.hasOwnProperty.call(input, "title")) {
        fields.push("title = ?");
        values.push(normalizeTitle(input.title));
      }
      if (totals) {
        fields.push("subtotal_cents = ?", "discount_cents = ?", "tax_cents = ?", "total_cents = ?");
        values.push(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents);
      }
      fields.push("updated_at = ?");
      values.push(timestamp, id, actor.tenant_id, input.expected_updated_at);
      const result = this.db.prepare(`UPDATE orders SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ? AND updated_at = ?`).run(...values);
      if (result.changes !== 1) throw error("order_conflict", 409);
      if (input.items) {
        this.updateOrderItemsDifferential(actor, id, existing.items, nextItems, timestamp);
      }
      if (this.db.prepare("SELECT id FROM commercial_bundles WHERE tenant_id = ? AND document_type = 'order' AND document_id = ? AND active = 1 LIMIT 1").get(actor.tenant_id, id)) {
        this.recalculateDocumentTotalsForBundles(actor, "order", id);
        const invoice = this.db.prepare("SELECT id, document_status FROM invoices WHERE tenant_id = ? AND order_id = ?").get(actor.tenant_id, id);
        if (invoice?.document_status === "draft") this.recalculateDocumentTotalsForBundles(actor, "invoice", invoice.id);
      }
      const updated = this.order(actor, id);
      this.audit(actor, "order.workspace_update", "order", id, updated.portable_id, `Order ${updated.order_number} workspace saved`, { fields: Object.keys(input).filter((key) => key !== "expected_updated_at") });
      return this.orderWorkspace(actor, id);
    });
  }

  workOrderRows(actor, orderId) {
    return this.db
      .prepare(
        `SELECT wo.*, o.order_number, o.title AS order_title, o.status AS order_status, c.contact_name, c.business_name,
                u.display_name AS assigned_user_name, d.name AS department_name,
                COUNT(woi.order_item_id) AS item_count
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN users u ON u.id = wo.assigned_user_id AND u.tenant_id = wo.tenant_id
         LEFT JOIN schedule_departments d ON d.id = wo.department_id AND d.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.order_id = ? AND wo.status = 'active'
         GROUP BY wo.id
         ORDER BY wo.work_order_number`,
      )
      .all(actor.tenant_id, orderId);
  }

  workOrderItems(actor, workOrderId) {
    return this.db
      .prepare(
        `SELECT oi.*
         FROM work_order_items woi
         JOIN order_items oi ON oi.id = woi.order_item_id AND oi.tenant_id = woi.tenant_id
         WHERE woi.tenant_id = ? AND woi.work_order_id = ? AND woi.active = 1
         ORDER BY woi.position, oi.position`,
      )
      .all(actor.tenant_id, workOrderId)
      .map((row) => {
        const item = mapItem(row, "order_id");
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          quantity_decimal: item.quantity_decimal,
          production_required: item.production_required,
          production_stage: item.production_stage,
          completed: item.completed,
          due_date: item.due_date,
          assigned_user_id: item.assigned_user_id,
          internal_note: item.internal_note,
        };
      });
  }

  workOrderSchedules(actor, workOrderId) {
    const tenant = this.tenant(actor.tenant_id);
    return this.db
      .prepare(
        `SELECT ce.*, d.name AS department_name, d.color AS department_color, o.order_number, o.title AS order_title,
                wo.title AS work_order_title, wo.work_order_number, u.display_name AS assigned_user_name
         FROM calendar_events ce
         LEFT JOIN schedule_departments d ON d.id = ce.department_id AND d.tenant_id = ce.tenant_id
         LEFT JOIN orders o ON o.id = ce.order_id AND o.tenant_id = ce.tenant_id
         LEFT JOIN work_orders wo ON wo.id = ce.work_order_id AND wo.tenant_id = ce.tenant_id
         LEFT JOIN users u ON u.id = ce.assigned_user_id AND u.tenant_id = ce.tenant_id
         WHERE ce.tenant_id = ? AND ce.work_order_id = ?
         ORDER BY ce.start_at`,
      )
      .all(actor.tenant_id, workOrderId)
      .map((row) => mapCalendarEvent(row, tenant));
  }

  workOrdersForOrder(actor, orderId) {
    this.order(actor, orderId);
    return this.workOrderRows(actor, orderId).map((row) => mapWorkOrder(row, this.workOrderItems(actor, row.id), this.workOrderSchedules(actor, row.id)));
  }

  workOrderSummary(actor, id) {
    const row = this.db
      .prepare(
        `SELECT wo.*, o.order_number, o.title AS order_title, o.status AS order_status, c.contact_name, c.business_name,
                u.display_name AS assigned_user_name, d.name AS department_name,
                COUNT(woi.order_item_id) AS item_count
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN users u ON u.id = wo.assigned_user_id AND u.tenant_id = wo.tenant_id
         LEFT JOIN schedule_departments d ON d.id = wo.department_id AND d.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.id = ?
         GROUP BY wo.id`,
      )
      .get(actor.tenant_id, id);
    if (!row) throw error("work_order_not_found", 404);
    const summary = mapWorkOrder(row, this.workOrderItems(actor, id), this.workOrderSchedules(actor, id));
    return canViewFinancials(actor) ? summary : stripFinancialFields(summary);
  }

  normalizeProductionSetup(actor, order, payload) {
    const input = productionSetupSchema.parse(payload);
    const productionItems = order.items.filter((item) => item.production_required);
    if (!productionItems.length) throw error("production_items_required", 400);
    const byId = new Map(productionItems.map((item) => [item.id, item]));
    const groups = [];
    const seen = new Set();
    const seenGroupTitles = new Set();
    const addGroup = (title, ids, { enforceUniqueTitle = true } = {}) => {
      const cleanIds = ids.filter(Boolean);
      if (!cleanIds.length) throw error("production_group_empty", 400);
      const cleanTitle = normalizeTitle(title);
      if (!cleanTitle) throw error("production_group_title_required", 400);
      const titleKey = cleanTitle.toLowerCase();
      if (enforceUniqueTitle) {
        if (seenGroupTitles.has(titleKey)) throw error("production_group_title_duplicate", 400);
        seenGroupTitles.add(titleKey);
      }
      for (const id of cleanIds) {
        if (!byId.has(id)) throw error("production_item_not_found", 404);
        if (seen.has(id)) throw error("production_item_assigned_twice", 400);
        seen.add(id);
      }
      groups.push({ title: cleanTitle, item_ids: cleanIds });
    };
    if (input.mode === "whole_order") {
      addGroup(order.title, productionItems.map((item) => item.id));
    } else if (input.mode === "individual_items") {
      for (const item of productionItems) addGroup(item.title, [item.id], { enforceUniqueTitle: false });
    } else {
      for (const group of input.groups || []) addGroup(group.title, group.item_ids || []);
      for (const id of input.independent_item_ids || []) addGroup(byId.get(id)?.title || "Independent Item", [id]);
      if (seen.size !== productionItems.length) throw error("production_items_unassigned", 400);
    }
    if (seen.size !== productionItems.length) throw error("production_items_unassigned", 400);
    return { ...input, groups };
  }

  createWorkOrdersFromPlan(actor, order, plan, timestamp) {
    const orderItems = new Map(order.items.map((item) => [item.id, item]));
    const created = [];
    plan.groups.forEach((group) => {
      const groupItems = group.item_ids.map((id) => orderItems.get(id));
      const id = randomUUID();
      const pid = portable("work_order");
      const number = this.nextNumber(actor.tenant_id, "work_order", "WO");
      const dueDates = groupItems.map((item) => item.due_date || order.due_date).filter(Boolean).sort();
      const assigned = groupItems.map((item) => item.assigned_user_id).filter(Boolean);
      const sameAssigned = assigned.length && assigned.every((id) => id === assigned[0]) ? assigned[0] : null;
      const snapshot = {
        order_id: order.id,
        order_number: order.order_number,
        order_title: order.title,
        grouping_mode: plan.mode,
        items: groupItems.map((item) => ({
          order_item_id: item.id,
          title: item.title,
          description: item.description,
          quantity_decimal: item.quantity_decimal,
          due_date: item.due_date,
          assigned_user_id: item.assigned_user_id,
          internal_note: item.internal_note,
        })),
      };
      this.db
        .prepare(
          `INSERT INTO work_orders
           (id, portable_id, tenant_id, order_id, work_order_number, title, grouping_mode, production_stage, completed, status,
            due_date, assigned_user_id, department_id, instructions_snapshot_json, created_by_user_id, sent_to_production_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', 0, 'active', ?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(id, pid, actor.tenant_id, order.id, number, group.title, plan.mode, dueDates[0] || null, sameAssigned, JSON.stringify(snapshot), actor.id, timestamp, timestamp, timestamp);
      groupItems.forEach((item, position) => {
        this.db.prepare("INSERT INTO work_order_items (id, tenant_id, work_order_id, order_item_id, position, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(randomUUID(), actor.tenant_id, id, item.id, position, timestamp);
      });
      created.push({ id, portable_id: pid, title: group.title, item_ids: group.item_ids });
    });
    for (const workOrder of created) this.syncWorkOrderItemProductionSnapshots(actor, workOrder.id, timestamp);
    return created;
  }

  sendOrderToProduction(actor, orderId, payload) {
    this.requireRole(actor, MANAGER_ROLES);
    return this.transaction(() => {
      const existingRows = this.workOrderRows(actor, orderId);
      if (existingRows.length) {
        return { order: this.order(actor, orderId), work_orders: existingRows.map((row) => mapWorkOrder(row, this.workOrderItems(actor, row.id), this.workOrderSchedules(actor, row.id))), already_sent: true };
      }
      const order = this.order(actor, orderId);
      const plan = this.normalizeProductionSetup(actor, order, payload);
      const timestamp = now();
      const created = this.createWorkOrdersFromPlan(actor, order, plan, timestamp);
      this.db.prepare("UPDATE orders SET production_grouping_mode = ?, sent_to_production_at = ?, sent_to_production_by_user_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(plan.mode, timestamp, actor.id, timestamp, order.id, actor.tenant_id);
      this.syncOrderProductionSnapshots(actor, order.id, timestamp);
      this.audit(actor, "production.send_to_production", "order", order.id, order.portable_id, `Order ${order.order_number} sent to production`, { grouping_mode: plan.mode, work_orders: created });
      return { order: this.order(actor, orderId), work_orders: this.workOrdersForOrder(actor, orderId), already_sent: false };
    });
  }

  regroupOrderProduction(actor, orderId, payload) {
    return this.transaction(() => {
      const order = this.order(actor, orderId);
      const existing = this.workOrderRows(actor, orderId);
      if (!existing.length) return this.sendOrderToProduction(actor, orderId, payload);
      const existingIds = existing.map((row) => row.id);
      const oldWorkOrderPlaceholders = existingIds.map(() => "?").join(",");
      const timestamp = now();
      const hasStarted = existing.some((row) => !["not_started", "ready"].includes(row.production_stage) || row.completed);
      const futureEntries = this.db
        .prepare(
          `SELECT id, portable_id, title, work_order_id
           FROM calendar_events
           WHERE tenant_id = ?
             AND work_order_id IN (${oldWorkOrderPlaceholders})
             AND status = 'scheduled'
             AND start_at >= ?`,
        )
        .all(actor.tenant_id, ...existingIds, timestamp);
      if (hasStarted) {
        this.requireRole(actor, MANAGER_ROLES);
        const reason = normalizeTitle(payload?.reason || "");
        if (reason.length < 5) throw error("production_regroup_reason_required", 400);
        if (existing.some((row) => row.completed)) throw error("completed_work_order_reopen_required", 409);
        if (futureEntries.length && !payload?.calendar_resolution) throw error("calendar_resolution_required", 400);
      } else {
        this.requireRole(actor, WRITE_ROLES);
      }
      const plan = this.normalizeProductionSetup(actor, order, payload);
      this.db.prepare(`UPDATE work_order_items SET active = 0 WHERE tenant_id = ? AND work_order_id IN (${oldWorkOrderPlaceholders})`).run(actor.tenant_id, ...existingIds);
      this.db.prepare(`UPDATE work_orders SET status = 'cancelled', updated_at = ? WHERE tenant_id = ? AND id IN (${oldWorkOrderPlaceholders})`).run(timestamp, actor.tenant_id, ...existingIds);
      const created = this.createWorkOrdersFromPlan(actor, order, plan, timestamp);
      if (futureEntries.length && payload?.calendar_resolution === "return_to_order") {
        this.db.prepare(`UPDATE calendar_events SET work_order_id = NULL, updated_at = ? WHERE tenant_id = ? AND id IN (${futureEntries.map(() => "?").join(",")})`).run(timestamp, actor.tenant_id, ...futureEntries.map((entry) => entry.id));
      } else if (futureEntries.length && payload?.calendar_resolution === "cancel") {
        const reason = normalizeTitle(payload?.calendar_resolution_reason || payload?.reason || "");
        if (reason.length < 5) throw error("calendar_resolution_reason_required", 400);
        this.db.prepare(`UPDATE calendar_events SET status = 'cancelled', updated_at = ? WHERE tenant_id = ? AND id IN (${futureEntries.map(() => "?").join(",")})`).run(timestamp, actor.tenant_id, ...futureEntries.map((entry) => entry.id));
      } else if (futureEntries.length && payload?.calendar_resolution === "move_to_replacement") {
        const targetTitle = normalizeTitle(payload?.calendar_resolution_replacement_title || "");
        let target = null;
        if (targetTitle) target = created.find((entry) => entry.title.toLowerCase() === targetTitle.toLowerCase()) || null;
        if (!target && created.length === 1) target = created[0];
        if (!target) throw error("calendar_resolution_replacement_required", 400);
        this.db.prepare(`UPDATE calendar_events SET work_order_id = ?, updated_at = ? WHERE tenant_id = ? AND id IN (${futureEntries.map(() => "?").join(",")})`).run(target.id, timestamp, actor.tenant_id, ...futureEntries.map((entry) => entry.id));
      }
      this.db.prepare("UPDATE orders SET production_grouping_mode = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(plan.mode, timestamp, order.id, actor.tenant_id);
      this.syncOrderProductionSnapshots(actor, order.id, timestamp);
      if (futureEntries.length && payload?.calendar_resolution && payload.calendar_resolution !== "keep_original") {
        this.audit(actor, "calendar.work_order_resolution", "order", order.id, order.portable_id, "Future Work Order calendar entries resolved during regroup", { calendar_event_ids: futureEntries.map((entry) => entry.id), resolution: payload.calendar_resolution });
      }
      this.audit(actor, "production.regroup", "order", order.id, order.portable_id, `Order ${order.order_number} production regrouped`, { grouping_mode: plan.mode, work_orders: created, reason: payload?.reason || null, calendar_resolution: payload?.calendar_resolution || "keep_original" });
      return { order: this.order(actor, orderId), work_orders: this.workOrdersForOrder(actor, orderId) };
    });
  }

  setWorkOrderStage(actor, id, stage) {
    this.requireRole(actor, WRITE_ROLES);
    if (!isProductionStage(stage)) throw error("invalid_production_stage", 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM work_orders WHERE id = ? AND tenant_id = ? AND status = 'active'").get(id, actor.tenant_id);
      if (!row) throw error("work_order_not_found", 404);
      if ((row.completed || row.production_stage === "complete") && stage !== "complete") this.requireRole(actor, MANAGER_ROLES);
      const timestamp = now();
      const completed = completedForProductionStage(stage);
      this.db.prepare("UPDATE work_orders SET production_stage = ?, completed = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(stage, bool(completed), timestamp, id, actor.tenant_id);
      this.syncWorkOrderItemProductionSnapshots(actor, id, timestamp);
      this.db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, row.order_id, actor.tenant_id);
      this.audit(actor, "work_order.stage_move", "work_order", id, row.portable_id, `Work Order moved from ${row.production_stage} to ${stage}`, { from: row.production_stage, to: stage, order_id: row.order_id });
      if (row.completed && !completed) this.audit(actor, "work_order.reopen", "work_order", id, row.portable_id, "Work Order reopened", { from: row.production_stage, to: stage, order_id: row.order_id });
      return { work_order: this.workOrderSummary(actor, id), order_progress: this.order(actor, row.order_id).production_progress };
    });
  }

  setWorkOrderCompletion(actor, id, completed) {
    this.requireRole(actor, WRITE_ROLES);
    if (typeof completed !== "boolean") throw error("invalid_completion", 400);
    return this.setWorkOrderStage(actor, id, completed ? "complete" : ACTIVE_REOPEN_STAGE);
  }

  bundleDocument(actor, documentType, documentId) {
    if (!BUNDLE_DOCUMENT_TYPES.includes(documentType)) throw error("invalid_bundle_document", 400);
    if (documentType === "estimate") {
      const row = this.db.prepare("SELECT * FROM estimates WHERE id = ? AND tenant_id = ?").get(documentId, actor.tenant_id);
      if (!row) throw error("estimate_not_found", 404);
      const items = this.db.prepare("SELECT * FROM estimate_items WHERE estimate_id = ? AND tenant_id = ? ORDER BY position").all(documentId, actor.tenant_id).map((item) => mapItem(item, "estimate_id"));
      return { doc: mapEstimate(row, items), itemType: "estimate_item", sourceOrderId: null, finalized: Boolean(row.converted_order_id), items };
    }
    if (documentType === "order") {
      const row = this.db.prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?").get(documentId, actor.tenant_id);
      if (!row) throw error("order_not_found", 404);
      const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? AND tenant_id = ? ORDER BY position").all(documentId, actor.tenant_id).map((item) => mapItem(item, "order_id"));
      return { doc: mapOrder(row, items), itemType: "order_item", sourceOrderId: row.id, finalized: false, items };
    }
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ? AND tenant_id = ?").get(documentId, actor.tenant_id);
    if (!row) throw error("invoice_not_found", 404);
    const items = this.db.prepare("SELECT oi.* FROM order_items oi WHERE oi.order_id = ? AND oi.tenant_id = ? ORDER BY oi.position").all(row.order_id, actor.tenant_id).map((item) => mapItem(item, "order_id"));
    return { doc: mapInvoice(row), itemType: "order_item", sourceOrderId: row.order_id, finalized: row.document_status !== "draft", items };
  }

  bundleAdjustedItems(actor, documentType, documentId, items) {
    const allocations = this.db
      .prepare(
        `SELECT cbi.item_id, cbi.allocated_cents
         FROM commercial_bundle_items cbi
         JOIN commercial_bundles cb ON cb.id = cbi.bundle_id AND cb.tenant_id = cbi.tenant_id
         WHERE cbi.tenant_id = ?
           AND cbi.document_type = ?
           AND cbi.document_id = ?
           AND cbi.active = 1
           AND cb.active = 1`,
      )
      .all(actor.tenant_id, documentType, documentId);
    const allocatedByItem = new Map(allocations.map((row) => [row.item_id, row.allocated_cents]));
    return items.map((item) => allocatedByItem.has(item.id) ? { ...item, line_total_cents: allocatedByItem.get(item.id) } : item);
  }

  recalculateDocumentTotalsForBundles(actor, documentType, documentId) {
    const document = this.bundleDocument(actor, documentType, documentId);
    const adjustedItems = this.bundleAdjustedItems(actor, documentType, documentId, document.items);
    const totals = documentTotals(adjustedItems, document.doc.discount_cents, document.doc.tax_rate_basis_points_snapshot, document.doc.customer_tax_exempt_snapshot);
    const timestamp = now();
    if (documentType === "estimate") {
      this.db
        .prepare("UPDATE estimates SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, timestamp, documentId, actor.tenant_id);
    } else if (documentType === "order") {
      this.db
        .prepare("UPDATE orders SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, timestamp, documentId, actor.tenant_id);
    } else {
      const balance = totals.total_cents - document.doc.amount_paid_cents;
      if (balance < 0) throw error("invoice_payment_exceeds_repriced_total", 409);
      const status = paymentStatus(totals.total_cents, document.doc.amount_paid_cents);
      this.db
        .prepare("UPDATE invoices SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?, balance_due_cents = ?, payment_status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(totals.subtotal_cents, totals.discount_cents, totals.tax_cents, totals.total_cents, balance, status, timestamp, documentId, actor.tenant_id);
    }
    return totals;
  }

  assertBundleDocumentEditable(actor, documentType, documentId) {
    if (documentType !== "order") return;
    const invoice = this.db.prepare("SELECT id, document_status FROM invoices WHERE tenant_id = ? AND order_id = ?").get(actor.tenant_id, documentId);
    if (invoice && invoice.document_status !== "draft") throw error("bundle_document_locked", 409);
  }

  allocationForBundle(bundle, items) {
    const subtotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
    const target = bundle.pricing_mode === "bundle_price" ? bundle.manual_total_cents : subtotal;
    if (bundle.pricing_mode === "bundle_price") {
      if (!Number.isInteger(bundle.manual_total_cents) || bundle.manual_total_cents < 0) throw error("invalid_bundle_total", 400);
      if (!normalizeTitle(bundle.override_reason || "")) throw error("bundle_override_reason_required", 400);
    }
    if (target === 0) return items.map((item) => ({ item_id: item.id, allocated_cents: 0 }));
    if (subtotal === 0) {
      const base = Math.floor(target / items.length);
      let remainder = target - base * items.length;
      return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((item) => {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        return { item_id: item.id, allocated_cents: base + extra };
      });
    }
    let allocated = 0;
    const rows = items.map((item) => {
      const cents = Math.floor((target * item.line_total_cents) / subtotal);
      allocated += cents;
      return { item_id: item.id, allocated_cents: cents, weight: item.line_total_cents };
    });
    let remainder = target - allocated;
    rows.sort((a, b) => b.weight - a.weight || String(a.item_id).localeCompare(String(b.item_id)));
    for (const row of rows) {
      if (!remainder) break;
      row.allocated_cents += 1;
      remainder -= 1;
    }
    return rows.map(({ item_id, allocated_cents }) => ({ item_id, allocated_cents }));
  }

  listCommercialBundles(actor, documentType, documentId) {
    const document = this.bundleDocument(actor, documentType, documentId);
    const itemMap = new Map(document.items.map((item) => [item.id, item]));
    return this.db
      .prepare("SELECT * FROM commercial_bundles WHERE tenant_id = ? AND document_type = ? AND document_id = ? AND active = 1 ORDER BY display_order, title")
      .all(actor.tenant_id, documentType, documentId)
      .map((bundle) => {
        const items = this.db
          .prepare("SELECT * FROM commercial_bundle_items WHERE tenant_id = ? AND bundle_id = ? AND active = 1 ORDER BY rowid")
          .all(actor.tenant_id, bundle.id)
          .map((row) => ({ ...itemMap.get(row.item_id), allocated_cents: row.allocated_cents }))
          .filter(Boolean);
        return mapBundle(bundle, items);
      });
  }

  saveCommercialBundles(actor, documentType, documentId, payload) {
    this.requireRole(actor, WRITE_ROLES);
    const input = z.object({ bundles: z.array(bundleSchema).default([]) }).parse(payload);
    return this.transaction(() => {
      const document = this.bundleDocument(actor, documentType, documentId);
      if (document.finalized) throw error("bundle_document_locked", 409);
      this.assertBundleDocumentEditable(actor, documentType, documentId);
      const itemMap = new Map(document.items.map((item) => [item.id, item]));
      const assigned = new Set();
      const timestamp = now();
      const prepared = input.bundles.map((bundle, index) => {
        const itemIds = bundle.item_ids;
        for (const id of itemIds) {
          if (!itemMap.has(id)) throw error("bundle_item_not_found", 404);
          if (assigned.has(id)) throw error("bundle_item_assigned_twice", 400);
          assigned.add(id);
        }
        const items = itemIds.map((id) => itemMap.get(id));
        const allocation = this.allocationForBundle(bundle, items);
        return { ...bundle, display_order: bundle.display_order ?? index, items, allocation };
      });
      this.db.prepare("UPDATE commercial_bundle_items SET active = 0 WHERE tenant_id = ? AND document_type = ? AND document_id = ?").run(actor.tenant_id, documentType, documentId);
      this.db.prepare("UPDATE commercial_bundles SET active = 0, updated_at = ? WHERE tenant_id = ? AND document_type = ? AND document_id = ?").run(timestamp, actor.tenant_id, documentType, documentId);
      const created = [];
      for (const bundle of prepared) {
        const id = randomUUID();
        const pid = portable("commercial_bundle");
        const total = bundle.pricing_mode === "bundle_price" ? bundle.manual_total_cents : bundle.items.reduce((sum, item) => sum + item.line_total_cents, 0);
        const snapshot = {
          pricing_mode: bundle.pricing_mode,
          total_cents: total,
          allocation: bundle.allocation,
          source_line_totals: bundle.items.map((item) => ({ item_id: item.id, line_total_cents: item.line_total_cents, taxable: item.taxable })),
        };
        this.db
          .prepare(
            `INSERT INTO commercial_bundles
             (id, portable_id, tenant_id, document_type, document_id, source_order_id, title, description, display_order,
              pricing_mode, manual_total_cents, override_reason, show_member_prices, allocation_snapshot_json, active, created_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .run(id, pid, actor.tenant_id, documentType, documentId, document.sourceOrderId, bundle.title, bundle.description || null, bundle.display_order, bundle.pricing_mode, bundle.pricing_mode === "bundle_price" ? bundle.manual_total_cents : null, bundle.override_reason || null, bool(bundle.show_member_prices), JSON.stringify(snapshot), actor.id, timestamp, timestamp);
        const allocationById = new Map(bundle.allocation.map((entry) => [entry.item_id, entry.allocated_cents]));
        for (const item of bundle.items) {
          this.db.prepare("INSERT INTO commercial_bundle_items (id, tenant_id, bundle_id, document_type, document_id, item_type, item_id, allocated_cents, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").run(randomUUID(), actor.tenant_id, id, documentType, documentId, document.itemType, item.id, allocationById.get(item.id), timestamp);
        }
        created.push({ id, title: bundle.title, item_ids: bundle.item_ids, pricing_mode: bundle.pricing_mode, total_cents: total });
      }
      const totals = this.recalculateDocumentTotalsForBundles(actor, documentType, documentId);
      if (documentType === "order") {
        const invoice = this.db.prepare("SELECT id, document_status FROM invoices WHERE tenant_id = ? AND order_id = ?").get(actor.tenant_id, documentId);
        if (invoice?.document_status === "draft") {
          this.copyBundles(actor, "order", documentId, "invoice", invoice.id);
        }
      }
      this.audit(actor, "commercial_bundle.save", documentType, documentId, document.doc.portable_id, `${documentType} bundle presentation saved`, { bundles: created });
      return { items: this.listCommercialBundles(actor, documentType, documentId), totals };
    });
  }

  copyBundles(actor, fromType, fromId, toType, toId, itemIdMap = new Map()) {
    const source = this.listCommercialBundles(actor, fromType, fromId);
    if (!source.length) return;
    const bundles = source.map((bundle) => ({
      title: bundle.title,
      description: bundle.description,
      display_order: bundle.display_order,
      pricing_mode: bundle.pricing_mode,
      manual_total_cents: bundle.manual_total_cents,
      override_reason: bundle.override_reason || "Copied from source document",
      show_member_prices: bundle.show_member_prices,
      item_ids: bundle.items.map((item) => itemIdMap.get(item.id) || item.id).filter(Boolean),
    })).filter((bundle) => bundle.item_ids.length);
    if (bundles.length) this.saveCommercialBundles(actor, toType, toId, { bundles });
  }

  productionBoard(actor, filters = {}) {
    const users = new Map(this.users(actor).map((user) => [user.id, user]));
    const workOrders = this.db
      .prepare(
        `SELECT wo.*, o.order_number, o.title AS order_title, o.status AS order_status, c.contact_name, c.business_name,
                u.display_name AS assigned_user_name, d.name AS department_name, COUNT(woi.order_item_id) AS item_count
         FROM work_orders wo
         JOIN orders o ON o.id = wo.order_id AND o.tenant_id = wo.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = wo.tenant_id
         LEFT JOIN work_order_items woi ON woi.work_order_id = wo.id AND woi.tenant_id = wo.tenant_id AND woi.active = 1
         LEFT JOIN users u ON u.id = wo.assigned_user_id AND u.tenant_id = wo.tenant_id
         LEFT JOIN schedule_departments d ON d.id = wo.department_id AND d.tenant_id = wo.tenant_id
         WHERE wo.tenant_id = ? AND wo.status = 'active'
         GROUP BY wo.id
         ORDER BY COALESCE(wo.due_date, '9999-12-31'), wo.work_order_number`,
      )
      .all(actor.tenant_id)
      .map((row) => {
        const workOrder = mapWorkOrder(row, this.workOrderItems(actor, row.id));
        const completed = completedForProductionStage(workOrder.production_stage);
        return {
          ...workOrder,
          record_type: "work_order",
          stage_mutable: true,
          description: workOrder.items.map((item) => item.title).join(", "),
          assigned_user: row.assigned_user_id ? users.get(row.assigned_user_id) || null : null,
          late: Boolean(workOrder.due_date && workOrder.due_date < today() && workOrder.production_stage !== "complete"),
          production_progress: { completed: completed ? 1 : 0, total: 1, percent: completed ? 100 : 0 },
        };
      });
    const legacyItems = this.db
      .prepare(
        `SELECT oi.*, o.order_number, o.title AS order_title, o.status AS order_status, o.due_date AS order_due_date, c.contact_name, c.business_name
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
         JOIN customers c ON c.id = o.customer_id AND c.tenant_id = oi.tenant_id
         WHERE oi.tenant_id = ? AND oi.production_required = 1
           AND NOT EXISTS (
             SELECT 1 FROM work_order_items woi
             JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
             WHERE woi.tenant_id = oi.tenant_id AND woi.order_item_id = oi.id AND woi.active = 1 AND wo.status = 'active'
           )
         ORDER BY COALESCE(oi.due_date, o.due_date, '9999-12-31'), o.order_number, oi.position`,
      )
      .all(actor.tenant_id)
      .map((row) => {
        const mapped = mapItem(row, "order_id");
        const item = { ...mapped, ...deriveOrderItemProductionState(mapped) };
        const effectiveDueDate = item.due_date || row.order_due_date || null;
        return {
          ...item,
          record_type: "order_item",
          stage_mutable: false,
          due_date: effectiveDueDate,
          item_due_date: item.due_date,
          order_due_date: row.order_due_date,
          order_number: row.order_number,
          order_title: row.order_title,
          order_status: row.order_status,
          customer_name: row.business_name || row.contact_name,
          assigned_user: row.assigned_user_id ? users.get(row.assigned_user_id) || null : null,
          late: Boolean(effectiveDueDate && effectiveDueDate < today() && item.production_stage !== "complete"),
          production_progress: this.order(actor, row.order_id).production_progress,
        };
      });
    const rows = [...workOrders, ...legacyItems]
      .filter((row) => !filters.stage || filters.stage === "all" || row.production_stage === filters.stage)
      .filter((row) => !filters.assigned_user_id || filters.assigned_user_id === "all" || (filters.assigned_user_id === "unassigned" ? !row.assigned_user_id : row.assigned_user_id === filters.assigned_user_id))
      .filter((row) => filters.due_state !== "late" || row.late)
      .filter(() => !filters.due_state || filters.due_state === "all" || filters.due_state === "late");
    const response = { stages: PRODUCTION_STAGES, items: rows, users: [...users.values()].filter((user) => user.active) };
    return canViewFinancials(actor) ? response : stripFinancialFields(response);
  }

  setProductionStage(actor, itemId, stage) {
    this.requireRole(actor, WRITE_ROLES);
    if (!isProductionStage(stage)) throw error("invalid_production_stage", 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM order_items WHERE id = ? AND tenant_id = ?").get(itemId, actor.tenant_id);
      if (!row) throw error("order_item_not_found", 404);
      if (this.activeWorkOrderMembership(actor, itemId)) throw error("work_order_item_stage_managed_by_work_order", 409);
      if (stage !== "not_started") throw error("order_item_production_requires_work_order", 409);
      const timestamp = now();
      this.db.prepare("UPDATE order_items SET production_stage = 'not_started', completed = 0, updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, itemId, actor.tenant_id);
      this.db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, row.order_id, actor.tenant_id);
      const order = this.order(actor, row.order_id);
      return { item: order.items.find((item) => item.id === itemId), order_progress: order.production_progress };
    });
  }

  setItemCompletion(actor, itemId, completed) {
    this.requireRole(actor, WRITE_ROLES);
    if (typeof completed !== "boolean") throw error("invalid_completion", 400);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM order_items WHERE id = ? AND tenant_id = ?").get(itemId, actor.tenant_id);
      if (!row) throw error("order_item_not_found", 404);
      if (this.activeWorkOrderMembership(actor, itemId)) throw error("work_order_item_stage_managed_by_work_order", 409);
      if (completed) throw error("order_item_production_requires_work_order", 409);
      const timestamp = now();
      this.db.prepare("UPDATE order_items SET completed = 0, production_stage = 'not_started', updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, itemId, actor.tenant_id);
      this.db.prepare("UPDATE orders SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(timestamp, row.order_id, actor.tenant_id);
      const order = this.order(actor, row.order_id);
      return { item: order.items.find((item) => item.id === itemId), order_progress: order.production_progress };
    });
  }


  updateOrderStatus(actor, id, status) {
    this.requireRole(actor, WRITE_ROLES);
    if (!["draft", "active", "on_hold", "complete", "cancelled"].includes(status)) throw error("invalid_order_status");
    return this.transaction(() => {
      const order = this.order(actor, id);
      this.db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(status, now(), id, actor.tenant_id);
      this.audit(actor, "order.status", "order", id, order.portable_id, `Order status changed to ${status}`, { from: order.status, to: status });
      return this.order(actor, id);
    });
  }

}

export const orderMethods = methodsFromClass(OrderDomainMethods);
