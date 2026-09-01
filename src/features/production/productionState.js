export const PRODUCTION_STAGES = ["not_started", "ready", "in_progress", "waiting", "complete"];

export const STAGE_LABELS = {
  not_started: "Not Started",
  ready: "Ready",
  in_progress: "In Progress",
  waiting: "Waiting",
  complete: "Complete",
};

export function productionStageIndex(stage) {
  return PRODUCTION_STAGES.indexOf(stage || "not_started");
}

export function canMoveProductionRecord(record) {
  return record?.record_type === "work_order" && record.stage_mutable !== false;
}

export function progressParts(progress, fallbackItems = []) {
  if (progress) return progress;
  const required = fallbackItems.filter((item) => item.production_required);
  const completed = required.filter((item) => item.completed || item.production_stage === "complete");
  return { completed: completed.length, total: required.length, percent: required.length ? Math.round((completed.length / required.length) * 100) : null };
}

export function productionSetupPreview(mode, items, groups, assignments) {
  const productionItems = items.filter((item) => item.production_required);
  if (mode === "whole_order") return productionItems.length ? [{ title: "Entire Order", count: productionItems.length }] : [];
  if (mode === "individual_items") return productionItems.map((item) => ({ title: item.title || item.description, count: 1 }));
  const custom = groups
    .map((group) => ({ title: group.title || "Untitled group", count: productionItems.filter((item) => assignments[item.id || item.client_id] === group.client_id).length }))
    .filter((entry) => entry.count);
  const independent = productionItems.filter((item) => assignments[item.id || item.client_id] === "independent").map((item) => ({ title: item.title || item.description, count: 1 }));
  return [...custom, ...independent];
}
