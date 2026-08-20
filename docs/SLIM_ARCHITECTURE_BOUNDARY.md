# SignGuy Slim Version 1 Architecture Boundary

## Repository Boundary

`SIGNGUY-SLIM` is the only writable application repository for Version 1 Parts
1-5 and 7. It must not be a worktree, feature flag, alternate bundle, or
subdirectory of the MVP repository. The MVP checkout is a read-only reference
only.

`SIGNGUY-DATA-PORTABILITY` owns the portable backup/import contract and
validators. Slim consumes a pinned contract release only when export/restore
work is authorized.

## Part 1 Application Shape

Part 1 creates only:

- a runnable React shell;
- a constrained Version 1 navigation registry;
- a compact contextual ribbon surface that hides actions until the owning page is
  implemented;
- a source/dependency guard that fails validation if excluded modules are
  imported through static imports, exports, dynamic imports, CommonJS requires,
  or forbidden package dependencies;
- architecture, reuse, and remaining Version 1 implementation plans.

Part 1 does not create backend models, database migrations, API routes, storage
providers, feature pages, or test scaffolding for later parts.

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
Calendar, Invoices, and Settings in documentation. In Part 1 only Home is
visible because the remaining pages are not yet complete.

The exclusion guard scans production source import/export statements, dynamic
imports, CommonJS require calls, and `package.json` dependencies. It blocks
full-MVP or Version 2 modules from entering the Slim bundle.

## Runtime Version Boundary

Part 1 pins Node.js `24.16.0`, npm `11.13.0`, and every direct npm dependency.
Build/test tooling is kept in `devDependencies`. CI runs `npm ci`, tests,
guards, and production build.

## Backend Boundary For Later Parts

Later Version 1 backend work must use thin routers over services, tenant-scoped
queries, stable portable IDs, append-only audit records, integer cents for
money, and same-tenant relationship validation. No MVP Pricing Engine
calculation path may rewrite Slim historical manual prices.
