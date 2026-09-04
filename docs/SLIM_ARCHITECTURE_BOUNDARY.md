# SignGuy Slim Architecture Boundary

> **Current status:** This document began as the Version 1 architecture boundary and has been updated to reflect implemented Version 2 Stages 1-8, Hardening Groups A-F, and Release A data-durability remediation. For exact stage scope, use `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`. Historical Version 1 exclusions must not be interpreted as prohibiting currently merged or explicitly authorized Version 2 work.

## Repository Boundary

`SIGNGUY-SLIM` is the independent Slim application repository. It must not become a feature flag, alternate bundle, worktree, or subdirectory of the full `SIGNGUY-MVP` application.

The full MVP checkout is a read-only implementation reference unless a specific documented reuse or portability contract permits otherwise.

`SIGNGUY-DATA-PORTABILITY` owns shared portability/import contracts where applicable. Slim must not directly share live production databases, sessions, secrets, storage, or runtime identity with the full MVP product.

## Current Implemented Boundary

`main` includes the completed Version 1 operational foundation plus Version 2 Stages 1-8:

- tenant-aware registration, authentication, roles, HttpOnly cookie sessions, CSRF-protected browser mutations, audit, and company settings;
- Customers;
- Quotes and Quote-to-Order conversion, with internal `estimate*` identifiers retained for compatibility;
- Orders and first-class Order Items;
- Work Orders and production grouping;
- Production board workflows;
- Invoices and manual payment-status tracking;
- Dashboard and attention reminders;
- Calendar/shared scheduling, departments, resources, assignments, and linked records;
- secure private Order attachments;
- encrypted backup and empty-tenant restore;
- SendGrid customer email and communication history;
- focused Email Order Intake surfaced as Incoming Requests inside Orders;
- Order Workspace device-camera capture;
- non-destructive photo annotation;
- Employee administration;
- Time Clock and Time & Attendance;
- Employee Portal Time Clock and My Pay;
- Saturday-Friday internal weekly pay tracking with advances, adjustments, manual payments, carryover, close, and reopen;
- Employee Announcement management and Employee Portal read/unread state;
- basic one-to-one Internal Employee Messages.

## Employee Messages And Announcements Boundary

Stages 7-8 reuse the existing Employee Portal, tenant/user/employee identity, permission model, audit patterns, and encrypted backup/restore architecture.

Do not create:

- a second employee portal;
- a parallel employee identity model;
- another customer communication system;
- a duplicate notification store;
- a general chat platform.

Customer communication history and internal employee messaging remain separate domains even if common infrastructure patterns are reused.

## Employee Domain Implementation Boundary

Hardening Group D keeps the existing Employee, Time, Pay, Announcement, Message, and Employee Portal behavior but moves that code behind a clearer domain boundary.

Backend Employee-domain methods live under `backend/src/domains/employees/` and are installed onto `SlimService` for public service API compatibility. `SlimService` remains the application service facade, but Employee, Time, Pay, Announcement, and Message methods should be maintained in the Employee domain module rather than re-added to the monolith.

Frontend Employee-domain pages live under `src/features/employees/`. `App.jsx` remains responsible for routing, shell composition, and shared UI primitives; it should not regain employee page bodies unless a later architecture decision changes the route composition model.

## Deferred Boundary

**Version 2 Stage 9, Facebook Page Order Intake, is deferred.**

Do not create Stage 9 Meta/Facebook routes, models, migrations, dependencies, settings, navigation, placeholders, tests, or scaffolding until separately authorized after the required Meta business app/Page setup is available.

## Tenant And Identity Boundary

- Every business, employee, communication, message, announcement, read-state, time, pay, attachment, and scheduling record must remain tenant-scoped.
- Related IDs must be verified as same-tenant before linking.
- Employees reuse existing authenticated user identity; do not create duplicate login identities.
- Employee deactivation must prevent new portal/time actions without deleting historical data.
- Backend permissions are authoritative; frontend visibility is not security.
- Browser sessions use server-managed opaque tokens stored as hashes in the `sessions` table and carried only by the `signguy_slim_session` HttpOnly cookie. Frontend JavaScript must not persist authentication bearer tokens in `localStorage`, `sessionStorage`, IndexedDB, or readable cookies.
- `/api/auth/me` is the browser bootstrap and capability-refresh boundary. It returns user, tenant, capabilities, and a non-secret `csrf_token`; it must not expose the session token.
- Authenticated browser `POST`, `PUT`, `PATCH`, and `DELETE` requests require `X-CSRF-Token`. `GET`, `HEAD`, and `OPTIONS` remain CSRF-free but still require authentication where the route is protected.
- Slim remains same-origin by default. Do not introduce wildcard credentialed CORS; split-origin deployments must explicitly configure trusted origins before enabling credentialed cross-origin traffic.
- Production and HTTPS deployments set the auth cookie `Secure` and use the host-prefixed `__Host-signguy_slim_session` cookie name; reverse-proxy HTTPS headers are trusted only when `SIGNGUY_SLIM_TRUST_PROXY=1` is configured for the known proxy path.
- Login, registration, unauthenticated logout cookie clearing, and current GET routes that mark Employee Portal read state validate Origin/Fetch Metadata. API responses use private/no-store cache headers with `Vary: Cookie`.

## Commercial Record Boundary

- Estimate/Quote → Order conversion remains idempotent and audited.
- An Order contains first-class Order Items.
- One Invoice per Order remains enforced unless a later explicit architecture decision changes that contract.
- Historical commercial values remain snapshots and must not be retroactively rewritten by later shop settings or future pricing integrations.
- Money uses integer/decimal-safe arithmetic rather than floating-point business calculations.

## Production Boundary

Orders and Order Items are commercial source records. Work Orders are operational production records linked back to source Order Items.

Order Items own the customer-facing/commercial object being made: item identity, quantity, description/title, pricing snapshot, commercial attributes, due date, assignment, and whether production is required.

Work Orders own operational production execution after release. Once a production-required Order Item is assigned to an active Work Order, the active Work Order is authoritative for operational production stage and completion. Order Item production fields remain only as constrained compatibility snapshots derived from the active Work Order.

Before release, a production-required Order Item with no active Work Order derives `not_started`. A non-production Order Item is excluded from production progress. Orders derive production progress from production-required Order Items and their active Work Orders; the Order record itself is not an independently editable production-state authority.

Only one active Work Order item assignment may control an Order Item at a time. Cancelled or superseded historical Work Orders remain preserved for audit/history but do not drive current Order Item or Order production progress. Reopening a completed active Work Order immediately changes the derived Order Item and Order production state while preserving the Work Order audit trail.

Order completion, Order Item/Work Order production completion, and Calendar Event completion remain separate concepts.

## Calendar And Scheduling Boundary

Calendar Events remain separate records from Order due dates, Order Item due dates, Work Order production state, and Order completion.

Completing or cancelling a Calendar Event must not silently mutate Order/production completion, and completing production must not automatically complete Calendar Events.

Shared scheduling may reuse departments, assignees, resources, and conflict rules already implemented. Do not create duplicate scheduling systems.

## Attachments, Camera, And Annotation Boundary

Attachment bytes remain outside SQLite under Slim-owned storage while metadata remains tenant-scoped and authenticated.

Uploads and downloads must preserve:

- MIME/content validation;
- size limits;
- checksum/integrity checks;
- path traversal/symlink protections;
- private authenticated access;
- audit behavior.

Camera capture reuses the normal Order attachment pipeline.

Photo annotation is non-destructive. Original images remain immutable and annotated outputs are separate linked derivative attachments.

## Communications And Intake Boundary

Customer communication history covers app-sent customer email, SendGrid delivery-state history, and authorized manual communication notes.

Email Order Intake receives only deliberately forwarded order-related messages through a private tenant route. It does not synchronize the shop's complete Gmail/Outlook mailbox and must not automatically create confirmed Orders.

Internal Employee Messages must not be stored as Customer communication activities or merged into customer timelines.

## Employee Time And Pay Boundary

Employee Time Clock and weekly pay tracking are internal operational tools, not formal payroll processing.

Current principles include:

- employee self-service punch timestamps are server-authoritative;
- historical corrections are authorized manager/admin workflows with audit evidence;
- one open time entry per Employee;
- overlapping/cross-boundary time is allocated safely to the appropriate pay week;
- Saturday-Friday pay weeks with Friday payday baseline;
- historical rate and closed-week snapshots are preserved;
- closed-week and downstream carryover integrity rules prevent ordinary mutation that would corrupt later snapshots.

Do not extend Slim into payroll taxes, withholding, overtime engines, direct deposit, benefits, tax filing, or payroll-provider integration without a separately authorized future architecture decision.

## Employee Portal Boundary

The Employee Portal is a restricted employee surface, not a duplicate owner/admin application.

Installed portal surfaces may be:

1. Time Clock
2. My Pay
3. Messages
4. Announcements

Employees see only their own Time Clock/My Pay information. Messages and Announcements use same-tenant active-user/employee visibility rules.

Stages 7-8 exclude group chat, channels, message attachments, reactions, typing indicators, presence, voice, video, surveys, polls, social-feed comments, and likes.

## Backup And Restore Boundary

Slim backups are encrypted `.signguy-backup` packages using the existing authenticated container design. Passphrases and provider secrets are not stored in backup content.

Restore remains a validate/preview-before-mutation empty-tenant workflow and must preserve tenant relationships, checksums, supported data sections, safe user mapping, rollback behavior, and duplicate-restore protection.

Backup/restore includes Message, Announcement, target, and read-state records without restoring credentials or provider secrets.

Server backups are a separate hosted disaster-recovery boundary. They are
operator-run backup sets containing a SQLite snapshot created with `VACUUM INTO`
plus attachment files copied under a checksum manifest. Server backups are not
customer portable exports and must not be used to couple Slim to the full MVP
runtime.

Production deployments must explicitly configure durable absolute paths for the
SQLite database, private attachment root, and server backup root. Repository
defaults are development-only and fail production startup validation.

## Frontend Boundary

The Slim shell retains its compact left-side application navigation, contextual module navigation, and compact Office-style ribbon.

Do not expose deferred/excluded modules as disabled links, teaser cards, or `coming soon` placeholders.

Employee Messages/Announcements are placed inside the existing Employee Portal. Owner/admin announcement controls are placed in the existing Team area. Do not create a new top-level Communications area.

## Runtime And CI Boundary

Slim owns its own runtime version pins, dependency graph, migration history, CI, storage configuration, and deployment configuration.

CI must continue to run install/migration checks, tests, source/dependency exclusion guards, and production build.

The source/dependency exclusion guard should block full-product modules and explicitly deferred/excluded Slim modules, not legitimate merged or authorized Version 2 code.

## Technical-Debt Boundary

Current technical-debt authority is:

`docs/SLIM_TECHNICAL_DEBT_REGISTER.md`

Resolved architecture concerns include production source of truth, domain
extraction, navigation/capability visibility, and browser session transport.
Preserve those domain boundaries during future expansion.

Hardening Group C extracted the production slice of the monoliths. Hardening
Group D extracted the employee/time/pay/messages/announcements slice. Group E
extracted the remaining general service/page domains so `SlimService` and
`App.jsx` stay focused on facade, core, shell, and route composition
responsibilities.

## Current Scope Authority Order

When documents conflict, use this precedence:

1. explicit current user authorization;
2. `AGENTS.md`;
3. `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`;
4. current merged code, migrations, tests, and reuse maps as evidence of implementation;
5. this architecture boundary;
6. historical Version 1 planning documents.

Historical statements that Version 2 must remain absent are superseded by the implemented Version 2 Stages 1-8 and the current Stage 9 deferral.
