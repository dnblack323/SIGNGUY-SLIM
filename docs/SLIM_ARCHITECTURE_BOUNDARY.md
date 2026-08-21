# SignGuy Slim Version 1 Architecture Boundary

## Repository Boundary

`SIGNGUY-SLIM` is the only writable application repository for Version 1 Parts
1-5 and 7. It must not be a worktree, feature flag, alternate bundle, or
subdirectory of the MVP repository. The MVP checkout is a read-only reference
only.

`SIGNGUY-DATA-PORTABILITY` owns the portable backup/import contract and
validators. Slim consumes a pinned contract release only when export/restore
work is authorized.

## Part 4 Application Shape

Parts 1-4 include:

- a runnable React shell with completed Customers, Estimates, Orders, Invoices,
  Settings, and Calculator surfaces;
- a constrained Version 1 navigation registry that exposes only completed Part 4
  areas;
- a compact contextual ribbon for New Customer, New Estimate, New Order, New
  Invoice, and Calculator;
- an independent Node/SQLite backend with Slim-only migration history;
- tenant-scoped services with secure password hashing, database-backed sessions,
  same-tenant relationship checks, stable portable UUIDs, append-only audit, and
  tenant-specific record numbering;
- integer-cent money storage and decimal-safe Quick Entry quantity calculations;
- proportional document-discount allocation before tax and no negative invoice
  balances because Part 2 has no credit model;
- server-generated Estimate and Invoice PDFs;
- a URL-addressable full-screen Order Workspace at `#/orders/:orderId`;
- transactional Order and Order Item workspace saves with optimistic
  concurrency against `orders.updated_at`, atomic parent Order timestamp
  advancement, and differential item updates that preserve existing IDs,
  portable IDs, Estimate source links, and creation timestamps;
- a backend-enforced invoiced Order financial lock;
- item-level Production board stages `not_started`, `ready`, `in_progress`,
  `waiting`, and `complete`;
- derived production progress calculated from production-required Order Items;
- secure ordinary Order attachments backed by local filesystem storage and
  SQLite metadata, with streaming multipart upload, verified safe content,
  checksum/size integrity checks before preview or download, symlink escape
  protection, and metadata/audit rollback cleanup;
- tenant-scoped Calendar Events with stable portable IDs, same-tenant Order or
  Order Item links, active same-tenant user assignment, UTC-normalized timed
  events, plain-date all-day events, `scheduled`/`complete`/`cancelled` status,
  and transactional audits for scheduling, rescheduling, completion, reopening,
  and cancellation;
- a full Calendar surface with Month, Week, Day, and Agenda views, filters, and
  accessible form-based rescheduling;
- a Home dashboard containing only the mini Production board, rolling 14-day
  Calendar, and derived in-app Attention panel.

Part 4 does not create Parts 5-7 workflows, Version 2 scaffolding, external
identity providers, portals, Pricing Engine imports, recurring/resource
calendar scheduling, outbound notifications, camera capture, photo annotation,
production timers, Stripe, accounting, export/restore, or MVP importer code.

## Part 5 Backup/Restore Shape

Part 5 adds manual owner/admin backup and empty-tenant restore only under
Settings -> Backup & Restore. It does not add a top-level navigation section.

Backups are downloaded as `.signguy-backup` files. The container is encrypted
and authenticated with PBKDF2-HMAC-SHA256 plus AES-256-GCM through Node runtime
crypto primitives. Every backup uses a unique random salt and nonce. The
passphrase is supplied by the user for create/validate/restore and is never
stored, logged, returned, written into audit details, embedded in filenames, or
placed in URLs.

The encrypted payload contains the versioned manifest, deterministic logical
data-file inventory, attachment inventory, per-file and attachment SHA-256
checksums, tenant/shop settings, safe user references, Version 1 operational
records, attachment bytes, redacted audit provenance, and sequence state. The
unencrypted header contains only container signature/version and cryptographic
parameters needed to decrypt.

Validation rejects unknown crypto algorithms, unknown KDF settings, wrong salt,
nonce, tag, or ciphertext lengths, unexpected data sections, missing required
sections, duplicate manifest paths or attachment inventory entries,
package-relative path violations, record-count mismatches, data-file checksum
mismatches, attachment checksum/size/type mismatches, tenant ownership
violations, invalid relationships, unsupported schema versions, and duplicate
successful restore receipts.

Export streams the generated encrypted bytes directly in the authenticated HTTP
response and does not persist generated customer backups server-side. Restore
uploads use temporary files; validation cleans them after preview, and restore
removes uploaded temporary files on unauthorized, wrong-passphrase, malformed,
blocked, and rollback paths. Restore removes staged attachment files on failure
before reporting rollback.

Restore requires upload/decrypt/validate/preview before mutation. It is blocked
unless the target Slim tenant has no operational Customers, Estimates, Estimate
Items, Orders, Order Items, Invoices, Calendar Events, or active Order
attachments. Restore does not merge, overwrite, delete, selectively import, or
copy across non-empty tenants. It records tenant-scoped restore receipts and
blocks duplicate successful restores of the same backup into the same tenant.

Assignment mapping is email-based against existing active target-tenant users.
Unmatched assignment users are reported and require the explicit
`restore_unassigned` policy; the restore never creates login credentials or
links work to users from another tenant.

Part 5 remains a Slim-only implementation. The full MVP importer, MVP tenant
creation, Part 7 integrated hardening, automatic/scheduled cloud backups,
external backup subscriptions, Version 2 modules, and full-product records are
outside this boundary.

## Slim Runtime Boundary

Later Version 1 parts must add an independent stack:

- Slim-only database name and migration history;
- Slim-only object storage bucket/prefix;
- Slim-only secrets and deployment project;
- Slim-only CI/CD;
- no use of MVP production databases, storage, sessions, tokens, or domains.

Slim-to-MVP upgrade is permitted only through the portable package contract.

## Frontend Boundary

The shell follows the MVP pattern of a left application rail plus contextual
ribbon, but it removes the full-product module registry. The locked Version 1
navigation labels are Home, Customers, Estimates, Orders, Production, Calendar,
Invoices, and Settings. In Part 4, all of those completed Version 1 areas are
visible.

Order Workspace is not a separate main navigation section. It overlays the
existing app shell from `#/orders/:orderId`, locks background scroll, makes
background shell content inert, traps focus inside the dialog, prompts before
abandoning unsaved changes, and returns to `#/orders` or back to Production
based on the opener route.

The exclusion guard scans production source import/export statements, dynamic
imports, CommonJS require calls, and `package.json` dependencies. It blocks
full-MVP or Version 2 modules from entering the Slim bundle.

## Runtime Version Boundary

Part 1 pins Node.js `24.16.0`, npm `11.13.0`, and every direct npm dependency.
Build/test tooling is kept in `devDependencies`. CI runs `npm ci`, tests,
guards, and production build.

## Backend Boundary For Later Parts

Backend work uses a thin Node HTTP API over services, tenant-scoped queries,
stable portable IDs, append-only audit records, integer cents for money, and
same-tenant relationship validation. No MVP Pricing Engine calculation path may
rewrite Slim historical manual prices.

Attachment bytes stay outside SQLite under `SIGNGUY_SLIM_ATTACHMENT_ROOT`.
Attachment records contain random storage keys, checksums, MIME type, byte
size, creator, timestamps, and soft-delete state. Uploads stream to temporary
files before transactional metadata/audit finalization. Preview/download
verifies regular-file status, byte size, checksum, and symlink-safe storage
paths before auditing access. File operations validate tenant ownership,
prevent traversal/symlink escape, and do not return filesystem paths to the
frontend.

Calendar Events remain separate from Order due dates, Order Item due dates, and
Production completion. Completing or cancelling a Calendar Event does not mutate
linked Orders, Order Items, or production stages. Completing production does not
mutate linked Calendar Events. Part 4 intentionally excludes recurrence,
capacity/resource scheduling, appointment booking, route optimization, email,
SMS, browser push, and persistent notification-center behavior.
