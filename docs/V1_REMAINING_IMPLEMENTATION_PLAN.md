# Version 1 Remaining Implementation Plan — Historical Record

> **Status:** Historical planning document. Version 1 has been completed and the repository has advanced through implemented and merged Version 2 Stages 1-6. This file is retained only to preserve the history of the original Version 1 delivery sequence. It is **not** the current scope authority and must not be used to reject or remove currently authorized Version 2 work.
>
> Current Version 2 scope authority: `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`
>
> Current repository instructions: `AGENTS.md`

## Historical Version 1 Delivery

### Part 2 — Customers, Quick Entry, Estimates, Orders, Invoices, Calculator

Implemented the independent tenant-scoped backend foundation, Customers, Quick Entry line items, Estimates, direct Orders, Estimate-to-Order conversion, Invoices, PDF output, manual invoice payment status, and basic arithmetic calculator.

### Part 3 — Order Workspace, Attachments, Production

Implemented the URL-addressable full-screen Order Workspace, secure private Order attachments, item-level Production workflow, optimistic concurrency, invoiced-Order financial locks, differential Order Item updates, and derived production progress.

### Part 4 — Dashboard, Calendar, Reminders

Implemented the Home operational dashboard, Calendar Event persistence, Month/Week/Day/Agenda Calendar, Order/Order Item scheduling, assignments, status transitions, timezone-safe behavior, and derived in-app attention reminders.

### Part 5 — Backup Export and Empty-Tenant Slim Restore

Implemented encrypted `.signguy-backup` export, validation/preview, empty-tenant restore, attachment integrity validation, safe user mapping, restore receipts, sequence restoration, and rollback protections.

### Historical Part 6/7 Planning

The original Version 1 plan described a future MVP Upgrade Importer and a Version 1 integrated-validation/hardening phase. Those planning notes predated the later Version 2 roadmap and should not be interpreted as current instructions that Version 2 code must remain absent.

Where portability/import work exists, its current authority belongs to the appropriate portability/MVP project documents rather than this historical Slim Version 1 file.

## Current Version 2 Status

Implemented and merged:

- Stage 1 — SendGrid and Customer Communication History
- Stage 2 — Email Order Intake
- Stage 3 — Camera Capture
- Stage 4 — Photo Annotation
- Stage 5 — Employee Administration, Time Clock, and Time Clock Portal
- Stage 6 — Weekly Pay Tracking and My Pay

Authorized next as one combined delivery:

- Stage 7 capability — Employee Announcements
- Stage 8 capability — Internal Employee Messages

Deferred until later separate authorization and Meta setup:

- Stage 9 — Facebook Page Order Intake

See `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md` for exact scope, exclusions, tests, and definition of done.

## Historical Architecture Principles Still Preserved

Although this file is no longer the active roadmap, several original principles remain valid unless superseded by a newer architecture decision:

- Slim stays independent from the full `SIGNGUY-MVP` runtime and production data stores.
- Business records remain tenant-scoped.
- Orders contain first-class Order Items.
- Production completion, Order completion, and Calendar completion remain separate concepts.
- Money uses safe integer/decimal handling rather than floating-point business arithmetic.
- Attachments remain private and authenticated.
- Backup/restore remains a portability boundary, not a shared live database.
- New stages must preserve existing behavior and use bounded additive migrations.

For active technical-debt and architecture-hardening work, see `docs/SLIM_TECHNICAL_DEBT_REGISTER.md`.
