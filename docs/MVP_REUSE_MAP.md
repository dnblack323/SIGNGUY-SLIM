# MVP Reuse Map - Version 1 Part 2

MVP reference inspected from `C:\Users\thesi\Documents\GitHub\SIGNGUY-MVP-REFERENCE`
after fetching `origin/main` on August 20, 2026. The reference push URL was
`DISABLED`.

| Area | MVP source | Reuse decision | Slim destination | Adaptation / removed behavior |
| --- | --- | --- | --- | --- |
| App shell layout | `frontend/src/components/app-shell/AppShell.jsx` | Reusable after simplification | `src/App.jsx`, `src/navigation.js` | Preserve shell/ribbon shape. Remove full-product module registry, auth menus, notifications, assistant, portal, pricing, webstores, wrap lab, team/pay/time, email, and decision-room commands. |
| Navigation contract | `frontend/src/lib/navigation.js` | Reusable as a pattern only | `src/navigation.js` | Keep one locked Version 1 nav list. Do not port area/module hierarchy that exposes excluded products. |
| Workspace dock | `frontend/src/components/workspaces/WorkspaceDock.jsx`, `frontend/src/context/WorkspaceContext.jsx` | Reusable later after safe simplification | Planned for V1 Part 3 | Preserve URL-addressable workspace and unsaved-change behavior when Order Workspace is authorized. Remove assistant launcher and unrelated workspace types. |
| Customer model | `backend/app/models/customer.py` | Reused as a reduced pattern | `backend/migrations/001_v1_part2_core.sql`, `backend/src/services.js` | Kept tenant ID, contact/business data, email, phone, strict billing address, lifecycle, portable ID, audit. Added Slim tax-exempt fields. Did not port merge/archive complexity. |
| Quote/Estimate model | `backend/app/models/quote.py`, `backend/app/services/quote_conversion.py` | Reused as a reduced pattern | `backend/src/services.js`, `src/App.jsx` | UI says Estimate while preserving canonical quote-style conversion semantics. Removed Decision Room, SendGrid, public portal, and Pricing Engine behavior. |
| Order / Order Item model | `backend/app/models/order.py` | Reused as a reduced pattern | `backend/migrations/001_v1_part2_core.sql`, `backend/src/services.js` | Kept tenant ID, customer link, source estimate link, manual cents totals, production-required flag, due date, status, and item positions. Removed pricing snapshots, formulas, production board, calendar, and workspace behavior. |
| Invoice model | `backend/app/models/invoice.py`, `backend/app/routers/invoices.py` | Reused as a reduced pattern | `backend/src/services.js` | Kept one invoice per order, integer cents, document status distinct from payment status, copied order totals, manual amount paid, and balance due. Removed payment processor and accounting behavior. |
| PDF pattern | `backend/app/services/order_completion_service.py` minimal PDF renderer pattern and authenticated download routes | Reused as a reduced pattern | `backend/src/pdf.js`, `backend/src/server.js` | Server-generated Estimate and Invoice PDFs use persisted tenant/customer/document data and exclude internal notes. |
| Calendar service | `backend/app/services/calendar_service.py` | Reusable later after safe simplification | Planned for V1 Part 4 | Keep tenant-scoped scheduling, source links, conflict concepts, audit. Remove employee/equipment/resource scheduling not authorized in Version 1. |
| Work order production | `backend/app/models/work_order.py`, `backend/app/services/work_order_service.py` | Reusable later after safe simplification | Planned for V1 Part 3 | Preserve canonical Work Order fields for order/customer links, item snapshots, production status, assignments, due dates, lifecycle timestamps, and notes. Avoid creating a second production task entity. |
| Attachments/files | `backend/app/models/file.py`, `backend/app/services/upload_validation.py` | Reusable later after storage boundary review | Planned for V1 Part 3 | Keep secure upload validation and tenant/object metadata. Exclude camera capture and annotation. |
| Notifications/reminders | `backend/app/models/notification.py`, `backend/app/services/notifications.py` | Reusable later after Slim reduction | Planned for V1 Part 4 | Keep in-app reminders and due/late derivation. Exclude messages, announcements, outbound email, SMS. |
| Pricing Engine and calculators | `backend/pricing_engine/**`, `frontend/src/pages/PricingCalculatorPage.jsx` | Explicitly excluded | None | Slim uses manually entered unit prices only. |
| AI, webstores, Stripe, portals, payroll/time, inventory, wrap lab, decision room, communications/email | Multiple MVP modules | Explicitly excluded | None | Must not be imported, routed, scaffolded, or advertised in Version 1 Part 1. |

## Part 2 Evidence

- Slim frontend and backend source imports/dependencies are guarded by
  `tools/check-exclusions.mjs`.
- `backend/src/services.test.js` verifies auth, tenant isolation, role
  permissions, tax-exempt snapshots, decimal-safe quantities, idempotent
  Estimate conversion, direct Orders, one Invoice per Order, manual payment
  status, PDFs, and migration history.
- `src/app.test.jsx` verifies Part 2 navigation/ribbon exposure, hidden
  Production/Calendar, calculator arithmetic, dependency pins, and forbidden
  imports.
