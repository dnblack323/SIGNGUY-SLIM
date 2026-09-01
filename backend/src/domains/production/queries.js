export function activeProductionWorkOrderForItem(db, tenantId, orderItemId) {
  return db
    .prepare(
      `SELECT wo.*
       FROM work_order_items woi
       JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
       WHERE woi.tenant_id = ? AND woi.order_item_id = ? AND woi.active = 1 AND wo.status = 'active'
       LIMIT 1`,
    )
    .get(tenantId, orderItemId);
}

export function activeProductionWorkOrderCompletionPredicate(itemAlias = "oi") {
  return `EXISTS (
    SELECT 1
    FROM work_order_items woi
    JOIN work_orders wo ON wo.id = woi.work_order_id AND wo.tenant_id = woi.tenant_id
    WHERE woi.tenant_id = ${itemAlias}.tenant_id
      AND woi.order_item_id = ${itemAlias}.id
      AND woi.active = 1
      AND wo.status = 'active'
      AND wo.production_stage = 'complete'
  )`;
}
