# SignGuy Slim Version 1 Architecture Boundary

## Repository Boundary

`SIGNGUY-SLIM` is the only writable application repository for Version 1 Parts
1-5 and 7. It must not be a worktree, feature flag, alternate bundle, or
subdirectory of the MVP repository. The MVP checkout is a read-only reference
only.

`SIGNGUY-DATA-PORTABILITY` owns the portable backup/import contract and
validators. Slim consumes a pinned contract release only when export/restore
work is authorized.

## Part 2 Application Shape

Part 2 includes:

- a runnable React shell with completed Customers, Estimates, Orders, Invoices,
  Settings, and Calculator surfaces;
- a constrained Version 1 navigation registry that exposes only completed Part 2
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
- server-generated Estimate and Invoice PDFs.

Part 2 does not create Parts 3-7 workflows, Version 2 scaffolding, external
identity providers, portals, Pricing Engine imports, production board, calendar
scheduling, attachments, Stripe, accounting, export/restore, or MVP importer
code.

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
Calendar, Invoices, and Settings in documentation. In Part 2, Home, Customers,
Estimates, Orders, Invoices, and Settings are visible. Production and Calendar
remain hidden until their authorized parts.

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
