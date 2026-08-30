# SignGuy Slim

Independent slim sign-shop operations application with a tenant-scoped backend, focused sign-shop workflows, and an intentionally smaller product boundary than `SIGNGUY-MVP`.

This repository is intentionally separate from `SIGNGUY-MVP`. Slim owns its own application code, database migrations, sessions, attachments, backup/restore behavior, CI, and product evolution. The full MVP repository may be used only as an implementation reference unless a documented portability or reuse boundary explicitly permits otherwise.

The current repository state includes the completed Version 1 foundation plus authorized Version 2 Stages 1-6 work through customer communications, focused Order Intake, device-camera Order photo capture, simple photo annotation, employee administration, time clock, and internal weekly pay tracking.

## Current Product Areas

Slim currently includes:

- secure tenant-aware registration, authentication, roles, sessions, and audit history;
- company settings and tenant-specific numbering;
- Customers;
- Estimates and Estimate-to-Order conversion;
- direct Orders and Order Items;
- full-screen Order Workspace;
- Invoices and manual payment-status tracking;
- server-generated Estimate and Invoice PDFs;
- integer-cent money storage and decimal-safe quantity handling;
- Work Orders and production grouping;
- item/work-order production stages and Production board workflows;
- Dashboard and in-app attention reminders;
- full Calendar and shared scheduling foundations;
- departments, assignees, resources, conflicts, and linked scheduling records;
- commercial bundles;
- secure Order attachments;
- encrypted manual backup and empty-tenant restore;
- SendGrid-backed customer email and delivery tracking;
- Customer communication history;
- focused Email Order Intake with deliberate conversion/linking to Orders;
- device-camera photo capture inside the Order Workspace;
- non-destructive photo annotation saved as attachment derivatives;
- employee administration linked to existing tenant users;
- employee Time Clock and My Pay self-service portal routes;
- manager Time & Attendance review, correction, void, and missing-entry workflows;
- Saturday-Friday internal weekly payroll tracking with Friday payday;
- employee pay advances, positive/negative adjustments, manual payments, carryover, close, and reopen;
- a basic arithmetic calculator;
- GitHub Actions CI for migrations, tests, exclusion guards, and production builds.

## Commands

```powershell
npm ci
npm run backend:migrate
npm run backend:dev
npm run test
npm run guard
npm run build
```

## Core Architecture Rules

The following rules are intentional and should be preserved unless a later architecture decision explicitly replaces them:

- Slim remains independent from the full `SIGNGUY-MVP` runtime and production data stores.
- Business records are tenant-scoped and same-tenant relationships are enforced in services and, where practical, database constraints/triggers.
- Stable portable IDs are retained for backup, restore, and future Slim-to-full-product portability.
- Orders contain first-class Order Items. Production structures must not collapse Order Items into one undifferentiated Order description.
- Calendar records remain separate from Order due dates, Order Item due dates, and production completion state.
- Completing a Calendar Event must not silently complete production, and completing production must not silently complete Calendar Events.
- Historical commercial values must remain snapshots. A later Pricing Engine integration must not retroactively rewrite historical manual prices.
- Attachments remain private, authenticated, tenant-scoped records. The frontend must not receive raw filesystem paths or unauthenticated storage URLs.
- Backup/restore remains a portability boundary rather than a mechanism for sharing Slim and MVP live databases.

See `docs/SLIM_ARCHITECTURE_BOUNDARY.md` for the original Version 1 architecture boundary and the Version 2 reuse-map documents for later authorized additions.

## Money Rules

Slim stores money as integer cents and Quick Entry quantities as decimal strings with up to four fractional digits. Line totals use half-up rounding to the nearest cent after multiplying quantity by unit price. Document-level discounts are allocated proportionally between taxable and non-taxable line totals before sales tax is calculated.

Commercial documents preserve tax and financial snapshots rather than recalculating historical records from current shop settings. Manual invoice payments cannot exceed the invoice total because Slim currently has no general credit-balance model.

## Orders, Order Items, Work Orders, And Production

Orders and Order Items remain the commercial source records. Order Items retain their own descriptions, quantities, prices, taxable state, production-required state, due dates, assignments, notes, stable IDs, and Estimate-source relationships.

The Order Workspace is a full-screen authenticated dialog addressed by `#/orders/:orderId`. It supports deep-link loading, focus trapping, background inertness, dirty-change protection, and optimistic concurrency through the Order `updated_at` value. Stale saves return `409 order_conflict` and allow the user to reload rather than silently overwrite newer work.

Production supports the stages:

- `not_started` - work has not begun.
- `ready` - work is ready to start.
- `in_progress` - active production work.
- `waiting` - blocked or waiting on a non-calendar condition.
- `complete` - production is complete.

Stage 3 added explicit `work_orders` and `work_order_items` so an Order may be sent to production as one Work Order, as individual-item Work Orders, or as custom groups. Work Orders are operational records linked back to their source Order Items.

The relationship between legacy Order Item production fields and newer Work Order production fields is being tracked as an architecture-hardening item. Do not add additional independent production-state representations without first establishing the authoritative ownership/derivation rule documented in `docs/SLIM_TECHNICAL_DEBT_REGISTER.md`.

When an Invoice exists for an Order, customer-changing and financially relevant edits are backend-locked while safe operational fields may remain editable. Order completion and production completion remain separate concepts.

## Dashboard, Calendar, And Scheduling

Home provides operational production, calendar, and attention information without turning the dashboard into a second copy of every module.

Calendar Events are tenant-owned records with stable portable IDs. Timed events are normalized for timezone-safe storage while all-day records use plain dates. Calendar records may link to Orders, Order Items, Work Orders, users, departments, and scheduling resources as supported by the current scheduling stage.

Calendar completion never completes an Order, Order Item, or production stage. Production completion never automatically completes Calendar Events.

The Calendar supports Month, Week, Day, and Agenda-style workflows plus filtering, linked records, assignments, scheduling resources, departments, and conflict handling introduced by the shared scheduling stages.

## Attachments, Camera Capture, And Annotation

Order attachment metadata is stored in SQLite while attachment bytes remain in a Slim-owned filesystem root.

Defaults:

- `SIGNGUY_SLIM_ATTACHMENT_ROOT=./data/attachments`
- `SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES=10485760`

Uploads are streamed and validated rather than trusting browser-provided MIME information. Active file types such as HTML, SVG, JavaScript, executables, and scripts are blocked. Attachment downloads/previews are authenticated, tenant-scoped, checksum-backed, audited, and protected against path traversal and symlink escape.

Version 2 Stages 3-4 reuse this attachment pipeline for Order Workspace device-camera capture and annotation.

Captured photos are stored as ordinary private Order attachments with device-capture metadata. Photo annotation is non-destructive: original bytes are never overwritten. Saving markup creates a new PNG derivative linked to the immutable original, while normalized annotation operations allow the markup to be reopened at different display sizes.

Annotation currently supports selection/deletion, freehand pen, arrows, rectangles, text labels, color/stroke controls, undo, redo, clear, cancel protection, and save-as-annotated-copy.

## Backup And Restore

Slim supports manual encrypted backups downloaded as `.signguy-backup` files and empty-tenant restore.

The backup container uses PBKDF2-HMAC-SHA256 plus AES-256-GCM with unique random cryptographic parameters. Passphrases are user supplied and are not stored, logged, embedded in filenames, or written to audit details.

Restore requires upload, decrypt, validate, and preview before mutation. It does not merge into populated operational tenants, create login credentials from a source shop, or directly share data with the full MVP runtime. Assignment restoration maps against appropriate existing tenant users.

## Version 2 Stages 1-2: Communications And Order Intake

Version 2 Stages 1-2 added SendGrid-backed customer email, delivery-state tracking, customer communication history, and focused Email Order Intake.

The implementation includes:

- tenant sender settings;
- outbound Estimate, Order, Invoice, and general email records;
- SendGrid delivery-event tracking;
- Customer communication timelines;
- private tenant intake addresses;
- inbound source-message records;
- Intake Items and accepted/rejected attachments;
- deliberate conversion to a Draft Order or linking to an existing Order;
- carry-forward of accepted inbound attachments into the normal Order attachment system.

Order Intake does not automatically create confirmed Orders from incoming email.

Provider configuration may use:

- `SIGNGUY_SLIM_SENDGRID_API_KEY`
- `SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET`
- `SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET`
- `SIGNGUY_SLIM_INTAKE_DOMAIN`

See `docs/V2_STAGE1_2_REUSE_MAP.md` for the detailed boundary.

## Version 2 Stages 3-4: Camera And Annotation

Version 2 Stages 3-4 add device-camera capture and simple image annotation inside the existing Order Workspace Artwork & Files workflow.

They intentionally do not create a global camera module, general-purpose design editor, AI image editor, Asset Library, proofing system, video annotation system, or public media-sharing layer.

See `docs/V2_STAGE3_4_REUSE_MAP.md` for the detailed boundary.

## Version 2 Stages 5-6: Employee Time And Weekly Pay

Version 2 Stages 5-6 add employee administration, employee Time Clock, My Pay, manager Time & Attendance review, and internal weekly pay summaries.

Employee records are tenant-scoped and linked to existing same-tenant users. Employee administration is owner/admin controlled. Sensitive pay information, rate history, pay-week summaries, advances, adjustments, and manual payments require owner access or explicit employee pay-management permission. Managers without pay permission may review and correct time entries, but they must not gain payroll or pay-rate access.

Time entries support one open entry per employee, idempotent clock-in/clock-out behavior, administrator correction/void audit details, server-computed durations, rate snapshots at clock-in, and selected-week review rather than silently substituting the current week.

Internal payroll weeks run Saturday through Friday, with Friday as payday. Pay summaries track opening carryover, gross pay, advances, positive and negative adjustments, manual payments, estimated amount due, close snapshots, and reopen history. Closed pay weeks reject ordinary time and ledger mutation until reopened.

This is not a payroll-provider, direct-deposit, tax-filing, benefits, accounting-export, or payroll-tax calculation system.

See `docs/V2_STAGE5_6_REUSE_MAP.md` for the detailed boundary.

## Current Scope Boundary

Authorized in the current `main` history are the completed Version 1 foundations and the specifically implemented later stages represented by the repository migrations, tests, reuse maps, and merged pull requests.

Current code must not be treated as authorization to casually import full-MVP modules or add unrelated future features. New stages should remain bounded, tenant-safe, additive where practical, and explicit about what they do not include.

Features not currently part of the implemented Slim scope include, unless added by a later documented stage:

- full MVP runtime/module reuse;
- direct shared Slim/MVP databases, sessions, storage, or production secrets;
- Pricing Engine calculation integration;
- Stripe/payment processing;
- Webstores;
- inventory/supply-room purchasing;
- payroll-provider integrations, direct deposit, payroll tax calculation, tax filing, benefits, and full HR/payroll administration beyond the implemented internal weekly pay tracker;
- AI features;
- full accounting/reporting suite;
- customer portals/proofing unless separately staged;
- SMS unless separately staged;
- global Asset Library;
- general-purpose design/image editor;
- automatic confirmed Order creation from inbound communications.

## Technical Debt And Future Corrections

Known architecture, maintainability, terminology, navigation, and security-hardening issues are tracked in:

`docs/SLIM_TECHNICAL_DEBT_REGISTER.md`

That register is the living backlog for issues that should be addressed without pretending every concern must block the current stage. New repo reviews should add genuine findings there, update status when corrections are completed, and preserve resolved entries for history.

Current high-priority architecture concerns are:

1. Establish a single authoritative ownership/derivation model for production state now that both Order Items and Work Orders contain production fields.
2. Modularize the growing `backend/src/services.js` and `src/App.jsx` files before continued feature growth turns them into application-wide monoliths.
3. Keep employee time/pay expansion behind a clear source-row versus snapshot boundary before adding external payroll, accounting, tax, or HR workflows.

## CI

GitHub Actions runs the Slim migration check, test suite, source/dependency exclusion guard, and production build on pull requests and pushes to `main`.
