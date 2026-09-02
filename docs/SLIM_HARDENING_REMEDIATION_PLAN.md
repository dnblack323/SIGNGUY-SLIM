# SignGuy Slim Hardening Remediation Plan

Baseline: post-Stage-8 `main`.

Goal: resolve known issues in grouped, low-risk batches without turning hardening into a rewrite. Each group should be implemented on its own branch/PR unless a later prompt explicitly combines them.

The groups below intentionally combine issues that touch the same ownership boundary or infrastructure. They are ordered to reduce risk before large refactors.

---

# Group A — Guardrails, Metadata, and Workspace Hygiene

Status: COMPLETE on 2026-08-31 in `codex/hardening-group-a-guardrails`.

Issues:

- `SLIM-012` — no lint / React Hooks static-analysis gate;
- `SLIM-014` — stale package/application version metadata;
- `SLIM-015` — `artifacts/` intentionally untracked but not ignored;
- `SLIM-013` — incomplete Backup & Restore preview transparency.

## Why these belong together

These are relatively bounded corrections that improve the safety and observability of every later hardening branch without changing core business ownership rules.

## Step A1 — Add lint/static analysis

Add a minimal JavaScript/React lint setup.

Required rules should include at least:

- React Hooks rules;
- undefined identifiers;
- obvious unreachable/duplicate code;
- basic unused-variable handling appropriate for the current codebase.

Add:

`npm run lint`

and run it in GitHub CI before build.

Do not weaken important rules simply to get a green baseline. Correct genuine findings found by introducing the lint gate.

## Step A2 — Correct version metadata

Update `package.json` and any other current application version markers from the stale Stage 6 value to the current post-Stage-8 baseline.

Choose one version source-of-truth rule and document it.

## Step A3 — Ignore user-owned artifacts safely

Add:

`/artifacts/`

to `.gitignore`.

Do not delete, move, stage, rename, or modify the existing directory.

## Step A4 — Expand Backup & Restore preview

Render the complete count set returned by the backend, organized by domain where practical.

At minimum include current records for:

- core commercial documents;
- communications/intake;
- employee/time/pay;
- messages/announcements;
- attachments/scheduling.

Update the old V1-only explanatory wording.

Add tests for current Stage 8 backup preview and older Stage 5-6 backup compatibility.

## Completion gate

- COMPLETE — lint passes locally with React Hooks rule violations enforced as errors and exhaustive dependency checks reported as warnings for the current monolith baseline;
- COMPLETE — existing tests pass;
- COMPLETE — build passes;
- COMPLETE — migration check passes;
- COMPLETE — backup preview renders the backend-reported current record counts by domain without inventing unsupported count keys;
- COMPLETE — `/artifacts/` is ignored and no `artifacts/` content changed.

---

# Group B — Navigation, Capability Visibility, and Product Structure

Status: COMPLETE on 2026-08-31 in `codex/hardening-group-b-navigation`.

Issues:

- `SLIM-011` — navigation visibility does not fully represent backend capabilities;
- `SLIM-016` — route/page aliases imply destinations that do not really exist;
- `SLIM-007` — unnecessary Sales nesting;
- `SLIM-004` — Order Intake placement requires a product decision;
- `SLIM-006` — Estimate vs Quote terminology requires a product decision.

## Why these belong together

All five issues change what users think the product contains and how they move through it. They should be resolved under one navigation/product-information architecture pass rather than piecemeal edits.

## Step B1 — Define a capability payload

Extend authenticated session/bootstrap data with explicit capabilities such as:

- `can_manage_employees`;
- `can_review_time`;
- `can_manage_pay`;
- `can_use_employee_portal`;
- `can_manage_announcements`.

Names may differ, but navigation should consume capabilities rather than infer everything from broad role strings.

Do not remove backend permission checks.

## Step B2 — Fix Payroll visibility

Only expose Payroll tabs/ribbons/navigation to users with actual pay-management capability.

Managers who can review time but cannot view pay should not be offered Payroll navigation.

## Step B3 — Fix Employee Portal visibility

Only expose Employee Portal when the actor is linked to an active same-tenant Employee with portal access enabled.

Owner/admin users who are also Employees may still use the portal if they satisfy that rule.

## Step B4 — Clean route aliases

Review each alias deliberately:

- `/payments`;
- `/tasks`;
- `/backup`;
- `/pricing`;
- Notifications utility;
- Account utility.

For each one choose one of:

1. create a genuinely distinct page;
2. rename/collapse it into the page it actually represents;
3. remove the stale alias.

Recommended immediate direction:

- remove `/pricing` compatibility handling because pricing is explicitly excluded;
- collapse Notifications if no notification center exists;
- rename Account behavior if it is simply Settings;
- decide whether Payments deserves its own filtered page or should remain part of Invoices;
- remove `/tasks` unless a distinct task board is actually intended.

## Step B5 — Flatten Shop Operations

Evaluate removing the Sales grouping so the current destinations become direct:

- Customers;
- Estimates/Quotes;
- Orders;
- Order Intake / Incoming Requests.

Avoid adding another hierarchy layer unless real usage justifies it.

## Step B6 — Decide Order Intake placement

Recommended default:

keep the underlying Intake domain but present it as an **Incoming Requests / Order Intake view inside Orders**, not as a peer business universe.

Do not destroy intake source/audit records just to simplify navigation.

## Step B7 — Decide Estimate vs Quote

Make one explicit product terminology decision.

If `Quote` wins:

- change user-facing labels only first;
- keep internal `estimate*` database/service identifiers unless a rename has real technical value.

If `Estimate` wins:

- document that Slim intentionally differs from the full product.

## Completion gate

- navigation matches real capabilities;
- no user is offered a page they cannot use under normal conditions;
- stale aliases are removed or explicitly documented;
- route tests cover owner/admin/manager/staff and employee-portal eligibility;
- backend permissions remain authoritative.

---

# Group C — Production Source-of-Truth and Production Domain Extraction

Status: IMPLEMENTED in PR #13 on `codex/hardening-group-c-production-truth`.

Issues:

- `SLIM-001` — production state exists on both Order Items and Work Orders;
- production portions of `SLIM-002` and `SLIM-003`.

## Why these belong together

Production ownership should be resolved before moving production code into new modules. Otherwise the refactor would simply preserve duplicated truth in cleaner files.

This is the highest data-model risk in the register.

## Step C1 — Inventory every production-state read/write

Map every place that reads or mutates:

- `order_items.production_stage`;
- `order_items.completed`;
- `work_orders.production_stage`;
- `work_orders.completed`;
- derived Order production status/progress;
- Production board display;
- Order Workspace display;
- Calendar links to Work Orders;
- backup/restore fields.

Do not change code until the matrix is complete.

## Step C2 — Lock the ownership rule

Recommended model:

- Order Item = commercial/product thing being made;
- Work Order = operational production execution/grouping;
- Work Order owns operational production stage after release to production;
- Order/Order Item production progress is derived from active Work Orders once released;
- legacy Order Item stage fields remain compatibility snapshots only until safely retired or constrained.

Explicitly define behavior before an Order is sent to production.

## Step C3 — Add invariants/tests before migration

Add tests proving the desired ownership rule before changing persistence.

Cover:

- individual-item grouping;
- whole-order grouping;
- custom groups;
- regrouping;
- completion/reopen;
- cancelled Work Orders;
- historical/released Work Order protection;
- Order-level derived progress.

## Step C4 — Constrain duplicate writes

Stop ordinary application code from independently updating both representations.

Prefer one authoritative write path and derived compatibility updates if legacy columns must remain temporarily.

## Step C5 — Migrate/backfill carefully if needed

If schema changes are required:

- additive migration first;
- deterministic backfill;
- conflict detection/reporting;
- no silent selection when existing states disagree.

## Step C6 — Extract production modules

After ownership is stable, move production-specific backend/frontend code into focused modules.

Backend candidate:

`backend/src/domains/production/`

Frontend candidate:

`src/features/production/`

## Completion gate

- IMPLEMENTED — `docs/GROUP_C_PRODUCTION_STATE_AUDIT.md` inventories the old duplicated state, read/write paths, UI consumers, backup behavior, and final ownership model;
- IMPLEMENTED — Work Orders are the operational production source of truth after release, while Order Item production fields are constrained compatibility snapshots;
- IMPLEMENTED — pre-release production-required Order Items derive `not_started`, and non-production items are excluded from production progress;
- IMPLEMENTED — active Work Order item membership is unique per Order Item, cancelled/superseded Work Orders do not drive current progress, and Work Order `completed` is constrained to match `production_stage`;
- IMPLEMENTED — Production board and Order Workspace use the same backend-derived production state;
- IMPLEMENTED — backup/restore exports Work Orders and Work Order item links, accepts older schema 012/013 backups, and validates Group C production relationships;
- IMPLEMENTED — production-specific backend state/query helpers live under `backend/src/domains/production/`, and the Production board UI lives under `src/features/production/`;
- VALIDATION REQUIRED PER BRANCH — full tests, lint, guard, build, in-memory migration, diff check, and CI must pass before merging.

---

# Group D — Employee, Time, Pay, Messages, and Announcements Modularization

Status: COMPLETE on 2026-09-01 in `codex/hardening-group-d-employee-domain`.

Issues:

- `SLIM-009` — employee time/pay ownership and modularity;
- `SLIM-010` — employee communications modularity;
- relevant portions of `SLIM-002` and `SLIM-003`.

## Why these belong together

Stages 5-8 share the same Employee/user identity boundary and were the most recent growth inside both monoliths. Extracting them together creates a coherent Employee domain without touching Orders/Production/Calendar at the same time.

## Step D1 — Document source/snapshot rules

IMPLEMENTED — `docs/GROUP_D_EMPLOYEE_DOMAIN_AUDIT.md` records:

- Time Entry is authoritative worked-time source;
- rate snapshot belongs to the Time Entry/pay calculation context;
- open pay-week totals are derived/recalculable;
- closed pay-week snapshot is immutable until explicit reopen;
- advances/adjustments/manual payments are ledger source rows;
- direct messages are immutable records;
- announcements are managed records with separate read state.

## Step D2 — Extract backend employee domain

IMPLEMENTED — Employee-domain service methods now live under:

```text
backend/src/domains/employees/
  shared.js
  capabilities.js
  employees.js
  time.js
  pay.js
  messages.js
  announcements.js
  index.js
```

`SlimService` keeps its public API shape and delegates those methods through the installed employee domain.

## Step D3 — Extract frontend employee features

IMPLEMENTED — Employee-domain React pages now live under:

```text
src/features/employees/
  EmployeePages.jsx
  employeeFormatters.js
```

Routing/shell composition remains in `App.jsx`; employee routes receive the existing shared UI primitives.

## Step D4 — Split tests by domain

Existing Stage 5-8 backend and frontend coverage remains authoritative for this behavior-preserving extraction. The first pass kept tests in their current files to avoid churn while proving no coverage was reduced.

## Completion gate

- IMPLEMENTED — behavior unchanged;
- IMPLEMENTED — existing Stage 5-8 tests pass after extraction;
- IMPLEMENTED — employee/customer communication separation is preserved;
- IMPLEMENTED — source/snapshot rules documented;
- IMPLEMENTED — `services.js` and `App.jsx` materially shrink;
- VALIDATION REQUIRED PER BRANCH — full tests, lint, guard, build, in-memory migration, diff check, npm install attempt, and CI must pass before merging.

---

# Group E — Remaining Backend/Frontend Monolith Decomposition

Status: COMPLETE on 2026-09-01 in `codex/hardening-group-e-decomposition`.

Issues:

- remaining `SLIM-002`;
- remaining `SLIM-003`.

## Why this is separate

After Groups C and D, two of the most complex/risky domain slices will already be extracted. The remaining refactor can then proceed incrementally rather than as a single enormous PR.

## Recommended extraction order

1. communications + Order Intake;
2. attachments/camera/annotation;
3. calendar/scheduling;
4. invoices/payments;
5. orders/estimates/customers;
6. shared shell/navigation/ribbon helpers.

Each extraction should be behavior-preserving and independently reviewable.

Do not redesign APIs merely because files are moving.

## Completion gate

- IMPLEMENTED — `docs/GROUP_E_DECOMPOSITION_AUDIT.md` inventories the remaining monolith responsibilities before extraction;
- IMPLEMENTED — backend service methods for communications/intake, customers, quotes, orders, calendar, dashboard, attachments, and invoices/payments live under focused `backend/src/domains/` modules and are installed through a reusable collision-checked installer;
- IMPLEMENTED — `backend/src/services.js` is reduced to the core facade, auth/session/bootstrap, tenant/settings/user administration, backup facade, audit trail, and PDF composition;
- IMPLEMENTED — frontend page/workspace implementation is moved out of `src/App.jsx`; `App.jsx` remains the shell/router/session/overlay composition file;
- VALIDATION REQUIRED PER BRANCH — full tests, lint, guard, build, in-memory migration, diff check, npm install attempt, and CI must pass before merging.

---

# Group F — Commercial Authentication / Session Hardening

Status: IMPLEMENTED on branch `codex/hardening-group-f-auth-transport`.

Issue:

- `SLIM-005` — bearer token stored in browser `localStorage`.

## Why this should wait until after major internal refactoring

Changing authentication transport affects every API request and can introduce CSRF/session behavior changes. It should be done on a stable modular baseline, but before commercial hosted release.

## Step F1 — Design cookie-session contract

Use server-side database sessions with:

- Secure cookie in production;
- HttpOnly;
- SameSite policy;
- appropriate session expiration/revocation;
- explicit CSRF strategy for state-changing requests.

## Step F2 — Remove browser-readable token persistence

Do not store bearer session secrets in `localStorage`.

## Step F3 — Update API client/auth bootstrap

Use credentialed cookie requests and `/auth/me` session bootstrap.

## Step F4 — Security tests

Cover:

- login/logout;
- expired/revoked session;
- CSRF protections;
- cross-tenant session isolation;
- no token exposure to frontend storage.

## Completion gate

No browser-readable long-lived session secret remains, and all auth regression/security tests pass.

## Implemented Group F contract

- The existing `sessions` table remains the server-side session source of truth and stores only hashed opaque session tokens.
- Login and registration set `signguy_slim_session` locally and `__Host-signguy_slim_session` in secure contexts as an HttpOnly, `SameSite=Lax`, `Path=/` cookie with expiry/max-age. Production, explicit `SIGNGUY_SLIM_COOKIE_SECURE=1`, and direct HTTPS requests set `Secure`; reverse-proxy HTTPS headers are honored only with `SIGNGUY_SLIM_TRUST_PROXY=1`; local HTTP development does not set `Secure`.
- Login and registration validate Origin/Fetch Metadata before issuing a session cookie, and API responses use private/no-store cache headers with `Vary: Cookie`.
- Session JSON no longer includes `access_token` or `token_type`. It includes `user`, `tenant`, `capabilities`, and a non-secret `csrf_token`.
- `/api/auth/me` authenticates through the cookie and remains the authoritative capability refresh endpoint.
- The frontend removes legacy `signguySlimSession` localStorage state during bootstrap, then calls `/api/auth/me` with `credentials: "include"`.
- Authenticated unsafe browser requests send `X-CSRF-Token`; the backend validates it before parsing JSON or multipart request bodies.
- Logout revokes the server-side session and clears the auth cookie.
- Active sessions, cookies, and CSRF tokens remain runtime auth state and are excluded from tenant backup data.

---

# Recommended Execution Order

## 1. Group A — Guardrails first

Reason: lint and clearer backup/release metadata make every later branch safer.

## 2. Group B — Navigation/capability cleanup

Reason: low-to-medium risk, immediately improves product clarity before deeper refactoring.

## 3. Group C — Production source-of-truth

Reason: highest remaining data-ownership risk. Resolve before more production work.

## 4. Group D — Employee domain modularization

Reason: Stages 5-8 are now complete and are a coherent extraction boundary. Status: implemented in draft PR on `codex/hardening-group-d-employee-domain`.

## 5. Group E — Remaining monolith decomposition

Reason: perform incrementally after the riskiest domains have been stabilized. Status: complete in `codex/hardening-group-e-decomposition`.

## 6. Group F — Authentication hardening

Reason: required before commercial hosting, but safer after the internal module boundaries stop moving rapidly.

Status: implemented in `codex/hardening-group-f-auth-transport`.

---

# Items That Need A Product Decision Before Code Changes

These should not be silently decided by a refactor:

1. `SLIM-004` — whether Order Intake remains a named Orders subview or becomes Incoming Requests / Inbox;
2. `SLIM-006` — Estimate vs Quote user-facing terminology;
3. `SLIM-007` — exact final Shop Operations hierarchy;
4. `SLIM-016` — whether Payments deserves a distinct page or remains part of Invoices.

All other currently listed issues have a reasonably direct technical remediation path.

---

# Branch / PR Rule For Hardening

Use one branch/PR per group by default.

Do not combine Groups C-E into one giant refactor PR.

For every group:

1. start from current clean `origin/main`;
2. record baseline tests;
3. make bounded changes only;
4. add focused regression tests;
5. run migration/test/lint/guard/build checks;
6. perform live PR review-thread verification before merge;
7. update the technical-debt register only after verified completion;
8. preserve `artifacts/` without touching its contents.
