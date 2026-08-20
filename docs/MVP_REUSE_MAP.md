# MVP Reuse Map - Version 1 Part 1

MVP reference inspected from `C:\Users\thesi\Documents\GitHub\SIGNGUY-MVP-REFERENCE`
after fetching `origin/main` on August 20, 2026. The reference push URL was
`DISABLED`.

| Area | MVP source | Reuse decision | Slim destination | Adaptation / removed behavior |
| --- | --- | --- | --- | --- |
| App shell layout | `frontend/src/components/app-shell/AppShell.jsx` | Reusable after simplification | `src/App.jsx`, `src/navigation.js` | Preserve shell/ribbon shape. Remove full-product module registry, auth menus, notifications, assistant, portal, pricing, webstores, wrap lab, team/pay/time, email, and decision-room commands. |
| Navigation contract | `frontend/src/lib/navigation.js` | Reusable as a pattern only | `src/navigation.js` | Keep one locked Version 1 nav list. Do not port area/module hierarchy that exposes excluded products. |
| Workspace dock | `frontend/src/components/workspaces/WorkspaceDock.jsx`, `frontend/src/context/WorkspaceContext.jsx` | Reusable later after safe simplification | Planned for V1 Part 3 | Preserve URL-addressable workspace and unsaved-change behavior when Order Workspace is authorized. Remove assistant launcher and unrelated workspace types. |
| Customer model | `backend/app/models/customer.py` | Reusable after Slim reduction | Planned for V1 Part 2 | Keep tenant ID, contact name/business, email, phone, address, lifecycle. Add Slim tax-exempt fields. Remove merge/archive complexity unless required. |
| Quote/Estimate model | `backend/app/models/quote.py` | Reusable after Slim reduction | Planned for V1 Part 2 | Keep canonical Quote internals while presenting Estimate in UI. Remove Decision Room references and pricing-engine-derived behavior. |
| Order / Order Item model | `backend/app/models/order.py` | Reusable after Slim reduction | Planned for V1 Parts 2-3 | Keep tenant ID, customer link, manual cents totals, production-required flag, due date, status, source quote. Remove pricing snapshot engine fields from Slim behavior. |
| Invoice model | `backend/app/models/invoice.py` | Reusable after Slim reduction | Planned for V1 Part 2 | Keep one invoice per order, integer cents, document status distinct from financial status. Remove payment processor assumptions. |
| Calendar service | `backend/app/services/calendar_service.py` | Reusable later after safe simplification | Planned for V1 Part 4 | Keep tenant-scoped scheduling, source links, conflict concepts, audit. Remove employee/equipment/resource scheduling not authorized in Version 1. |
| Work order production | `backend/app/models/work_order.py`, `backend/app/services/work_order_service.py` | Reusable later after safe simplification | Planned for V1 Part 3 | Preserve canonical Work Order fields for order/customer links, item snapshots, production status, assignments, due dates, lifecycle timestamps, and notes. Avoid creating a second production task entity. |
| Attachments/files | `backend/app/models/file.py`, `backend/app/services/upload_validation.py` | Reusable later after storage boundary review | Planned for V1 Part 3 | Keep secure upload validation and tenant/object metadata. Exclude camera capture and annotation. |
| Notifications/reminders | `backend/app/models/notification.py`, `backend/app/services/notifications.py` | Reusable later after Slim reduction | Planned for V1 Part 4 | Keep in-app reminders and due/late derivation. Exclude messages, announcements, outbound email, SMS. |
| Pricing Engine and calculators | `backend/pricing_engine/**`, `frontend/src/pages/PricingCalculatorPage.jsx` | Explicitly excluded | None | Slim uses manually entered unit prices only. |
| AI, webstores, Stripe, portals, payroll/time, inventory, wrap lab, decision room, communications/email | Multiple MVP modules | Explicitly excluded | None | Must not be imported, routed, scaffolded, or advertised in Version 1 Part 1. |

## Part 1 Evidence

- Slim shell imports and dependencies are guarded by `tools/check-exclusions.mjs`.
- `npm run guard` proves excluded MVP/Version 2 frontend modules are not imported
  or installed as direct dependencies.
- `npm run test` verifies visible navigation, ribbon actions, dependency pins,
  parser coverage, and runtime UI copy do not expose incomplete feature pages.
