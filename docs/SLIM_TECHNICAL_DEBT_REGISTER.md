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
| SLIM-001 | P1 | Production Architecture | Production state exists on both `order_items` and `work_orders`. | Two records can represent the same real-world production state, creating synchronization drift and contradictory status displays as production features expand. | Define one authoritative production-state model. Keep Order Items as the commercial/production objects being made, and make Work Orders the operational production grouping/execution layer. Derive or tightly constrain duplicate state rather than allowing two independently editable truths. | OPEN |
| SLIM-002 | P1 | Backend Architecture | `backend/src/services.js` has grown into a very large cross-domain service file. | Continued feature additions will increase coupling, make regressions harder to isolate, and recreate the monolithic architecture the rebuild was intended to avoid. At the post-Stage-8 baseline the file is over 300 KB. | Split backend code by domain such as auth, customers, estimates/quotes, orders, invoices, production, scheduling, communications, employee/time/pay, attachments, and backup. Prefer small service/schema/repository modules without introducing unnecessary framework complexity. | OPEN |
| SLIM-003 | P1 | Frontend Architecture | `src/App.jsx` is a frontend monolith containing shell/navigation, calendar, production, intake, attachment, annotation, employee, payroll, messages, announcements, session, and screen logic. | Large centralized UI files become difficult to reason about, test, and safely modify. Stage 7-8 already produced a real conditional-hook runtime blocker during review, demonstrating the risk. | Move major features into domain folders/components and keep `App.jsx` primarily responsible for application composition and routing. | OPEN |
| SLIM-004 | P2 | Orders / Intake | `Order Intake` is currently represented as its own persistent workflow and navigation destination. | This may create an unnecessary business object and extra destination when the user goal is simply handling incoming order requests. It risks repeating earlier over-structuring problems. | Re-evaluate after real use. Prefer an Orders Inbox / Incoming Requests experience within Orders unless independent Intake proves operationally necessary. Preserve useful email-to-order capture without forcing a separate major workflow. | OPEN |
| SLIM-005 | P2 | Authentication | Browser session bearer token is stored in `localStorage`. | Any successful same-origin script injection can read the token. This is acceptable for current development but weaker than the preferred commercial-hosting session model. | Before production hosting, evaluate moving authenticated sessions to Secure, HttpOnly, SameSite cookies with server-side session storage and appropriate CSRF protections. | OPEN |
| SLIM-006 | P2 | Terminology | Slim uses `Estimate` while the broader SignGuy product architecture has increasingly standardized around `Quote`. | Different terminology between Slim and the full product increases training friction, documentation inconsistency, and upgrade confusion. | Decide the commercial UI term once. Prefer `Quote` for user-facing language if that remains the full-product standard. Internal database names may remain `estimate*` if renaming provides little value. | OPEN |
| SLIM-007 | P2 | Navigation | Shop Operations currently nests Estimates, Order Intake, and Orders under a `Sales` grouping. | Primary shop workflows require an extra conceptual/navigation layer that may provide little value in the Slim product. | Keep Slim navigation intentionally flat where possible. Consider Customers, Quotes/Estimates, and Orders as direct Shop Operations destinations. | OPEN |
| SLIM-009 | P2 | Employee Time / Payroll Architecture | Stage 5-6 employee time and weekly pay logic added substantial domain rules inside `backend/src/services.js` and `src/App.jsx`, including recalculated open-week summaries and closed-week snapshots. | Continued payroll expansion could blur the ownership boundary between derived open-week totals, finalized closed-week snapshots, and ledger/time source rows. | Before any external payroll/accounting integration, extract employee, time-entry, pay-week, and pay-ledger logic into dedicated backend/frontend modules and document the authoritative source versus snapshot rules. | OPEN |
| SLIM-010 | P2 | Employee Communications Architecture | Stage 7-8 announcements and one-to-one messages were added inside the existing `backend/src/services.js` and `src/App.jsx` monoliths to stay bounded and avoid unrelated restructuring. | Continued communication features could couple employee messaging, customer communication history, intake, and notifications unless domain modules are introduced before the surface grows. | Before any post-Stage-8 communication expansion, extract employee announcements/messages into focused backend and frontend modules and keep internal employee communication separate from customer communication history and Order Intake. | OPEN |
| SLIM-011 | P2 | Navigation / Authorization | Navigation visibility is based mainly on broad user roles and does not fully represent capability/eligibility rules. Payroll is exposed to all managers even though sensitive payroll APIs require owner or explicit pay-management permission, and Employee Portal is registered as an ordinary operational area without checking active Employee linkage or portal-access eligibility. | Users can be offered destinations or ribbon actions they are not actually allowed to use, producing authorization-error pages and making the UI permission model disagree with backend policy. Backend security remains the authority, but the navigation contract is misleading. | Add a capability-aware navigation model derived from `/auth/me` or a dedicated capabilities payload. Gate Payroll by pay-management capability and Employee Portal by active employee/portal eligibility. Keep backend checks unchanged. | OPEN |
| SLIM-016 | P2 | Navigation / Route Consistency | Several labels/routes imply distinct destinations but currently alias unrelated or broader pages: `#/payments` renders `InvoicesPage`, `#/tasks` renders `ProductionPage`, `#/backup` renders the full Settings page, `#/pricing` is a legacy Settings alias despite pricing being excluded, Notifications routes Home, and Account routes Settings. | The navigation map and actual product surface can diverge, confusing users and future developers and leaving stale route names that can be mistaken for implemented modules. | Decide which aliases are intentional. Remove dead/deferred aliases such as `/pricing`, rename utilities that are actions rather than pages, and either create a genuinely distinct page or collapse duplicate navigation entries. | OPEN |

---

## Confirmed Good Architecture To Preserve

These are not issues. They are recorded here because future corrections should avoid accidentally undoing good decisions while fixing adjacent problems.

### Multi-Tenant Foundation

Slim has real tenant-owned records, users, sessions, numbering, relationship validation, and tenant-scoped business data. Do not replace this with a single-shop/global-account model.

### Order → Order Item → Work Order Separation

Orders and Order Items are real first-class records. Work Orders are operational production records linked to Order Items. Preserve this separation while resolving the duplicate production-state concern in `SLIM-001`.

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
