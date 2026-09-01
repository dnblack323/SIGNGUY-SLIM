# SignGuy Slim Technical Debt & Issue Register

This document is the living register for architectural issues, technical debt, consistency problems, deferred hardening, and product-structure decisions that should be addressed before they become expensive to unwind.

It is intentionally separate from feature implementation plans. New features belong in roadmap/specification documents. This file exists to record problems or risks in the current implementation that should not be forgotten.

## Status Values

- `OPEN` — confirmed issue or risk that still needs work.
- `PLANNED` — fix approach is agreed and should be scheduled.
- `IN PROGRESS` — active correction work exists.
- `BLOCKED` — cannot be completed until another dependency is resolved.
- `RESOLVED` — corrected and verified.
- `ACCEPTED` — intentionally retained after review; no correction planned.

## Priority Values

- `P0` — release blocker, security/data-integrity risk, or likely data corruption.
- `P1` — high architectural or maintainability risk; should be addressed before significant additional related work.
- `P2` — meaningful issue that can safely wait for a bounded hardening pass.
- `P3` — cleanup, consistency, documentation, or polish.

---

## Active Register

| ID | Priority | Area | Issue | Risk / Why It Matters | Recommended Direction | Status |
|---|---|---|---|---|---|---|

No active technical-debt items are currently tracked in this register. Resolved items remain recorded below for historical and regression context.

---

## Confirmed Good Architecture To Preserve

These are not issues. They are recorded here because future corrections should avoid accidentally undoing good decisions while fixing adjacent problems.

### Multi-Tenant Foundation

Slim has real tenant-owned records, users, sessions, numbering, relationship validation, and tenant-scoped business data. Do not replace this with a single-shop/global-account model.

### Order → Order Item → Work Order Separation

Orders and Order Items are real first-class commercial records. Work Orders are operational production records linked to Order Items. After release to production, Work Orders own operational stage/completion; Order Item production fields are constrained compatibility snapshots derived from active Work Orders.

### Financial Integrity

Money is stored in integer cents, quantities use decimal-safe representations, and document pricing/tax values are snapshotted. Historical prices must remain stable even after future Pricing Engine integration.

### Calendar Independence

Calendar Events are scheduling records, not hidden status controls. Completing a Calendar Event must not silently complete an Order, Order Item, or production record, and production completion must not silently complete Calendar Events.

### Portable Backup Boundary

Slim remains independently deployable and migrates through the portable backup/import contract rather than sharing the full MVP production database or runtime.

### Tenant Relationship Enforcement

Same-tenant validation should continue to exist at service/database boundaries for sensitive relationships instead of relying solely on frontend filtering.

---

## Rules For Adding New Issues

1. Add an item when a current implementation creates architectural risk, security risk, data-integrity risk, avoidable complexity, duplicated truth, inconsistent terminology, stale documentation, or maintainability debt.
2. Do not add speculative future features merely because they are not built yet.
3. Give every issue a stable `SLIM-###` ID so implementation work and PRs can reference it.
4. Do not delete resolved items. Move them to the resolved register so the reason and correction remain visible.
5. A fix should not be marked `RESOLVED` until tests or a focused review confirm the problem is actually gone.
6. When an issue affects a future feature area, address it before substantially expanding that area whenever practical.

---

## Resolved Register

### SLIM-005 - Authentication Transport Hardening

- original issue ID: `SLIM-005`;
- resolution date: 2026-09-01;
- correcting branch: `codex/hardening-group-f-auth-transport`;
- resolution: browser authentication no longer serializes or persists `access_token` bearer credentials. The backend continues using random opaque server-side sessions stored as token hashes, but login and registration now deliver the session credential only through the `signguy_slim_session` HttpOnly cookie. `/api/auth/me` authenticates by cookie and returns user, tenant, current capabilities, and a per-session `csrf_token`;
- security contract: authenticated browser `POST`, `PUT`, `PATCH`, and `DELETE` requests require `X-CSRF-Token`; CSRF validation runs after cookie authentication and before JSON or multipart body parsing. Missing or invalid CSRF returns `403 csrf_invalid`; missing, expired, revoked, or inactive-user sessions return `401 unauthorized`;
- local/production behavior: local HTTP development leaves the cookie non-`Secure`, while production, direct HTTPS, or explicit secure-cookie configuration set `Secure`. Reverse-proxy HTTPS headers are honored only with `SIGNGUY_SLIM_TRUST_PROXY=1`. The app remains same-origin by default and does not introduce wildcard credentialed CORS;
- verification: backend tests cover HttpOnly/SameSite/Secure cookie behavior, max-age/expiry, no serialized session token, explicit internal session credentials, cookie-backed `/auth/me`, duplicate-cookie handling, session-fixation resistance, multiple independent sessions, logout revocation, inactive-user rejection, expired-session rejection, rejected legacy bearer-only mutation, missing/bad/cross-session CSRF failures, GET without CSRF, and multipart CSRF coverage. Frontend tests cover cookie bootstrap, legacy localStorage cleanup, credentialed requests, unsafe-request CSRF headers, no Authorization header, no login token persistence, authenticated downloads, and multipart uploads.

### SLIM-001 - Production Source Of Truth

- original issue ID: `SLIM-001`;
- resolution date: 2026-09-01;
- correcting PR/branch: PR #13 on `codex/hardening-group-c-production-truth`;
- resolution: Work Orders are the operational production source of truth after release to production. Order Items remain the commercial/product source records and keep `production_required`, identity, quantity, pricing snapshot, due date, assignment, and descriptive fields. Legacy `order_items.production_stage` and `order_items.completed` remain only constrained compatibility snapshots derived from the active Work Order, or `not_started`/false before release;
- migration behavior: `014_hardening_production_source_of_truth.sql` preserves legacy columns, normalizes stale Order Item snapshots deterministically, deactivates active memberships on cancelled Work Orders, fails migration for Work Order stage/completed contradictions, and adds triggers for Work Order stage/completion consistency plus valid active production membership;
- verification: backend tests cover pre-release derivation, active Work Order authority, direct released-item production mutation rejection, stale snapshot rejection, Work Order stage/completed mismatch prevention, one active Work Order assignment per item, cancelled history exclusion, partial-production regroup/reopen behavior, Calendar independence, staff financial redaction, schema 012/013 backup compatibility, current backup round trip, malformed production backup relationships, and migration-014 upgrade/conflict behavior. Frontend tests cover Production board and Order Workspace agreement.

### SLIM-009 - Employee Time / Payroll Architecture

- original issue ID: `SLIM-009`;
- resolution date: 2026-09-01;
- correcting branch: `codex/hardening-group-d-employee-domain`;
- resolution: Employee administration, Time Clock, Time & Attendance, weekly pay summaries, pay-week close/reopen, and pay ledger service methods were extracted from `backend/src/services.js` into `backend/src/domains/employees/`. The corresponding employee management, time, payroll, and Employee Portal UI pages were extracted from `src/App.jsx` into `src/features/employees/`;
- ownership rule: time entries remain the authoritative worked-time source rows; open pay-week totals remain derived/recalculable; closed pay-week snapshots remain preserved until explicit reopen; advances, adjustments, and manual payments remain ledger source rows;
- verification: existing Stage 5-6 backend service tests and frontend route tests continued to pass after extraction, and lint reported zero errors with warnings below the established baseline.

### SLIM-010 - Employee Communications Architecture

- original issue ID: `SLIM-010`;
- resolution date: 2026-09-01;
- correcting branch: `codex/hardening-group-d-employee-domain`;
- resolution: Employee Announcement and one-to-one Internal Employee Message service methods were extracted from `backend/src/services.js` into `backend/src/domains/employees/`, and announcement/message management and portal pages were extracted from `src/App.jsx` into `src/features/employees/`;
- ownership rule: internal employee messages remain separate from customer communication history and Order Intake; sent message bodies remain immutable; announcements remain managed records with separate per-Employee read state;
- verification: existing Stage 7-8 backend service tests and frontend route tests continued to pass after extraction, and lint reported zero errors with warnings below the established baseline.

### SLIM-002 - Backend Service Monolith

- original issue ID: `SLIM-002`;
- resolution date: 2026-09-01;
- correcting branch: `codex/hardening-group-e-decomposition`;
- resolution: the remaining non-production and non-employee business service methods were moved out of `backend/src/services.js` into focused domain modules for communications/intake, customers, quotes, orders, calendar, dashboard, attachments, and invoices/payments. `SlimService` remains the public compatibility facade and owns only construction, transactions, numbering, audit, auth/session/bootstrap, tenant/settings/user administration, backup facade, audit trail reads, and PDF composition;
- installer behavior: Group E added a reusable installer helper that converts class prototype methods into domain method maps, installs method groups idempotently, rejects duplicate domain method names, and rejects prototype collisions before mutating the service prototype;
- verification: service compatibility is covered by the existing backend suite plus focused installer tests for idempotent install, duplicate detection, and collision rejection.

### SLIM-003 - Frontend App Monolith

- original issue ID: `SLIM-003`;
- resolution date: 2026-09-01;
- correcting branch: `codex/hardening-group-e-decomposition`;
- resolution: the remaining page and workspace bodies for Home, Customers, Quotes, Orders, Incoming Requests, Order Workspace, Calendar, Invoices, Payments, Settings, Backup & Restore, camera capture, annotation, communication panels, and shared document helpers were moved out of `src/App.jsx` into focused feature modules. `src/features/general/GeneralPages.jsx` remains a shared UI/helper module rather than a replacement page monolith. `App.jsx` now focuses on stored-session bootstrap, route parsing, route access redirects, sidebar/header/module-tab shell composition, drawer behavior, Order Workspace overlay ownership, and calculator composition;
- verification: existing frontend routing and workflow tests continue to cover the moved components, lint remains at zero errors with the established hook-warning baseline, and production build succeeds.

### SLIM-004 - Order Intake Navigation Placement

- original issue ID: `SLIM-004`;
- resolution date: 2026-08-31;
- correcting branch: `codex/hardening-group-b-navigation`;
- resolution: the underlying Stage 2 intake domain remains intact, but the current navigation presents it as **Incoming Requests** inside Orders at `#/orders/incoming`;
- verification: frontend route/navigation tests cover the canonical route and the legacy `#/orders/intake` redirect.

### SLIM-006 - Quote Terminology

- original issue ID: `SLIM-006`;
- resolution date: 2026-08-31;
- correcting branch: `codex/hardening-group-b-navigation`;
- resolution: current customer-facing proposal language is **Quote** across navigation, primary UI labels, email defaults, backup-preview labels, documentation, and generated PDF title/content;
- retained compatibility: internal route/API/database/service identifiers continue to use `estimate*` because renaming those records would add migration risk without product value in this hardening pass;
- verification: app tests cover Quote UI behavior and backend tests cover Quote PDF output.

### SLIM-007 - Shop Operations Flattening

- original issue ID: `SLIM-007`;
- resolution date: 2026-08-31;
- correcting branch: `codex/hardening-group-b-navigation`;
- resolution: Shop Operations now exposes Customers, Quotes, and Orders as direct modules instead of nesting them under Sales;
- verification: navigation tests assert the flattened module order.

### SLIM-011 - Capability-Aware Navigation

- original issue ID: `SLIM-011`;
- resolution date: 2026-08-31;
- correcting branch: `codex/hardening-group-b-navigation`;
- resolution: authenticated sessions now include backend-calculated capabilities, and frontend navigation/route guards consume those capabilities for Employees, Time & Attendance, Payroll, Employee Portal, and Announcement management;
- verification: backend service tests cover capability derivation, and frontend tests cover capability-gated navigation plus Payroll and Employee Portal redirects.

### SLIM-016 - Route And Utility Alias Cleanup

- original issue ID: `SLIM-016`;
- resolution date: 2026-08-31;
- correcting branch: `codex/hardening-group-b-navigation`;
- resolution: `#/payments` now renders a distinct Payments page for cumulative invoice paid-to-date tracking, `#/backup` renders Backup & Restore directly, `#/tasks` and `#/pricing` no longer render aliased product pages, and stale Notifications/Account utilities were removed;
- verification: frontend route tests cover Payments, Backup & Restore, and removed alias behavior.

### SLIM-008 - README Scope Was Stale

- original issue ID: `SLIM-008`;
- resolution date: 2026-08-30;
- correcting PR/commit: PR #9 follow-up finalization commit;
- short description: `README.md` was updated from Version 2 Stages 1-4 scope to current Version 2 Stages 1-6 scope, including employee administration, Time Clock, My Pay, Time & Attendance review, Saturday-Friday weekly pay tracking, advances, adjustments, manual payments, carryover, close, and reopen;
- verification performed: documentation review plus full Stage 5-6 validation before PR finalization;
- intentionally retained limitations: README still points readers to reuse maps and this register rather than duplicating every implementation detail inline.

### SLIM-012 - Lint And React Hooks Static Analysis Gate

- original issue ID: `SLIM-012`;
- resolution date: 2026-08-31;
- correcting PR/commit: draft PR #11 on Group A hardening branch `codex/hardening-group-a-guardrails`;
- short description: added ESLint flat config, `npm run lint`, and a Slim CI lint step. The lint gate covers `src/**/*.js`, `src/**/*.jsx`, `backend/src/**/*.js`, and `tools/**/*.mjs`, ignores runtime/generated directories including `/artifacts/`, enforces JavaScript correctness rules and `react-hooks/rules-of-hooks` as errors, and reports `react-hooks/exhaustive-deps` as a visible warning baseline;
- verification performed: `npm run lint` passed locally with zero errors and existing hook dependency warnings visible; final CI verification is required before merge;
- intentionally retained limitations: exhaustive dependency findings remain warnings during this first baseline because fixing the existing large-component dependency graph belongs with later monolith/capability hardening rather than this guardrail branch.

### SLIM-013 - Backup And Restore Preview Transparency

- original issue ID: `SLIM-013`;
- resolution date: 2026-08-31;
- correcting PR/commit: draft PR #11 on Group A hardening branch `codex/hardening-group-a-guardrails`;
- short description: expanded Restore Preview to group backend-reported record counts by System & Tenant, Shop Records, Production & Scheduling, Customer Communications & Intake, Employees, Time & Pay, Messages & Announcements, and Files. The wording now describes the current Slim backup scope and still states that passwords, sessions, auth tokens, API keys/secrets, logs, temporary URLs, and external credentials are excluded;
- verification performed: added frontend tests for current Stage 8 backup counts and compatible Stage 5-6 previews, and backend assertions for current/legacy preview count behavior;
- intentionally retained limitations: the UI only renders keys actually reported by the backend preview payload. It does not imply backup support for currently unreported domains such as Work Orders, commercial bundles, or intake records.

### SLIM-014 - Version Metadata Updated To Post-Stage-8

- original issue ID: `SLIM-014`;
- resolution date: 2026-08-31;
- correcting PR/commit: draft PR #11 on Group A hardening branch `codex/hardening-group-a-guardrails`;
- short description: updated `package.json` and `package-lock.json` from `0.2.0-v2-stage6` to `0.2.0-v2-stage8`, and updated backup provenance fallback to the same current version. README now states that `package.json` is the application-version source of truth;
- verification performed: repository search confirmed intentional current metadata, package-lock root version updated, and tests/build run against the new package version;
- intentionally retained limitations: older backup previews may still display their historical source version, such as `0.2.0-v2-stage6`, because that value is provenance rather than current application metadata.

### SLIM-015 - Root Artifacts Directory Ignored

- original issue ID: `SLIM-015`;
- resolution date: 2026-08-31;
- correcting PR/commit: draft PR #11 on Group A hardening branch `codex/hardening-group-a-guardrails`;
- short description: added exact root `.gitignore` rule `/artifacts/` so the user-owned artifacts directory no longer makes an otherwise clean workspace appear dirty;
- verification performed: `git status --short --ignored` reports `!! artifacts/` and no staged or tracked artifact content;
- intentionally retained limitations: existing artifact contents remain outside repository ownership and were not inspected, moved, deleted, or modified.

When an item is resolved, record:

- original issue ID;
- resolution date;
- correcting PR/commit;
- short description of the chosen solution;
- verification performed;
- any intentionally retained limitations.

---

## Review Cadence

Review this register:

- before beginning a major new Slim stage;
- after merging a major stage;
- before commercial release/hardening;
- whenever a code review discovers a cross-cutting architectural concern.

The goal is not to eliminate all technical debt immediately. The goal is to prevent known debt from becoming invisible and quietly hardening into permanent architecture.
