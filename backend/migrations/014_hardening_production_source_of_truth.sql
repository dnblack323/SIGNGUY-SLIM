-- migrate:up

CREATE TEMP TABLE group_c_migration_guard(value INTEGER CHECK(value = 0));

INSERT INTO group_c_migration_guard(value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM work_orders
  WHERE (production_stage = 'complete' AND completed <> 1)
     OR (production_stage <> 'complete' AND completed <> 0)
);

DROP TABLE group_c_migration_guard;

UPDATE work_order_items
SET active = 0
WHERE active = 1
  AND EXISTS (
    SELECT 1
    FROM work_orders wo
    WHERE wo.id = work_order_items.work_order_id
      AND wo.tenant_id = work_order_items.tenant_id
      AND wo.status = 'cancelled'
  );

UPDATE order_items
SET production_stage = 'not_started',
    completed = 0
WHERE production_required = 0
  AND (production_stage <> 'not_started' OR completed <> 0);

UPDATE order_items
SET production_stage = (
      SELECT wo.production_stage
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = order_items.tenant_id
        AND woi.order_item_id = order_items.id
        AND woi.active = 1
        AND wo.status = 'active'
      LIMIT 1
    ),
    completed = (
      SELECT CASE WHEN wo.production_stage = 'complete' THEN 1 ELSE 0 END
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = order_items.tenant_id
        AND woi.order_item_id = order_items.id
        AND woi.active = 1
        AND wo.status = 'active'
      LIMIT 1
    )
WHERE production_required = 1
  AND EXISTS (
    SELECT 1
    FROM work_order_items woi
    JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
    WHERE woi.tenant_id = order_items.tenant_id
      AND woi.order_item_id = order_items.id
      AND woi.active = 1
      AND wo.status = 'active'
  );

UPDATE order_items
SET production_stage = 'not_started',
    completed = 0
WHERE production_required = 1
  AND NOT EXISTS (
    SELECT 1
    FROM work_order_items woi
    JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
    WHERE woi.tenant_id = order_items.tenant_id
      AND woi.order_item_id = order_items.id
      AND woi.active = 1
      AND wo.status = 'active'
  )
  AND (production_stage <> 'not_started' OR completed <> 0);

CREATE TRIGGER trg_work_orders_completed_matches_stage_insert
BEFORE INSERT ON work_orders
WHEN (NEW.production_stage = 'complete' AND NEW.completed <> 1)
  OR (NEW.production_stage <> 'complete' AND NEW.completed <> 0)
BEGIN
  SELECT RAISE(ABORT, 'work_order_stage_completed_conflict');
END;

CREATE TRIGGER trg_work_orders_completed_matches_stage_update
BEFORE UPDATE OF production_stage, completed ON work_orders
WHEN (NEW.production_stage = 'complete' AND NEW.completed <> 1)
  OR (NEW.production_stage <> 'complete' AND NEW.completed <> 0)
BEGIN
  SELECT RAISE(ABORT, 'work_order_stage_completed_conflict');
END;

CREATE TRIGGER trg_work_orders_cancel_requires_inactive_items
BEFORE UPDATE OF status ON work_orders
WHEN NEW.status = 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM work_order_items
    WHERE tenant_id = NEW.tenant_id
      AND work_order_id = NEW.id
      AND active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'active_work_order_items_must_be_inactivated');
END;

CREATE TRIGGER trg_work_order_items_active_requires_active_work_order_insert
BEFORE INSERT ON work_order_items
WHEN NEW.active = 1
  AND EXISTS (
    SELECT 1
    FROM work_orders
    WHERE id = NEW.work_order_id
      AND tenant_id = NEW.tenant_id
      AND status <> 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'active_work_order_item_requires_active_work_order');
END;

CREATE TRIGGER trg_work_order_items_active_requires_active_work_order_update
BEFORE UPDATE OF active, work_order_id ON work_order_items
WHEN NEW.active = 1
  AND EXISTS (
    SELECT 1
    FROM work_orders
    WHERE id = NEW.work_order_id
      AND tenant_id = NEW.tenant_id
      AND status <> 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'active_work_order_item_requires_active_work_order');
END;

CREATE TRIGGER trg_order_items_production_snapshot_insert
BEFORE INSERT ON order_items
WHEN (
    NEW.production_required = 0
    AND (NEW.production_stage <> 'not_started' OR NEW.completed <> 0)
  )
  OR (
    NEW.production_required = 1
    AND NOT EXISTS (
      SELECT 1
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = NEW.tenant_id
        AND woi.order_item_id = NEW.id
        AND woi.active = 1
        AND wo.status = 'active'
    )
    AND (NEW.production_stage <> 'not_started' OR NEW.completed <> 0)
  )
  OR (
    NEW.production_required = 1
    AND EXISTS (
      SELECT 1
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = NEW.tenant_id
        AND woi.order_item_id = NEW.id
        AND woi.active = 1
        AND wo.status = 'active'
        AND (NEW.production_stage <> wo.production_stage OR NEW.completed <> CASE WHEN wo.production_stage = 'complete' THEN 1 ELSE 0 END)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'order_item_production_snapshot_invalid');
END;

CREATE TRIGGER trg_order_items_production_snapshot_update
BEFORE UPDATE OF production_required, production_stage, completed ON order_items
WHEN (
    NEW.production_required = 0
    AND (NEW.production_stage <> 'not_started' OR NEW.completed <> 0)
  )
  OR (
    NEW.production_required = 1
    AND NOT EXISTS (
      SELECT 1
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = NEW.tenant_id
        AND woi.order_item_id = NEW.id
        AND woi.active = 1
        AND wo.status = 'active'
    )
    AND (NEW.production_stage <> 'not_started' OR NEW.completed <> 0)
  )
  OR (
    NEW.production_required = 1
    AND EXISTS (
      SELECT 1
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = NEW.tenant_id
        AND woi.order_item_id = NEW.id
        AND woi.active = 1
        AND wo.status = 'active'
        AND (NEW.production_stage <> wo.production_stage OR NEW.completed <> CASE WHEN wo.production_stage = 'complete' THEN 1 ELSE 0 END)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'order_item_production_snapshot_invalid');
END;

CREATE TRIGGER trg_work_order_items_sync_snapshot_insert
AFTER INSERT ON work_order_items
WHEN NEW.active = 1
BEGIN
  UPDATE order_items
  SET production_stage = (
        SELECT wo.production_stage
        FROM work_orders wo
        WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id
      ),
      completed = (
        SELECT CASE WHEN wo.production_stage = 'complete' THEN 1 ELSE 0 END
        FROM work_orders wo
        WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.order_item_id
    AND tenant_id = NEW.tenant_id
    AND EXISTS (
      SELECT 1
      FROM work_orders wo
      WHERE wo.id = NEW.work_order_id
        AND wo.tenant_id = NEW.tenant_id
        AND wo.status = 'active'
    );
END;

CREATE TRIGGER trg_work_order_items_sync_snapshot_update
AFTER UPDATE OF active, work_order_id, order_item_id ON work_order_items
BEGIN
  UPDATE order_items
  SET production_stage = 'not_started',
      completed = 0,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.order_item_id
    AND tenant_id = OLD.tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
      WHERE woi.tenant_id = OLD.tenant_id
        AND woi.order_item_id = OLD.order_item_id
        AND woi.active = 1
        AND wo.status = 'active'
    );

  UPDATE order_items
  SET production_stage = (
        SELECT wo.production_stage
        FROM work_orders wo
        WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id
      ),
      completed = (
        SELECT CASE WHEN wo.production_stage = 'complete' THEN 1 ELSE 0 END
        FROM work_orders wo
        WHERE wo.id = NEW.work_order_id AND wo.tenant_id = NEW.tenant_id
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.order_item_id
    AND tenant_id = NEW.tenant_id
    AND NEW.active = 1
    AND EXISTS (
      SELECT 1
      FROM work_orders wo
      WHERE wo.id = NEW.work_order_id
        AND wo.tenant_id = NEW.tenant_id
        AND wo.status = 'active'
    );
END;

CREATE TRIGGER trg_work_orders_sync_snapshot_update
AFTER UPDATE OF production_stage, completed ON work_orders
WHEN NEW.status = 'active'
BEGIN
  UPDATE order_items
  SET production_stage = NEW.production_stage,
      completed = CASE WHEN NEW.production_stage = 'complete' THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
  WHERE tenant_id = NEW.tenant_id
    AND id IN (
      SELECT order_item_id
      FROM work_order_items
      WHERE tenant_id = NEW.tenant_id
        AND work_order_id = NEW.id
        AND active = 1
    );
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_work_orders_sync_snapshot_update;
DROP TRIGGER IF EXISTS trg_work_order_items_sync_snapshot_update;
DROP TRIGGER IF EXISTS trg_work_order_items_sync_snapshot_insert;
DROP TRIGGER IF EXISTS trg_order_items_production_snapshot_update;
DROP TRIGGER IF EXISTS trg_order_items_production_snapshot_insert;
DROP TRIGGER IF EXISTS trg_work_order_items_active_requires_active_work_order_update;
DROP TRIGGER IF EXISTS trg_work_order_items_active_requires_active_work_order_insert;
DROP TRIGGER IF EXISTS trg_work_orders_cancel_requires_inactive_items;
DROP TRIGGER IF EXISTS trg_work_orders_completed_matches_stage_update;
DROP TRIGGER IF EXISTS trg_work_orders_completed_matches_stage_insert;
