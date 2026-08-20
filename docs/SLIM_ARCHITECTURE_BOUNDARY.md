# SignGuy Slim Version 1 Architecture Boundary

## Repository Boundary

`SIGNGUY-SLIM` is the only writable application repository for Version 1 Parts
1-5 and 7. It must not be a worktree, feature flag, alternate bundle, or
subdirectory of the MVP repository. The MVP checkout is a read-only reference
only.

`SIGNGUY-DATA-PORTABILITY` owns the portable backup/import contract and
validators. Slim consumes a pinned contract release only when export/restore
work is authorized.

## Part 3 Application Shape

Parts 1-3 include:

- a runnable React shell with completed Customers, Estimates, Orders, Invoices,
  Settings, and Calculator surfaces;
- a constrained Version 1 navigation registry that exposes only completed Part 3
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
  concurrency against `orders.updated_at`;
- a backend-enforced invoiced Order financial lock;
- item-level Production board stages `not_started`, `ready`, `in_progress`,
  `waiting`, and `complete`;
- derived production progress calculated from production-required Order Items;
- secure ordinary Order attachments backed by local filesystem storage and
  SQLite metadata.

Part 3 does not create Parts 4-7 workflows, Version 2 scaffolding, external
identity providers, portals, Pricing Engine imports, calendar scheduling,
camera capture, photo annotation, production timers, Stripe, accounting,
export/restore, or MVP importer code.

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
navigation labels remain Home, Customers, Estimates, Orders, Production,
Calendar, Invoices, and Settings in documentation. In Part 3, Home, Customers,
Estimates, Orders, Production, Invoices, and Settings are visible. Calendar
remains hidden until separately authorized.

Order Workspace is not a separate main navigation section. It overlays the
existing app shell from `#/orders/:orderId`, locks background scroll, prompts
before abandoning unsaved changes, and returns to `#/orders` when closed.

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
Attachment records contain random storage keys, checksums, MIME type, byte size,
creator, timestamps, and soft-delete state. File operations validate tenant
ownership, prevent traversal/symlink escape, and do not return filesystem paths
to the frontend.
