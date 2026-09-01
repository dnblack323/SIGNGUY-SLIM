# Group E Decomposition Audit

Date: 2026-09-01

Status: created before Group E implementation; updated after final review to
record the completed frontend split.

Scope: Hardening Group E only. This audit maps the remaining general backend
and frontend monolith responsibilities after Groups C and D extracted the
production and employee/time/pay/messages/announcements slices.

Out of scope: Group F authentication/session transport changes, Stage 9
Facebook/Meta work, new product features, broad route rewrites, and unrelated
UI redesign.

## Baseline

- `main` baseline: `693d0a28fb30f01c192c0ce9ed50ba5e94c320d8`.
- `backend/src/services.js`: 4,706 lines before Group E.
- `src/App.jsx`: 4,618 lines before Group E.
- Existing backend extracted domains:
  - `backend/src/domains/production/`;
  - `backend/src/domains/employees/`.
- Existing frontend extracted features:
  - `src/features/production/`;
  - `src/features/employees/`.

## Backend Inventory

### Already Extracted

| Responsibility | Current owner |
|---|---|
| Production stage lists, Work Order normalization, derived Order Item state, Order production summary | `backend/src/domains/production/state.js` |
| Active Work Order selection and production completion predicates | `backend/src/domains/production/queries.js` |
| Employee capabilities, Employee administration, Time Clock, Time & Attendance, weekly pay, announcements, direct messages, Employee Portal methods | `backend/src/domains/employees/` |

### Intentionally Remain In SlimService Core

| Lines before Group E | Responsibility | Reason |
|---:|---|---|
| 1207-1327 | `SlimService` construction, transactions, numbering, audit, backup facade | Cross-cutting application service shell and public API facade |
| 1328-1430 | registration, login, session issuing/lookup/logout | Group F owns auth/session transport hardening |
| 1435-1491 | tenant and company settings | Small core/settings surface used by shell/bootstrap |
| 2136-2204 | user administration and owner-count guard | Core account/team administration, tied to auth/session rules |
| 2205 | tenant timezone helper | Shared scheduling/time formatting helper |
| 4647-4653 | audit trail query | Cross-domain audit read facade |
| 4654-4705 | PDF facade | Shared document rendering facade that composes Quote/Invoice/Customer/Order services |

### Extract In Group E

| Lines before Group E | Responsibility | Notes |
|---:|---|---|
| 1492-1770 | customer email settings, SendGrid delivery path, customer communication history, related-record validation | Move to customer communications domain; keep separate from Employee Messages |
| 1771-2121 | webhook signature handling, SendGrid event ingestion, Incoming Requests intake, matching, assignment, Draft Order conversion, intake attachment copying | Move to intake/communications domain while preserving Incoming Requests UI/API wording |
| 2209-2326 | customer create/list/get/update and customer summaries | Move to customer domain; preserve same-tenant checks and error codes |
| 2327-2539 | same-tenant user validation, item preparation, Order Item persistence, production snapshot guards, invoiced financial locks | Move to orders domain and continue delegating production truth to Group C helpers |
| 2540-2718 | customer snapshots, Quote create/update/list/get/duplicate/convert, Quote item persistence | Move to quotes domain; retain internal `estimate*` identifiers |
| 2719-2805 | Order create/list/detail/workspace loading | Move to orders domain |
| 2806-3652 | scheduling defaults, departments, resources, schedule views, Calendar validation, event CRUD, conflict checks, derived Calendar entries | Move to calendar domain; preserve Calendar independence from production completion |
| 3666-3739 | dashboard and attention summaries | Move to dashboard domain; continue using backend-derived production board/summary |
| 3740-4250 | Order Workspace persistence, Work Orders, production release/regrouping integration, commercial bundles | Move to orders domain without reimplementing production state |
| 4251-4356 | production board facade and legacy item production mutation guards | Already uses production helpers; keep as production/order integration but move out of central service |
| 4357-4551 | attachment upload/download/delete, camera/annotation derivative creation, MIME/path validation | Move to attachments domain; preserve private tenant-scoped bytes and derivative relationships |
| 4552-4646 | Order status update, invoice creation/list/get/status/payment | Move Order status to orders domain and invoice/payment behavior to invoices domain |

## Frontend Inventory

### Already Extracted

| Responsibility | Current owner |
|---|---|
| Production board page and production display helpers | `src/features/production/` |
| Employee administration, Time & Attendance, Payroll, Employee Portal, Announcements, Messages | `src/features/employees/` |

### Intentionally Remain In App Shell

| Lines before Group E | Responsibility | Reason |
|---:|---|---|
| 325-465 | stored session bootstrap, shell navigation, route parsing, sidebar/header/module tabs | Application shell and high-level routing |
| 485-558 | authentication screen | Group F owns auth/session transport changes; keep behavior stable |
| 559-773 | `App` composition, route selection, overlay ownership, drawer behavior, calculator composition | Correct shell responsibility |

### Extract In Group E

| Lines before Group E | Responsibility | Notes |
|---:|---|---|
| 57-321 | page/domain constants and formatting helpers | Move with the feature pages that consume them |
| 467-483, 1008-1020, 4529-4558 | shared lightweight UI primitives and loader hook | Move to reusable UI/feature module and keep `App` as consumer |
| 774-959 | not-found page, contextual ribbon, Orders filter bar, progress/item formatting | Move from shell file while preserving route behavior |
| 960-1247 | Home, Customers, Related Records, Address fields, Quotes | Move to general feature module |
| 1248-1512 | Orders list and Incoming Requests | Move to general feature module |
| 1513-1654 | document totals helpers, customer summary, customer email composer, communication panel | Move with customer communications/document features |
| 1655-2421 | Order Workspace shell/cards, camera capture, annotation, item table, production setup, bundles, inline customer creation | Move to general Orders/attachments feature module |
| 2436-3045 | New Order, Order Workspace state/effects, Schedule-from-workspace modal | Move out of `App.jsx` while preserving overlay and ribbon behavior |
| 3046-3969 | Calendar page, rail, views, entry rendering, schedule management | Move to calendar feature module |
| 3970-4127 | Invoices and Payments pages | Move to invoices feature module |
| 4128-4426 | Settings and Backup & Restore panel | Move to settings feature module |
| 4427-4504 | shared document form and quick-entry helpers | Move with Quote/Order pages |

### Final Group E Frontend Layout

The final Group E review split the initial general page extraction into
feature-owned files so `src/features/general/GeneralPages.jsx` remains a shared
UI/helper module instead of becoming a replacement monolith.

| Final owner | Responsibility |
|---|---|
| `src/features/dashboard/HomePage.jsx` | Home dashboard page |
| `src/features/customers/CustomersPage.jsx` | Customers list/form and customer related records |
| `src/features/quotes/QuotesPage.jsx` | Quote list/form workflow |
| `src/features/orders/OrdersPage.jsx` | Orders list page |
| `src/features/orders/OrderWorkspace.jsx` | New Order, Order Workspace, camera/annotation workspace, customer communication panel, bundle editor, schedule-from-workspace modal |
| `src/features/incoming/IncomingRequestsPage.jsx` | Incoming Requests intake queue and conversion workflow |
| `src/features/calendar/CalendarPage.jsx` | Calendar rails, schedule views, and schedule management |
| `src/features/invoices/InvoicePages.jsx` | Invoices and Payments pages |
| `src/features/settings/SettingsPage.jsx` | Settings and Backup & Restore pages |
| `src/features/general/GeneralPages.jsx` | Shared constants, formatting helpers, contextual ribbon, order filter bar, lightweight form/list primitives, document form, quick-entry helper, calculator modal |

Final line-count checkpoint after the split: `src/App.jsx` is 463 lines,
`src/features/general/GeneralPages.jsx` is 712 lines, and the largest remaining
feature page module is the Order Workspace at 1,531 lines because it owns the
bounded order/camera/annotation workspace surface.

## Group E Extraction Contract

- `SlimService` remains the public service API consumed by `server.js` and tests.
- Extracted backend methods must be installed idempotently and must reject
  duplicate method names or prototype collisions.
- Public routes and API paths remain unchanged.
- Internal `estimate*` identifiers remain unchanged while user-facing labels
  remain Quote.
- Incoming Requests remains the canonical UI name for the intake queue.
- Customer communications remain separate from Internal Employee Messages.
- Calendar status remains scheduling-only and must not mutate production state.
- Work Order production authority remains owned by Group C helpers.
- Employee identity/capability behavior remains owned by Group D helpers.
- Money remains integer cents and backend-derived totals remain authoritative.
- Attachments stay private, tenant-scoped, and non-destructive for annotation.
- Backup format should not change for decomposition alone.

## Deferred To Group F

- Browser session token storage.
- Cookie/CSRF/session transport redesign.
- Any authentication-route or session-persistence behavior change beyond what
  is necessary to preserve existing compatibility.

## Stage 9 Boundary

Group E must not add Meta/Facebook dependencies, migrations, routes, webhook
handlers, OAuth setup, navigation, placeholders, or coming-soon UI.
