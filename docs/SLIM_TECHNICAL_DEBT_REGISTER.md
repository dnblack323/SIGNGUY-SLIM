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
| SLIM-002 | P1 | Backend Architecture | `backend/src/services.js` has grown into a very large cross-domain service file. | Continued feature additions will increase coupling, make regressions harder to isolate, and recreate the monolithic architecture the rebuild was intended to avoid. | Split backend code by domain such as auth, customers, estimates/quotes, orders, invoices, production, scheduling, communications, attachments, and backup. Prefer small service/schema/repository modules without introducing unnecessary framework complexity. | OPEN |
| SLIM-003 | P1 | Frontend Architecture | `src/App.jsx` is becoming a frontend monolith containing navigation, calendar, production, intake, attachment, annotation, session, and screen logic. | Large centralized UI files become difficult to reason about, test, and safely modify. Feature work can begin to interfere with unrelated areas. | Move major features into domain folders/components such as orders, production, calendar, customers, communications, attachments, and shared shell/navigation. Keep `App.jsx` primarily responsible for application composition and routing. | OPEN |
| SLIM-004 | P2 | Orders / Intake | `Order Intake` is currently represented as its own persistent workflow and navigation destination. | This may create an unnecessary business object and extra destination when the user goal is simply handling incoming order requests. It risks repeating earlier over-structuring problems. | Re-evaluate after real use. Prefer an Orders Inbox / Incoming Requests experience within Orders unless independent Intake proves operationally necessary. Preserve useful email-to-order capture without forcing a separate major workflow. | OPEN |
| SLIM-005 | P2 | Authentication | Browser session bearer token is stored in `localStorage`. | Any successful same-origin script injection can read the token. This is acceptable for current development but weaker than the preferred commercial-hosting session model. | Before production hosting, evaluate moving authenticated sessions to Secure, HttpOnly, SameSite cookies with server-side session storage and appropriate CSRF protections. | OPEN |
| SLIM-006 | P2 | Terminology | Slim uses `Estimate` while the broader SignGuy product architecture has increasingly standardized around `Quote`. | Different terminology between Slim and the full product increases training friction, documentation inconsistency, and upgrade confusion. | Decide the commercial UI term once. Prefer `Quote` for user-facing language if that remains the full-product standard. Internal database names may remain `estimate*` if renaming provides little value. | OPEN |
| SLIM-007 | P2 | Navigation | Shop Operations currently nests Estimates, Order Intake, and Orders under a `Sales` grouping. | Primary shop workflows require an extra conceptual/navigation layer that may provide little value in the Slim product. | Keep Slim navigation intentionally flat where possible. Consider Customers, Quotes/Estimates, and Orders as direct Shop Operations destinations. | OPEN |
| SLIM-008 | P3 | Documentation | `README.md` still states that Version 2 code is not authorized, while `main` already contains Version 2 communications/intake and camera/annotation work and package version `0.2.0-v2-stage4`. | Future coding sessions can follow stale constraints and make incorrect architectural decisions. Documentation becomes actively misleading instead of merely outdated. | Update README scope/status after each completed stage or maintain a single authoritative current-scope section that tracks what is actually on `main`. | OPEN |

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

No items have been moved here yet.

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
