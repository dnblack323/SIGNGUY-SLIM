# Group C Production State Audit

Status: created before Group C implementation.

Scope: Hardening Group C only. This audit inventories current production-state
representations and defines the source-of-truth contract for `SLIM-001`, plus
the production slice of `SLIM-002` and `SLIM-003`.

Out of scope: employee/time/pay/messages modularization, remaining general
monolith decomposition, auth/session transport changes, and Stage 9
Facebook/Meta work.

## Current Representations

### Order Items

`order_items` is the commercial line-item table. It currently also stores
production state:

| Field | Current writer | Current reader | Intended meaning | Drift risk |
|---|---|---|---|---|
| `production_required` | Quote/Order creation, Order Workspace save, Estimate conversion | Order Workspace, Production board, Home attention, Calendar derived entries, Work Order grouping | Whether the customer-facing item requires shop production | Low if protected after release; high if changed after Work Order history exists |
| `production_stage` | Order creation default, Order Workspace save, `setProductionStage`, `setItemCompletion`, `setWorkOrderStage` compatibility update, Stage 8 backup restore | Order mapping, Order Workspace, Production board legacy rows, Home attention/derived calendar logic, PDF/bundle consumers indirectly through order item payloads, backup export/restore | Historically the operational stage for an Order Item | High. It can disagree with Work Order stage for released items |
| `completed` | Order creation default, Order Workspace save, `setProductionStage`, `setItemCompletion`, `setWorkOrderStage` compatibility update, Stage 8 backup restore | Order progress, Order Workspace, Production board, Home attention/derived calendar logic, backup export/restore | Historically whether item production is complete | High. It can disagree with `production_stage` and with Work Order completion |
| `due_date` | Estimate/Order creation and workspace save | Order Workspace, Production board legacy rows, Calendar links, Home attention | Desired production/delivery date for the commercial item | No source-of-truth conflict; scheduling remains separate |
| `assigned_user_id` | Estimate/Order creation and workspace save | Order Workspace, Production board legacy rows, Calendar defaults, backup restore | Preferred item-level assignment before or outside Work Order grouping | No production-state authority; must remain same-tenant |
| `title`, `description`, `quantity_decimal`, pricing fields | Quote/Order creation, workspace save subject to invoice lock | Work Order snapshots, PDFs, bundles, backup | Commercial/customer-facing description and price snapshot | Must stay owned by Order Item, not Work Order |

Current direct production-stage mutation paths:

- `prepareWorkspaceItems` accepts `production_stage` and `completed`.
- `insertOrderItems` can insert caller-provided `production_stage` and
  `completed`.
- `updateOrderItemsDifferential` writes `production_stage` and `completed`
  from the workspace payload.
- `setProductionStage` writes `order_items.production_stage` directly unless an
  active Work Order membership exists.
- `setItemCompletion` writes `order_items.completed` and
  `order_items.production_stage` directly unless an active Work Order
  membership exists.
- Backup restore writes `order_items.production_stage` and `completed` from the
  backup payload.

### Work Orders

`work_orders` is the operational production execution table created after an
Order is sent to production.

| Field | Current writer | Current reader | Intended meaning | Drift risk |
|---|---|---|---|---|
| `status` | Work Order creation, regroup cancellation | Work Order queries, Production board, Calendar validation | Whether a Work Order is active or cancelled | Medium. Cancelled Work Orders must not control current progress |
| `production_stage` | Work Order creation, `setWorkOrderStage`, `setWorkOrderCompletion`, backup restore after Group C | Work Order summary, Production board, Order summary, compatibility snapshot updates | Authoritative operational production stage for active Work Orders | Low after Group C if item snapshots are derived only |
| `completed` | Work Order creation, `setWorkOrderStage`, `setWorkOrderCompletion`, backup restore after Group C | Work Order summary, Production board, Order production progress | Compatibility boolean for complete stage | Medium. Must be constrained to match `production_stage = 'complete'` |
| `due_date`, `assigned_user_id`, `department_id` | Work Order creation from grouped Order Items; future schedule/admin edits if added | Production board, Calendar defaulting, summaries | Operational planning metadata | Not a production completion authority |
| `sent_to_production_at`, `created_by_user_id` | Send-to-production flow | Audit/traceability, backup | Release provenance | No production completion authority |
| `instructions_snapshot_json` | Work Order creation | Work Order summary/PDF-like operational views | Historical work packet snapshot of commercial item data | Should remain immutable history for the Work Order |

### Work Order Items

`work_order_items` links production-required Order Items to Work Orders.

| Field | Current writer | Current reader | Intended meaning | Drift risk |
|---|---|---|---|---|
| `work_order_id` | Send/regroup production | Work Order item lists, active assignment lookup | Parent operational production packet | Must be same-tenant and same-order |
| `order_item_id` | Send/regroup production | Work Order item lists, active assignment lookup | Commercial item being produced | Must be production-required and same-order |
| `active` | Send/regroup production | Current assignment selection, board, Order derivation | Whether this Work Order currently controls the item | High if more than one active assignment exists; partial unique index currently enforces one active assignment per item |
| `position` | Send/regroup production | Work Order summary ordering | Display order in Work Order | No state authority |

Current invariants:

- Migration `008_stage3_work_orders_bundles.sql` adds
  `ux_work_order_items_active_item`, which enforces one active Work Order item
  assignment per tenant/order item.
- Migration `009_stage3_hardening.sql` adds same-tenant and same-order triggers
  for Work Order items and Calendar Work Order links.
- The app currently treats `wo.status = 'active'` plus `woi.active = 1` as the
  current assignment.

## Current Derivations

### Order-Level Progress

Current `mapOrder` derives `production_progress` from Order Items:

- `total`: count of `items` where `production_required` is true.
- `completed`: count where `item.completed` is true.
- `production_status`: `complete`, `partially_complete`, or `not_started`
  based only on those item fields.

The detailed `order()` loader then overrides progress when active Work Orders
exist:

- `total`: active Work Order count.
- `completed`: active Work Orders with `completed` true or
  `production_stage = 'complete'`.
- `production_status`: `deriveProductionStatus(workOrders)`.

This creates two different progress models:

- Order list views use Order Item fields.
- Detail views with Work Orders use active Work Orders.

### Production Board

Current `productionBoard` returns two record types:

- `work_order`: active Work Orders. Stage and completion come from
  `work_orders`.
- `order_item`: production-required Order Items without active Work Order
  membership. Stage and completion currently come from `order_items`.

For staff users the response is passed through `stripFinancialFields`, which
removes pricing, totals, payment, allocation, margin, and related fields.

### Order Workspace

Current Order Workspace displays and edits Order Item production fields:

- `OrderItemsTable` exposes Stage and Done controls for each item.
- `OperationalStatusRail` counts stages from `form.items`.
- `OrderSummaryCard` falls back to item completion when no server progress is
  supplied.
- `ProductionSetupCard` creates or regroups Work Orders.

This means React can derive visible production status independently from the
Production board unless both consume the same backend-derived item state.

### Home Dashboard and Attention

Current `dashboard` uses `productionBoard`, so the production stage columns
follow whichever source the board uses. `attentionItems` currently queries
`order_items.completed = 0` directly for production due attention, so stale
Order Item completion can create false due/missed-production warnings.

### Calendar

Calendar has its own `calendar_events.status`. Calendar completion is changed by
`setCalendarStatus` and does not call Work Order production transitions. Work
Order completion does not update Calendar status. Work Order links are validated
for same-tenant and same-order relationships. Calendar status is scheduling
state only and must not become production authority.

### Backup/Restore

Current backup data includes `orders` and `order_items`, but not
`work_orders` or `work_order_items`. The frontend preview count groups already
expect those Work Order sections, but the backend exporter/restorer does not
populate them. As a result, a current backup can preserve legacy Order Item
production snapshots but cannot preserve released Work Order authority or
historical/cancelled Work Orders.

Schema `013_v2_stage7_8_messages_announcements.sql` backups are valid prior to
Group C and must remain previewable/restorable. They may not contain Work Order
sections, even when their source database had Work Orders.

## Conflict Cases

Group C must detect or deterministically handle these cases:

- Work Order `completed = 1` while `production_stage <> 'complete'`.
- Work Order `completed = 0` while `production_stage = 'complete'`.
- Production-required Order Item with no active Work Order but
  `production_stage` in `ready`, `in_progress`, `waiting`, or `complete`.
- Production-required Order Item with no active Work Order but `completed = 1`.
- Production-not-required Order Item with any operational stage or completed
  state.
- Released Order Item snapshot disagreeing with its active Work Order stage or
  completion.
- Multiple active Work Order item memberships for one Order Item.
- Cancelled or inactive Work Order item membership driving current production
  state.
- Calendar event completion being mistaken for production completion.
- Schema 013 backups restoring stale Order Item production snapshots as if they
  were current operational authority.

## Group C Source-of-Truth Contract

### Order Item Ownership

Order Item remains the first-class commercial/product object. It owns:

- what the customer ordered;
- title and description;
- quantity;
- price/tax/commercial snapshots;
- whether production is required;
- preferred due date and assignment before release;
- item identity and portability.

Order Item no longer owns operational production stage after Group C. The
legacy `order_items.production_stage` and `order_items.completed` columns remain
as compatibility snapshots only.

### Pre-Release Behavior

A production-required Order Item with no active Work Order derives:

- `production_stage = 'not_started'`;
- `completed = false`;
- `production_state_source = 'pre_release'`.

A production-not-required Order Item is excluded from production progress and
derives:

- `production_stage = 'not_started'`;
- `completed = false`;
- `production_state_source = 'not_required'`.

The application must not accept direct operational stage moves or completion
for unreleased Order Items. Releasing to production creates Work Orders, and
Work Orders then control operational state.

### Work Order Authority

Once a production-required Order Item has an active `work_order_items` row whose
parent Work Order has `status = 'active'`, that Work Order is authoritative for:

- operational stage;
- operational completion;
- current production progress;
- board placement;
- Order Workspace production display.

The Order Item response may expose the derived stage and completion for UI
compatibility, but the value must be derived from the active Work Order and not
from stale Order Item columns.

### Work Order Completion

Work Order completion means operational production execution is complete. The
canonical relationship is:

- `production_stage = 'complete'` implies `completed = 1`;
- any other production stage implies `completed = 0`.

Order Item completion is derived true only when its authoritative active Work
Order is complete. Order production is complete only when all
production-required Order Items derive complete. Order business status remains
separate and is not automatically changed by production completion.

### Grouping and Regrouping

One production-required Order Item may have at most one active Work Order
assignment at a time.

Definitions:

- Current Work Order: `work_orders.status = 'active'` and linked
  `work_order_items.active = 1`.
- Cancelled Work Order: `work_orders.status = 'cancelled'`; preserved as
  history and never current authority.
- Superseded membership: `work_order_items.active = 0`; preserved as history
  and never current authority.
- Completed Work Order: active Work Order with `production_stage = 'complete'`
  and `completed = 1`.
- Reopened Work Order: completed Work Order moved back to the existing
  `ACTIVE_REOPEN_STAGE` (`in_progress`) by an authorized manager role.

Regrouping cancels current Work Orders and deactivates their memberships before
creating replacement Work Orders. Future Calendar links must be explicitly
resolved as the existing regroup flow requires. Cancelled historical Work
Orders and inactive memberships remain for audit/history but do not drive
current status.

### Derived Item States

The shared derived state model is intentionally small:

- `not_started`: production required but not released to an active Work Order,
  or active Work Order is not started.
- `ready`: active Work Order exists and is ready.
- `in_progress`: active Work Order exists and is in progress.
- `waiting`: active Work Order exists and is waiting/blocked.
- `complete`: active/current Work Order is complete.

The API may translate Order-level summary status to existing dashboard labels
such as `partially_complete` or `blocked`, but those summaries must be derived
from the same item/Work Order authority.

## Migration Policy

Migration `014_hardening_production_source_of_truth.sql` is reserved for Group C.
It is additive and does not drop legacy Order Item columns.

Implemented behavior:

- Fail loudly if any existing Work Order has a stage/completed boolean mismatch,
  because that is an impossible operational state.
- Deterministically normalize non-authoritative Order Item compatibility
  snapshots:
  - active Work Order membership: copy active Work Order stage/completion onto
    the Order Item snapshot;
  - no active Work Order: store `not_started`/`0`;
  - non-production item: store `not_started`/`0`.
- Add triggers to prevent future Work Order stage/completed mismatch.
- Add triggers to keep Order Item compatibility snapshots from becoming a
  competing operational authority.

Schema 013 backups without Work Order sections remain compatible. Restore will
normalize their Order Item production snapshots to the pre-release contract
unless the backup contains Work Order sections that restore authoritative
state.

## Required Implementation Targets

Backend:

- Move production stage definitions and derivation rules into a focused
  production domain module.
- Make Order, Production board, Work Order summary, Home dashboard, and
  attention queries use the same derived production contract.
- Reject direct Order Item operational stage/completion mutation.
- Keep Work Order transition methods as the authorized operational mutation
  path.
- Synchronize legacy Order Item snapshots only from authoritative derived state.
- Preserve tenant scoping across Order, Order Item, Work Order, Work Order item,
  assignment user, and Calendar links.
- Preserve production staff financial redaction.
- Export and restore Work Orders and Work Order item relationships.

Frontend:

- Remove direct stage/done editing from the Order Items table.
- Display production status from backend-derived item state.
- Keep Production board actions operationally limited to Work Orders.
- Extract production-specific constants/helpers and board UI into
  `src/features/production/` without starting broad `App.jsx` decomposition.

Tests:

- Cover pre-release derivation, Work Order-derived states, stale Order Item
  conflict behavior, direct mutation rejection, grouping/regrouping authority,
  cancelled history exclusion, reopen derivation, Calendar independence, backup
  schema 013 compatibility, current backup round trip, tenant isolation,
  financial redaction, and frontend board/workspace agreement.

## Group C Implementation Result

Group C keeps the schema compatible while changing the application contract:

- `backend/src/domains/production/state.js` owns the shared stage list,
  Work Order normalization, Order Item derived state, and Order-level
  production summary rules.
- `backend/src/domains/production/queries.js` owns active Work Order selection
  and the shared active-Work-Order completion predicate used by Calendar/Home
  production due queries.
- `backend/src/services.js` delegates production derivation to those helpers,
  rejects direct operational Order Item stage/completion mutation after release,
  synchronizes legacy Order Item snapshots only from active Work Orders, and
  keeps Production board/Home/Order Workspace summaries aligned.
- `src/features/production/ProductionPage.jsx` and
  `src/features/production/productionState.js` hold the Production board UI and
  helper logic extracted from `src/App.jsx`.
- `014_hardening_production_source_of_truth.sql` constrains Work Order
  `completed` to match `production_stage`, prevents invalid Order Item
  production snapshots, syncs compatibility snapshots from active Work Orders,
  and prevents active Work Order item links to cancelled Work Orders.
- Backup/restore now exports and restores Work Orders and Work Order item links,
  accepts prior schema `012`/`013` backups, normalizes older Order Item
  snapshots to pre-release state when no Work Order authority is present, and
  validates active Work Order relationship integrity during preview.

This pass does not start employee/time/pay/messages modularization, the
remaining general monolith decomposition, auth/session transport changes, or
Stage 9 Facebook/Meta work.
