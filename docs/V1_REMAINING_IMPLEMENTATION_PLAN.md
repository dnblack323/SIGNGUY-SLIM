# Version 1 Remaining Implementation Plan

## Part 2 - Customers, Quick Entry, Estimates, Orders, Invoices, Calculator

1. Add Slim backend foundation: config, database connection, auth context,
   tenant-scoped dependencies, permissions, audit, integer-cent money helpers,
   and stable portable-ID assignment.
2. Implement Customer model/service/router/tests with tax-exempt state and
   same-tenant relationship checks.
3. Implement Quick Entry line item model shared by Estimate/Quote and Order with
   manual unit price only, taxable flag, production-required flag, due date,
   assigned user ID, and item note.
4. Implement Estimate UI over canonical Quote internals: create/edit/duplicate,
   statuses, expiration, follow-up date, PDF/print, and idempotent conversion to
   one Order.
5. Implement direct Orders and one Invoice per Order with document status
   separate from manually recorded financial status.
6. Implement a regular arithmetic calculator as a complete utility, without
   pricing formulas.
7. Validate tenant/permission boundaries, totals/tax exemption, conversion
   idempotency, one-invoice enforcement, PDFs, and build.

## Part 3 - Order Workspace, Attachments, Production

1. Add full-screen URL-addressable Order Workspace using the simplified MVP
   Workspace Dock behavior.
2. Add ordinary secure attachments with upload/preview/download/delete,
   object-storage metadata, checksums, permission checks, and audit.
3. Add production-required Order Item board with statuses Not Started, Ready, In
   Progress, Waiting, Complete, plus accessible non-drag movement.
4. Persist stage moves server-side and keep production completion separate from
   Order status and Calendar completion.
5. Validate deep links, unsaved-change prompts, attachment security, drag and
   keyboard movement, completion/reopen audit, derived progress, and build.

## Part 4 - Dashboard, Calendar, Reminders

1. Add Home dashboard widgets for mini Production board, rolling two-week
   Calendar, and attention panel.
2. Add full Month/Week/Day/Agenda Calendar for Orders and Order Items.
3. Persist schedule/reschedule changes with permission checks and audit.
4. Derive due/late reminders from Orders, Order Items, Estimates, scheduled
   incomplete work, and Invoices.
5. Validate date behavior, filters, reschedule persistence, reminder derivation,
   and the distinction between due dates, scheduled events, and production
   completion.

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
