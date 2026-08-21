# MVP Reuse Map - Version 1 Part 5

MVP reference inspected from `C:\Users\thesi\Documents\GitHub\SIGNGUY-MVP-REFERENCE`
after fetching `origin/main` on August 20, 2026. The reference push URL was
`DISABLED`.

| Area | MVP source | Reuse decision | Slim destination | Adaptation / removed behavior |
| --- | --- | --- | --- | --- |
| App shell layout | `frontend/src/components/app-shell/AppShell.jsx` | Reusable after simplification | `src/App.jsx`, `src/navigation.js` | Preserve shell/ribbon shape. Remove full-product module registry, auth menus, notifications, assistant, portal, pricing, webstores, wrap lab, team/pay/time, email, and decision-room commands. |
| Navigation contract | `frontend/src/lib/navigation.js` | Reusable as a pattern only | `src/navigation.js` | Keep one locked Version 1 nav list. Do not port area/module hierarchy that exposes excluded products. |
| Workspace dock | `frontend/src/components/workspaces/WorkspaceDock.jsx`, `frontend/src/context/WorkspaceContext.jsx` | Adapted as a simplified pattern | `src/App.jsx` | Preserved URL-addressable Order Workspace, focus entry, dirty-close prompts, and deep-link restore. Removed multi-workspace dock persistence, assistant launcher, unrelated workspace types, router provider, and full-product limits. |
| Customer model | `backend/app/models/customer.py` | Reused as a reduced pattern | `backend/migrations/001_v1_part2_core.sql`, `backend/src/services.js` | Kept tenant ID, contact/business data, email, phone, strict billing address, lifecycle, portable ID, audit. Added Slim tax-exempt fields. Did not port merge/archive complexity. |
| Quote/Estimate model | `backend/app/models/quote.py`, `backend/app/services/quote_conversion.py` | Reused as a reduced pattern | `backend/src/services.js`, `src/App.jsx` | UI says Estimate while preserving canonical quote-style conversion semantics. Removed Decision Room, SendGrid, public portal, and Pricing Engine behavior. |
| Order / Order Item model | `backend/app/models/order.py` | Reused as a reduced pattern | `backend/migrations/001_v1_part2_core.sql`, `backend/src/services.js` | Kept tenant ID, customer link, source estimate link, manual cents totals, production-required flag, due date, status, and item positions. Removed pricing snapshots, formulas, production board, calendar, and workspace behavior. |
| Invoice model | `backend/app/models/invoice.py`, `backend/app/routers/invoices.py` | Reused as a reduced pattern | `backend/src/services.js` | Kept one invoice per order, integer cents, document status distinct from payment status, copied order totals, manual amount paid, and balance due. Removed payment processor and accounting behavior. |
| PDF pattern | `backend/app/services/order_completion_service.py` minimal PDF renderer pattern and authenticated download routes | Reused as a reduced pattern | `backend/src/pdf.js`, `backend/src/server.js` | Server-generated Estimate and Invoice PDFs use persisted tenant/customer/document data and exclude internal notes. |
| Calendar service | `backend/app/services/calendar_service.py`, `backend/app/models/calendar.py` | Adapted as a reduced pattern | `backend/migrations/003_v1_part4_dashboard_calendar_reminders.sql`, `backend/src/services.js`, `backend/src/server.js`, `src/App.jsx` | Kept tenant-scoped schedule records, source/order links, assignment validation, status transitions, completion/reopen/cancel audit, and completion independence from Orders/Production. Removed conflicts, employee/equipment/resource capacity, shifts/time-off overlays, recurrence, notifications, appointment booking, route optimization, and archive/restore resource workflows. |
| Work order production | `backend/app/models/work_order.py`, `backend/app/models/production_workflow.py`, `frontend/src/pages/ProductionBoardPage.jsx` | Adapted as item-level Slim workflow | `backend/src/services.js`, `backend/src/server.js`, `src/App.jsx` | Preserved tenant-scoped item production state, assignment, effective due dates, stage moves, completion/reopen audit, board filters, and parent Order timestamp invalidation. Did not port Work Order documents, workflow definitions, timers, kiosk, pricing feedback, bulk actions, equipment, labor, or calendar links. |
| Attachments/files | `backend/app/models/file.py`, `backend/app/services/upload_validation.py` | Adapted as local Slim storage | `backend/migrations/002_v1_part3_order_workspace_production.sql`, `backend/src/services.js`, `backend/src/server.js`, `src/App.jsx` | Kept tenant metadata, random storage key, original filename display, MIME/content validation, checksum and size integrity checks, streaming multipart upload, authenticated preview/download, transactional audit/metadata rollback, and soft delete. Excluded camera capture, annotation, external storage providers, portals, and customer-visible sharing. |
| Notifications/reminders | `backend/app/models/notification.py`, `backend/app/services/notifications.py` | Adapted as derived in-app attention only | `backend/src/services.js`, `src/App.jsx` | Kept due/late derivation ideas for Orders, production items, Estimates, Calendar Events, and invoice payment attention. Removed persisted notification center, messages, announcements, browser push, outbound email, SMS, SendGrid, and customer/employee portal notification behavior. |
| Slim portable contract | `SIGNGUY-DATA-PORTABILITY/docs/V1_PORTABILITY_CONTRACT.md`, `fixtures/golden/v1-sample-package.json` | Reusable after safe adaptation | `backend/src/backup.js` | Kept contract concepts: Version 1 coverage, safe user references, manifest counts, checksums, attachment hashes, empty-target rule, and secret exclusion. Did not copy unencrypted fixture files or modify the portability repo. |
| Runtime crypto primitives | Node.js `crypto` | Reusable as-is | `backend/src/backup.js` | PBKDF2-HMAC-SHA256 and AES-256-GCM are used through maintained runtime APIs. No custom cryptography or new dependency was added. |
| Slim auth, tenant, audit, sequence, and attachment services | Existing Slim services from Parts 2-4 | Reusable as-is / adapted locally | `backend/src/services.js`, `backend/src/backup.js`, `backend/src/server.js` | Reused owner/admin role checks, tenant-scoped SQL, append-only audit, filesystem attachment path/checksum validation, and tenant sequence rows. Added restore receipts and backup-specific audit actions. |
| Full MVP backup/import patterns | MVP reference | Explicitly excluded | None | No full-MVP importer, MVP tenant creation, full-product record mapping, external storage, scheduled backup, merge/overwrite restore, or conflict-resolution workflow was ported. |
| Pricing Engine and calculators | `backend/pricing_engine/**`, `frontend/src/pages/PricingCalculatorPage.jsx` | Explicitly excluded | None | Slim uses manually entered unit prices only. |
| AI, webstores, Stripe, portals, payroll/time, inventory, wrap lab, decision room, communications/email | Multiple MVP modules | Explicitly excluded | None | Must not be imported, routed, scaffolded, or advertised in Version 1 Part 1. |

## Part 5 Evidence

- Slim frontend and backend source imports/dependencies are guarded by
  `tools/check-exclusions.mjs`.
- `backend/src/services.test.js` verifies auth, tenant isolation, role
  permissions, tax-exempt snapshots, decimal-safe quantities, idempotent
  Estimate conversion, direct Orders, one Invoice per Order, manual payment
  status, PDFs, Order Workspace concurrency, transactional item edits, invoiced
  financial lock, production stage/completion audit, attachment metadata,
  real timestamp conflict checks, portable/source item identity preservation,
  production audit rollback, Workspace production audit events, checksums, type
  and signature blocking, upload limits, multipart corruption, cross-tenant
  attachment access, integrity mismatches, symlink escapes, upload rollback
  cleanup, missing files, soft delete, and migration history.
- `src/app.test.jsx` verifies Part 3 navigation/ribbon exposure, hidden
  Calendar/future surfaces, Order Workspace open/deep-link/dirty/conflict
  behavior, customer summary links, invoiced locks, Production board movement,
  attachment dirty-form preservation, focus containment/background inertness,
  return-to-Production navigation, attachment Blob preview/download/unmount
  cleanup, Calendar navigation visibility, Month/Week/Day/Agenda controls,
  Calendar filters/status actions, accessible event create/reschedule form,
  Dashboard mini Production board, 14-day Calendar, Attention panel, Order
  Workspace scheduling without dirty-form loss, calculator arithmetic,
  dependency pins, and forbidden imports.
- `backend/src/services.test.js` verifies the Part 4 migration, Calendar create,
  list, edit/reschedule, complete/reopen/cancel behavior, invalid ranges and
  statuses, cross-tenant linked-record and assigned-user rejection, audit
  atomicity, Calendar completion independence from Orders/Production, dashboard
  derivation, reminder duplicate prevention, overdue/due-today/payment-attention
  distinctions, and migration history.
- `backend/src/services.test.js` verifies Part 5 owner/admin permission checks,
  encrypted backup output that excludes customer data, attachment bytes, and
  password hashes from plaintext, unique salt/nonce behavior, wrong-passphrase
  and tampering rejection, unsupported crypto/KDF header rejection, manifest
  checksum mismatch rejection, invalid relationship rejection, unsupported
  attachment metadata rejection, schema-incompatibility blocking, validation and
  restore failure audits, restore temp cleanup after wrong passphrase, no data
  mutation during preview, empty-target blocking, restore into an empty tenant,
  relationship preservation, attachment restoration, sequence advancement,
  duplicate restore blocking, and the Part 5 migration table.
