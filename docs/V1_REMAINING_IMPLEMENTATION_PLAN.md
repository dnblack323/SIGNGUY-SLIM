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

Status: implemented in `codex/v1-part5-backup-restore`.

1. Added owner/admin-only Settings -> Backup & Restore workflow for manual
   encrypted `.signguy-backup` export, validation/preview, explicit restore
   confirmation, and restore history.
2. Added a Slim-local backup container using Node runtime cryptography:
   PBKDF2-HMAC-SHA256 with 310,000 iterations derives a per-backup key from a
   user passphrase, and AES-256-GCM encrypts/authenticates the manifest, tenant
   data, and attachments with unique random salt and nonce for every backup.
3. The unencrypted container header contains only signature, format,
   algorithm/KDF metadata, salt, nonce, tag, and ciphertext. Customer data,
   manifest, record inventory, checksums, attachment bytes, and tenant
   provenance are encrypted. Passphrases are never stored, logged, returned, or
   included in audit details.
4. Export includes tenant/shop settings, safe user references without password
   hashes, Customers, Estimates, Estimate Items, conversion links, Orders, Order
   Items, production stage/completion state, due dates, assignments, internal
   notes, Invoices/manual payment state, Calendar Events, active secure
   attachment metadata and bytes, tenant sequence state, and redacted audit
   provenance. Runtime credentials, sessions, token hashes, temporary URLs,
   environment variables, logs, caches, and Version 2/full-MVP records are
   excluded.
5. Validation decrypts the backup, authenticates ciphertext, verifies manifest
   version/product, strict crypto header values, record counts, deterministic
   data-file inventory, attachment inventory, sizes, checksums, overall
   integrity, supported attachment types, package-relative paths, expected data
   sections, tenant-scoped row ownership, and required relationships. It detects
   duplicate successful restores, incompatible schema versions, empty-target
   violations, malformed packages, and previews counts, source version/schema,
   attachment totals, warnings, blocking errors, and email-based user mapping.
6. Restore is allowed only into an empty Slim tenant with no operational
   Customers, Estimates, Estimate Items, Orders, Order Items, Invoices, Calendar
   Events, or active Order attachments. Non-empty tenants are blocked without
   merge, overwrite, delete, or partial restore behavior.
7. Restore rechecks integrity and emptiness immediately before writes, restores
   records transactionally, stages attachment bytes privately, removes staged
   files on failure, removes uploaded temporary files on wrong-passphrase,
   malformed-package, unauthorized, and rollback paths, preserves relationships,
   conversion links, production and Calendar independence, invoice payment
   state, and advances Customer, Estimate, Order, and Invoice sequences above
   restored numbers.
8. Duplicate protection records tenant-scoped restore receipts by backup ID and
   blocks retrying the same successfully restored backup into the same target.
9. Assignment mapping matches backup users to active target-tenant users by
   normalized email. Unmatched assignment users require the explicit
   `restore_unassigned` policy and are reported without linking to users from
   another tenant.
10. Part 6 MVP import, Part 7 hardening, automatic/scheduled cloud backups,
    merge/overwrite restore, selective restore, external storage subscriptions,
    and Version 2 modules remain unimplemented.

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
