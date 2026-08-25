-- migrate:up
PRAGMA foreign_keys = ON;

CREATE TRIGGER trg_work_orders_same_tenant_order_insert
BEFORE INSERT ON work_orders
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'work_order_order_tenant_mismatch') END;
  SELECT CASE WHEN NEW.assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.assigned_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'work_order_assignee_tenant_mismatch') END;
  SELECT CASE WHEN NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM schedule_departments d WHERE d.id = NEW.department_id AND d.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'work_order_department_tenant_mismatch') END;
END;

CREATE TRIGGER trg_work_orders_same_tenant_order_update
BEFORE UPDATE OF tenant_id, order_id, assigned_user_id, department_id ON work_orders
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'work_order_order_tenant_mismatch') END;
  SELECT CASE WHEN NEW.assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.assigned_user_id AND u.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'work_order_assignee_tenant_mismatch') END;
  SELECT CASE WHEN NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM schedule_departments d WHERE d.id = NEW.department_id AND d.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'work_order_department_tenant_mismatch') END;
END;

CREATE TRIGGER trg_work_order_items_membership_insert
BEFORE INSERT ON work_order_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM work_orders wo
    JOIN order_items oi ON oi.id = NEW.order_item_id
    WHERE wo.id = NEW.work_order_id
      AND wo.tenant_id = NEW.tenant_id
      AND oi.tenant_id = NEW.tenant_id
      AND oi.order_id = wo.order_id
      AND oi.production_required = 1
  ) THEN RAISE(ABORT, 'work_order_item_relationship_invalid') END;
END;

CREATE TRIGGER trg_work_order_items_membership_update
BEFORE UPDATE OF tenant_id, work_order_id, order_item_id, active ON work_order_items
BEGIN
  SELECT CASE WHEN NEW.active = 1 AND NOT EXISTS (
    SELECT 1
    FROM work_orders wo
    JOIN order_items oi ON oi.id = NEW.order_item_id
    WHERE wo.id = NEW.work_order_id
      AND wo.tenant_id = NEW.tenant_id
      AND oi.tenant_id = NEW.tenant_id
      AND oi.order_id = wo.order_id
      AND oi.production_required = 1
  ) THEN RAISE(ABORT, 'work_order_item_relationship_invalid') END;
END;

CREATE TRIGGER trg_order_items_preserve_work_order_history_delete
BEFORE DELETE ON order_items
WHEN EXISTS (SELECT 1 FROM work_order_items woi WHERE woi.order_item_id = OLD.id AND woi.tenant_id = OLD.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'work_order_item_history_protected');
END;

CREATE TRIGGER trg_work_orders_preserve_history_delete
BEFORE DELETE ON work_orders
WHEN EXISTS (SELECT 1 FROM work_order_items woi WHERE woi.work_order_id = OLD.id AND woi.tenant_id = OLD.tenant_id)
  OR EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.work_order_id = OLD.id AND ce.tenant_id = OLD.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'work_order_history_protected');
END;

CREATE TRIGGER trg_calendar_work_order_links_insert
BEFORE INSERT ON calendar_events
WHEN NEW.work_order_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM work_orders wo WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'calendar_work_order_tenant_mismatch') END;
  SELECT CASE WHEN NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_orders wo WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id AND wo.order_id = NEW.order_id
  ) THEN RAISE(ABORT, 'calendar_work_order_order_mismatch') END;
  SELECT CASE WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM work_order_items woi
    JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
    WHERE woi.tenant_id = NEW.tenant_id
      AND woi.work_order_id = NEW.work_order_id
      AND woi.order_item_id = NEW.order_item_id
      AND woi.active = 1
      AND (NEW.order_id IS NULL OR wo.order_id = NEW.order_id)
  ) THEN RAISE(ABORT, 'calendar_work_order_item_mismatch') END;
END;

CREATE TRIGGER trg_calendar_work_order_links_update
BEFORE UPDATE OF tenant_id, order_id, order_item_id, work_order_id ON calendar_events
WHEN NEW.work_order_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM work_orders wo WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'calendar_work_order_tenant_mismatch') END;
  SELECT CASE WHEN NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_orders wo WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id AND wo.order_id = NEW.order_id
  ) THEN RAISE(ABORT, 'calendar_work_order_order_mismatch') END;
  SELECT CASE WHEN NEW.order_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM work_order_items woi
    JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
    WHERE woi.tenant_id = NEW.tenant_id
      AND woi.work_order_id = NEW.work_order_id
      AND woi.order_item_id = NEW.order_item_id
      AND woi.active = 1
      AND (NEW.order_id IS NULL OR wo.order_id = NEW.order_id)
  ) THEN RAISE(ABORT, 'calendar_work_order_item_mismatch') END;
END;

CREATE TRIGGER trg_commercial_bundles_document_insert
BEFORE INSERT ON commercial_bundles
BEGIN
  SELECT CASE WHEN NEW.document_type = 'estimate' AND NOT EXISTS (
    SELECT 1 FROM estimates e WHERE e.id = NEW.document_id AND e.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'bundle_document_invalid') END;
  SELECT CASE WHEN NEW.document_type = 'order' AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.document_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'bundle_document_invalid') END;
  SELECT CASE WHEN NEW.document_type = 'invoice' AND NOT EXISTS (
    SELECT 1 FROM invoices i WHERE i.id = NEW.document_id AND i.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'bundle_document_invalid') END;
  SELECT CASE WHEN NEW.source_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.source_order_id AND o.tenant_id = NEW.tenant_id
  ) THEN RAISE(ABORT, 'bundle_source_order_invalid') END;
END;

CREATE TRIGGER trg_commercial_bundle_items_membership_insert
BEFORE INSERT ON commercial_bundle_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM commercial_bundles cb
    WHERE cb.id = NEW.bundle_id
      AND cb.tenant_id = NEW.tenant_id
      AND cb.document_type = NEW.document_type
      AND cb.document_id = NEW.document_id
  ) THEN RAISE(ABORT, 'bundle_item_bundle_mismatch') END;
  SELECT CASE WHEN NEW.item_type = 'estimate_item' AND NOT EXISTS (
    SELECT 1 FROM estimate_items ei
    WHERE ei.id = NEW.item_id
      AND ei.tenant_id = NEW.tenant_id
      AND ei.estimate_id = NEW.document_id
      AND NEW.document_type = 'estimate'
  ) THEN RAISE(ABORT, 'bundle_item_document_mismatch') END;
  SELECT CASE WHEN NEW.item_type = 'order_item' AND NEW.document_type = 'order' AND NOT EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.id = NEW.item_id
      AND oi.tenant_id = NEW.tenant_id
      AND oi.order_id = NEW.document_id
  ) THEN RAISE(ABORT, 'bundle_item_document_mismatch') END;
  SELECT CASE WHEN NEW.item_type = 'order_item' AND NEW.document_type = 'invoice' AND NOT EXISTS (
    SELECT 1
    FROM invoices i
    JOIN order_items oi ON oi.order_id = i.order_id AND oi.tenant_id = i.tenant_id
    WHERE i.id = NEW.document_id
      AND i.tenant_id = NEW.tenant_id
      AND oi.id = NEW.item_id
  ) THEN RAISE(ABORT, 'bundle_item_document_mismatch') END;
  SELECT CASE WHEN NEW.allocated_cents IS NOT NULL AND NEW.allocated_cents < 0
    THEN RAISE(ABORT, 'bundle_allocation_invalid') END;
END;

CREATE TRIGGER trg_commercial_bundles_preserve_history_delete
BEFORE DELETE ON commercial_bundles
BEGIN
  SELECT RAISE(ABORT, 'bundle_history_protected');
END;

CREATE INDEX idx_work_order_items_tenant_order_item ON work_order_items(tenant_id, order_item_id, active);
CREATE INDEX idx_commercial_bundle_items_doc_item ON commercial_bundle_items(tenant_id, document_type, document_id, item_id, active);

-- migrate:down
DROP INDEX IF EXISTS idx_commercial_bundle_items_doc_item;
DROP INDEX IF EXISTS idx_work_order_items_tenant_order_item;
DROP TRIGGER IF EXISTS trg_commercial_bundles_preserve_history_delete;
DROP TRIGGER IF EXISTS trg_commercial_bundle_items_membership_insert;
DROP TRIGGER IF EXISTS trg_commercial_bundles_document_insert;
DROP TRIGGER IF EXISTS trg_calendar_work_order_links_update;
DROP TRIGGER IF EXISTS trg_calendar_work_order_links_insert;
DROP TRIGGER IF EXISTS trg_work_orders_preserve_history_delete;
DROP TRIGGER IF EXISTS trg_order_items_preserve_work_order_history_delete;
DROP TRIGGER IF EXISTS trg_work_order_items_membership_update;
DROP TRIGGER IF EXISTS trg_work_order_items_membership_insert;
DROP TRIGGER IF EXISTS trg_work_orders_same_tenant_order_update;
DROP TRIGGER IF EXISTS trg_work_orders_same_tenant_order_insert;
