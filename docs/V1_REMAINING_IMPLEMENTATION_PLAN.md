# Version 1 Remaining Implementation Plan

## Part 2 - Customers, Quick Entry, Estimates, Orders, Invoices, Calculator

Status: implemented in `codex/v1-part2-core-records`.

1. Added Slim backend foundation: config, database connection, auth context,
   tenant-scoped services, permissions, audit, integer-cent money helpers,
   migration history, and stable portable-ID assignment.
2. Implemented Customer model/service/API/UI/tests with tax-exempt state and
   same-tenant relationship checks.
3. Implemented Quick Entry line item model shared by Estimates and Orders with
   manual unit price only, taxable flag, production-required flag, due date,
   assigned user ID, item note, duplicate, remove, and reorder behavior.
4. Implemented Estimate UI/API over canonical Quote-style internals: create,
   edit-service support, duplicate, statuses, expiration, follow-up date,
   PDF/print endpoint, and idempotent conversion to one Order.
5. Implemented direct Orders and one Invoice per Order with document status
   separate from manually recorded payment status.
6. Implemented a regular arithmetic calculator as a complete utility, without
   pricing formulas or automatic writes into records.
7. Validated tenant/permission boundaries, totals/tax exemption, conversion
   idempotency, one-invoice enforcement, PDFs, migration history, guard, and
   build.

## Part 3 - Order Workspace, Attachments, Production

Status: implemented in `codex/v1-part3-order-workspace-production`.

1. Added full-screen URL-addressable Order Workspace using a simplified MVP
   Workspace Dock pattern.
2. Added ordinary secure Order attachments with streaming upload, list,
   preview/download, soft delete, local storage metadata, content validation,
   checksums, integrity checks, permission checks, rollback cleanup, and audit.
3. Added production-required Order Item board with Not Started, Ready, In
   Progress, Waiting, and Complete stages, drag movement, and accessible
   non-drag movement.
4. Persisted stage moves server-side and kept production completion separate
   from Order status and future Calendar completion.
5. Added atomic optimistic concurrency, stale-save conflict handling,
   differential Order Item saves that preserve portable/source identity,
   invoiced Order financial locking, derived progress, overlay accessibility
   guards, and focused backend/frontend tests.

## Part 4 - Dashboard, Calendar, Reminders

Status: implemented in `codex/v1-part4-dashboard-calendar-reminders`.

1. Added tenant-scoped Calendar Event persistence with stable portable IDs,
   same-tenant Order/Order Item links, active user assignment validation,
   timezone-safe timed/all-day storage, status transitions, and transactional
   audit.
2. Added full Month/Week/Day/Agenda Calendar with Previous, Today, Next,
   assigned-user/status/linked-record filters, accessible form-based
   rescheduling, related Order Workspace links, and create/edit/status actions.
3. Added Schedule Order and Schedule item overlays inside Order Workspace that
   create Calendar Events without saving or discarding dirty workspace edits.
4. Replaced Home placeholders with the requested mini Production board, rolling
   14-day Calendar, and derived in-app Attention panel.
5. Derived attention from Orders, production-required Order Items, Estimates,
   scheduled incomplete Calendar Events, and issued Invoices with remaining
   balance while avoiding duplicate source/reason reminders.
6. Validated migration history, tenant denial, date and enum validation, audit
   atomicity, Calendar/Order/production independence, dashboard range behavior,
   reminder wording, Calendar navigation, and existing Parts 1-3 regression
   behavior.

## Part 5 - Backup Export and Empty-Tenant Slim Restore

1. Pin the Version 1 portability contract release from
   `SIGNGUY-DATA-PORTABILITY`.
2. Implement owner/admin backup export with re-authentication, manifest,
   checksums, protected package handling, and attachment inclusion. Part 1 only
   defines the metadata contract; archive encryption is not implemented yet.
3. Implement dry-run restore preview, empty-tenant enforcement, transactional
   restore, rollback, and result report.
4. Generate sanitized application-produced golden packages.
5. Validate schema, semantic business rules, secrets absence, archive safety,
   rollback, idempotency, relationship preservation, totals, statuses, and
   attachment checksums.

## Part 6 - MVP Upgrade Importer

1. Use the real MVP repository only after explicit Part 6 authorization.
2. Pin the exact released portability contract.
3. Add a narrow `Import from SignGuy Slim` workflow for new empty MVP tenants.
4. Map Slim Customers, Estimates/Quotes, Orders, Order Items, Work Orders,
   Invoices, Calendar events, reminders, notes, and attachments into canonical
   MVP services without rerunning the Pricing Engine.
5. Validate dry run, confirmation, tenant isolation, idempotency, unsupported
   record reporting, rollback, totals/status preservation, and attachment
   checksums.

## Part 7 - Integrated Validation and Hardening

1. Produce a real Slim backup from representative data.
2. Restore it into an empty Slim tenant.
3. Dry-run/import it into an empty MVP tenant.
4. Compare source/target record counts, relationships, totals, statuses,
   schedules, notes, portable IDs, and attachment checksums.
5. Run security, migration, accessibility, bundle/import guard, focused/full
   relevant tests, and production build.
6. Confirm Version 2 code, schema, dependencies, routes, navigation,
   placeholders, tests, and scaffolding remain absent.
