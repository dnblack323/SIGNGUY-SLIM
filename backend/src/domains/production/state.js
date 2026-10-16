export const PRODUCTION_STAGES = ["not_started", "ready", "in_progress", "waiting", "complete"];
export const ACTIVE_REOPEN_STAGE = "in_progress";

// 7-stage physical Kanban pipeline (migration 020). Used by the shop-floor
// Production board and the kiosk. `department_stage` on work_orders is the
// authoritative column.
export const DEPARTMENT_STAGES = ["design", "cnc", "print", "assembly", "paint", "install", "done"];
export const DEPARTMENT_STAGE_LABELS = {
  design: "Design / Proof",
  cnc: "Router / CNC",
  print: "Print / Vinyl",
  assembly: "Assembly",
  paint: "Paint / Finishing",
  install: "Install / Shipping",
  done: "Done",
};

export function isDepartmentStage(stage) {
  return DEPARTMENT_STAGES.includes(stage);
}

export function isProductionStage(stage) {
  return PRODUCTION_STAGES.includes(stage);
}

export function completedForProductionStage(stage) {
  return stage === "complete";
}

export function normalizeWorkOrderState(workOrder) {
  if (!workOrder) return null;
  return {
    ...workOrder,
    production_stage: workOrder.production_stage || "not_started",
    completed: completedForProductionStage(workOrder.production_stage),
  };
}

export function deriveOrderItemProductionState(item, activeWorkOrder = null) {
  if (!item?.production_required) {
    return {
      production_stage: "not_started",
      completed: false,
      production_state_source: "not_required",
      current_work_order_id: null,
      current_work_order_number: null,
      current_work_order_title: null,
    };
  }

  const workOrder = normalizeWorkOrderState(activeWorkOrder);
  if (!workOrder || workOrder.status === "cancelled") {
    return {
      production_stage: "not_started",
      completed: false,
      production_state_source: "pre_release",
      current_work_order_id: null,
      current_work_order_number: null,
      current_work_order_title: null,
    };
  }

  return {
    production_stage: workOrder.production_stage,
    completed: workOrder.completed,
    production_state_source: "work_order",
    current_work_order_id: workOrder.id,
    current_work_order_number: workOrder.work_order_number || null,
    current_work_order_title: workOrder.title || null,
  };
}

export function decorateOrderItemsWithProductionState(items = [], workOrders = []) {
  const activeByItemId = new Map();
  for (const workOrder of workOrders) {
    if (workOrder.status === "cancelled") continue;
    for (const item of workOrder.items || []) {
      activeByItemId.set(item.id, workOrder);
    }
  }
  return items.map((item) => ({
    ...item,
    ...deriveOrderItemProductionState(item, activeByItemId.get(item.id)),
  }));
}

export function productionProgress(items = []) {
  const productionItems = items.filter((item) => item.production_required);
  const completed = productionItems.filter((item) => item.completed).length;
  const total = productionItems.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : null,
  };
}

export function deriveProductionStatusFromItems(items = []) {
  const productionItems = items.filter((item) => item.production_required);
  if (!productionItems.length) return "not_started";
  if (productionItems.every((item) => item.completed || item.production_stage === "complete")) return "complete";
  if (productionItems.some((item) => item.production_stage === "waiting")) return "blocked";
  if (productionItems.some((item) => item.completed || !["not_started", "ready"].includes(item.production_stage))) return "partially_complete";
  if (productionItems.some((item) => item.production_stage === "ready")) return "in_progress";
  return "not_started";
}

export function deriveOrderProductionSummary(items = []) {
  return {
    production_progress: productionProgress(items),
    production_status: deriveProductionStatusFromItems(items),
  };
}

export function compatibilitySnapshotForItem(item, activeWorkOrder = null) {
  const state = deriveOrderItemProductionState(item, activeWorkOrder);
  return {
    production_stage: state.production_stage,
    completed: state.completed,
  };
}
