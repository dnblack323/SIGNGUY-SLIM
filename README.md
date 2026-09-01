# SignGuy Slim

Independent slim sign-shop operations application with a tenant-scoped backend, focused shop workflows, and an intentionally smaller product boundary than `SIGNGUY-MVP`.

This repository is intentionally separate from `SIGNGUY-MVP`. Slim owns its own application code, migrations, sessions, attachments, backup/restore behavior, CI, and product evolution. The full MVP repository may be used only as a read-only implementation reference unless a documented portability or reuse boundary explicitly permits otherwise.

## Current Status

The current feature branch includes the completed Version 1 foundation plus implemented Version 2 Stages 1-8:

- Stage 1: SendGrid customer email and Customer communication history;
- Stage 2: focused Email Order Intake, now surfaced as Incoming Requests inside Orders;
- Stage 3: device-camera Order photo capture;
- Stage 4: non-destructive photo annotation;
- Stage 5: Employee administration, Time Clock, Time & Attendance, and Employee Portal Time Clock;
- Stage 6: weekly pay tracking and My Pay;
- Stage 7: Employee Announcements;
- Stage 8: basic one-to-one Internal Employee Messages.

Stages 7 and 8 are intentionally delivered together because they share the existing Employee Portal, authenticated employee/user identity, read/unread state, tenant/permission rules, audit patterns, and backup/restore requirements.

**Version 2 Stage 9, Facebook Page Order Intake, is deferred.** It should not be implemented or scaffolded until separately authorized after the required Meta business app/Page configuration, permissions, webhook setup, and any applicable app review are available.

The authoritative Version 2 roadmap is:

`docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`

The older `docs/V1_REMAINING_IMPLEMENTATION_PLAN.md` is historical Version 1 planning material and is not the current scope authority.

## Current Product Areas

Slim currently includes:

- secure tenant-aware registration, authentication, roles, sessions, and audit history;
- company settings and tenant-specific numbering;
- Customers;
- Quotes and Quote-to-Order conversion;
- direct Orders and first-class Order Items;
- full-screen Order Workspace;
- Work Orders, production grouping, and Production board workflows;
- Invoices and manual payment-status tracking;
- server-generated Quote and Invoice PDFs;
- integer-cent money storage and decimal-safe quantity handling;
- Dashboard and in-app attention reminders;
- full Calendar and shared scheduling foundations;
- departments, assignees, resources, conflicts, and linked scheduling records;
- commercial bundles;
- secure Order attachments;
- encrypted manual backup and empty-tenant restore;
- SendGrid-backed customer email and delivery tracking;
- Customer communication history;
- Incoming Requests for deliberately forwarded order email, with conversion/linking to Orders;
- device-camera photo capture inside the Order Workspace;
- non-destructive photo annotation saved as attachment derivatives;
- Employee administration linked to existing tenant users;
- Employee Time Clock and My Pay portal routes;
- manager Time & Attendance review, correction, void, and missing-entry workflows;
- Saturday-Friday internal weekly pay tracking with Friday payday;
- advances, adjustments, manual payments, carryover, close, and reopen;
- owner/admin Employee Announcement management;
- Employee Portal announcement read/unread tracking;
- basic one-to-one tenant-isolated Internal Employee Messages;
- a basic arithmetic calculator;
- GitHub Actions CI for migrations, tests, exclusion guards, and production builds.

Messages and Announcements are implemented on this branch and remain separate from Customer communication history and Incoming Requests.

## Commands

```powershell
npm ci
npm run backend:migrate
npm run backend:dev
npm run test
npm run lint
npm run guard
npm run build
```

For final change validation also run:

```powershell
git diff --check
```

`package.json` is the application-version source of truth. Backup provenance reads the npm package version when the backend is launched through npm scripts, with the same current version retained as the direct-node fallback.

## Core Architecture Rules

The following rules are intentional and should be preserved unless a later architecture decision explicitly replaces them:

- Slim remains independent from the full `SIGNGUY-MVP` runtime and production data stores.
- Business records are tenant-scoped and same-tenant relationships are enforced in services and, where practical, database constraints/triggers.
- Stable portable IDs are retained for backup, restore, and future Slim-to-full-product portability.
- Orders contain first-class Order Items. Production structures must not collapse Order Items into one undifferentiated Order description.
- Work Orders own operational production stage and completion after Order Items are released to production. Order Item production fields are constrained compatibility snapshots derived from active Work Orders.
- Calendar records remain separate from Order due dates, Order Item due dates, and production completion state.
- Completing a Calendar Event must not silently complete production, and completing production must not silently complete Calendar Events.
- Historical commercial and pay values must preserve authoritative snapshots where the current contracts require them.
- Attachments remain private, authenticated, tenant-scoped records. The frontend must not receive raw filesystem paths or unauthenticated storage URLs.
- Backup/restore remains a portability boundary rather than a mechanism for sharing Slim and MVP live databases.
- Customer communication history and internal employee messaging must remain separate domains even if they reuse common infrastructure patterns.

See:

- `docs/SLIM_ARCHITECTURE_BOUNDARY.md`
- `docs/SLIM_TECHNICAL_DEBT_REGISTER.md`
- `docs/V2_STAGE1_2_REUSE_MAP.md`
- `docs/V2_STAGE3_4_REUSE_MAP.md`
- `docs/V2_STAGE5_6_REUSE_MAP.md`
- `docs/V2_STAGE7_8_REUSE_MAP.md`
- `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`

## Money And Pay Rules

Slim stores money as integer cents and quantities as decimal strings where required. Commercial documents preserve tax and financial snapshots instead of recalculating historical records from current shop settings.

Employee pay tracking is an internal weekly ledger/estimate, not a payroll-processing or accounting system. Current pay weeks run Saturday through Friday with Friday payday. The implemented Stage 6 model tracks rate snapshots, opening carryover, gross pay, advances, positive/negative adjustments, manual payments, estimated amount due, close snapshots, and reopen history.

Employee self-service punch timestamps are server-authoritative. Historical time correction is an authorized manager/admin workflow with audit requirements. Pay-week calculations allocate overlapping time to the appropriate pay-week interval, closed-week protections prevent ordinary mutation, and out-of-order close/reopen behavior is guarded to preserve downstream carryover integrity.

Slim does not currently provide payroll tax calculation, withholding, overtime rules, direct deposit, tax filing, benefits, or payroll-provider integration.

## Orders, Order Items, Work Orders, And Production

Orders and Order Items remain the commercial source records. Work Orders are operational production records linked back to their source Order Items.

Order Items own the commercial/product object being made: title/description, quantity, pricing snapshot, customer-facing identity, production-required flag, due date, and assignment. Before release to production, a production-required Order Item with no active Work Order derives `not_started`; a non-production item is excluded from production progress.

After release to production, the active Work Order owns operational production stage and completion. Order Item production fields remain as constrained compatibility snapshots and must not be directly edited as independent truth. Production board, Order Workspace, and Home dashboard summaries derive production progress from production-required Order Items and their active Work Orders.

Cancelled and superseded Work Orders remain historical records and do not drive current production progress. One active Work Order item assignment may control an Order Item at a time. Reopening a completed active Work Order immediately changes the derived Order Item and Order production state while preserving audit history.

Order completion, production completion, and Calendar completion remain separate concepts.

## Communications And Incoming Requests

Version 2 Stages 1-2 added SendGrid-backed customer email, delivery-state tracking, Customer communication history, and focused Email Order Intake. The current navigation presents the Stage 2 queue as **Incoming Requests** inside Orders.

Incoming Requests uses a private tenant-specific intake route for deliberately forwarded order-related emails. It does not synchronize Gmail, Outlook, Microsoft 365, or a complete mailbox, and it does not automatically create confirmed Orders.

Stage 9 may later extend this same Intake model to an authorized Facebook business Page. That stage is currently deferred and must not be scaffolded during Stages 7-8.

## Camera And Annotation

Version 2 Stages 3-4 reuse the private Order attachment pipeline for device-camera capture and non-destructive image annotation.

Original image bytes are never overwritten. Confirmed annotations are stored as separate derivative attachments linked to the original and audited through the existing attachment model.

## Employee Time And Weekly Pay

Version 2 Stages 5-6 added Employee administration, Time Clock, My Pay, manager Time & Attendance review, and internal weekly pay summaries.

Employee records are tenant-scoped and linked to existing same-tenant users. Employee administration is owner/admin controlled. Sensitive pay information requires owner access or explicit pay-management permission. Managers without pay permission may review/correct time but do not receive payroll/pay-rate access.

Employees may access only their own Time Clock and My Pay data through the restricted Employee Portal.

## Employee Announcements And Internal Messages

### Employee Announcements

Version 2 Stage 7 adds:

- owner/admin announcement creation and management;
- title and safe body content;
- publish/start date and optional expiration;
- simple all-active-Employee or supported role-group targeting;
- archive/edit audit history;
- Employee Portal current-announcement view;
- per-Employee read/unread state.

### Internal Employee Messages

Version 2 Stage 8 adds:

- basic one-to-one tenant-isolated internal direct messages;
- simple conversation threads;
- sender, recipient, sent time, and message body;
- unread count/read state;
- active-user and tenant validation;
- immutable ordinary sent messages.

Combined Stages 7-8 explicitly exclude group chat, channels, message attachments, reactions, typing indicators, presence, voice, video, social-feed behavior, and customer-communication merging.

Messages and Announcements must reuse the existing Employee Portal and employee/user identity. Do not create a second staff portal or parallel identity model.

Backup/restore includes the Stage 7-8 records and relationships. Provider credentials and secrets remain excluded.

## Deferred Stage 9: Facebook Page Order Intake

Stage 9 remains part of the longer-term Version 2 scope but is intentionally postponed.

When separately authorized later, it may connect an authorized Facebook business Page through supported Meta APIs/webhooks and allow a user to deliberately send an eligible Page conversation into the existing Stage 2 Incoming Requests queue.

It must not access personal-profile Messenger inboxes, automatically create Orders, or expand into Instagram, WhatsApp, SMS, or a general social-media CRM.

## Scope Exclusions

Unless separately authorized in a later documented stage, Slim does not include:

- direct shared Slim/MVP databases, sessions, storage, or production secrets;
- Pricing Engine integration;
- Stripe or customer payment processing;
- Webstores;
- inventory/supply purchasing;
- full accounting/reporting;
- payroll-provider integration, payroll taxes, withholding, direct deposit, tax filing, or benefits;
- AI features;
- Customer Portal/Decision Room;
- SMS/MMS;
- global Asset/Document Library or DocuLink;
- general-purpose design/image editor;
- production time tracking/station checkout/machine time;
- full-mailbox Gmail/Outlook synchronization;
- Stage 9 Meta/Facebook code until separately authorized;
- automatic confirmed Order creation from inbound communications;
- group chat/channels/attachments/reactions/voice/video internal messaging.

Do not expose deferred or excluded modules as disabled `coming soon` UI.

## Technical Debt And Future Corrections

Known architecture, maintainability, terminology, navigation, and security-hardening issues are tracked in:

`docs/SLIM_TECHNICAL_DEBT_REGISTER.md`

Current high-priority concerns include:

1. continue modularizing the growing `backend/src/services.js` and `src/App.jsx` files after Group C extracted the production slice;
2. preserve the employee time/pay source-row versus closed-week snapshot boundary before any future external payroll/accounting expansion;
3. keep employee communications separate from customer communications and Order Intake during future decomposition.

Group C resolved the production source-of-truth hardening concern in a bounded production pass. Group D and Group E remain responsible for employee/time/pay/messages modularization and the remaining general monolith decomposition.

## CI

GitHub Actions runs the Slim migration check, test suite, lint/static analysis, source/dependency exclusion guard, and production build on pull requests and pushes to `main`.

The user-owned untracked `artifacts/` folder is not application source and must remain untouched unless the user explicitly authorizes otherwise.
