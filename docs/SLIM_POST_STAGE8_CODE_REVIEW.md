# SignGuy Slim Post-Stage-8 Code Review

Baseline reviewed: `main` after merged PR #10, commit `c0d15c432d47cb16cdeb323297a89a58a52b2192`.

Purpose: perform a fresh architecture/code review after Version 2 Stages 1-8, distinguish current defects/debt from intentional product boundaries, and feed confirmed findings into `SLIM_TECHNICAL_DEBT_REGISTER.md`.

## Executive Summary

The Slim rebuild still has strong foundations: tenant isolation, first-class Order Items, Work Orders, integer-cent money, historical financial snapshots, independent Calendar records, encrypted portable backup/restore, and backend permission enforcement remain substantially better than the architecture patterns the rebuild was intended to replace.

The largest risk is now maintainability rather than a wholesale broken design. Feature delivery through Stage 8 has concentrated too much logic in a few files:

- `backend/src/services.js` is over 300 KB;
- `backend/src/backup.js` is over 50 KB;
- `src/App.jsx` contains most routed pages and major interactive workflows;
- `backend/src/services.test.js` has also grown into a very large cross-domain suite.

The review also confirmed several smaller but concrete issues around navigation/capability visibility, static analysis, backup preview transparency, release metadata, workspace hygiene, and route aliases.

No new evidence was found that Slim has reverted to a single-tenant/global-account architecture, floating-point financial storage, destructive attachment editing, automatic intake-to-order creation, or shared Slim/MVP production data stores.

---

## Confirmed Strengths To Preserve

### 1. Tenant-owned data remains the default

Tables and service relationships continue to carry tenant ownership. Later migrations add database triggers around high-risk employee, announcement, message, communication, intake, and pay relationships rather than relying only on frontend filtering.

### 2. Order / Order Item / Work Order separation exists

The product has not collapsed production back into one giant Order description. This should be preserved while resolving the duplicate production-state ownership problem.

### 3. Financial representation remains safe

Money continues to use integer cents. Historical document totals/rates/pay-week snapshots are preserved rather than silently recalculating old records from current settings.

### 4. Calendar remains operationally separate

Calendar completion and production completion remain separate concepts. This avoids hidden side effects between scheduling and production.

### 5. Attachment originals remain protected

Camera capture and annotation reuse the private attachment system and preserve immutable original images while storing derivatives separately.

### 6. Stage 7-8 internal communication remained separate from customer communication

Employee direct messages and announcements are not implemented as customer communication history or Order Intake records. This is the correct boundary.

---

## Previously Known Issues Still Confirmed

### SLIM-001 — Duplicate production state

`order_items` still contain production-stage/completion fields while `work_orders` also contain production-stage/completion fields. New code has added rules that increasingly treat Work Orders as the operational execution layer, but the duplicate representation still exists and remains the most important domain-ownership question before production grows further.

### SLIM-002 — Backend monolith

`backend/src/services.js` is now over 300 KB and contains logic spanning auth, settings, customers, estimates, orders, invoices, production, scheduling, communications, intake, attachments, employees, time, pay, messages, announcements, and backup-facing behavior.

### SLIM-003 — Frontend monolith

`src/App.jsx` contains application shell/navigation plus most major pages. The Stage 7-8 conditional-hook runtime blocker is concrete evidence that the size/coupling is no longer merely aesthetic debt.

### SLIM-004 — Order Intake product placement

Order Intake is useful, but it remains a separate persistent navigation destination beneath Sales. Whether it should ultimately become an Orders Inbox / Incoming Requests view remains a product-structure decision.

### SLIM-005 — localStorage bearer session

The browser still stores the authenticated bearer session in `localStorage`. Backend sessions are database-backed and token hashes are stored server-side, but a successful same-origin script injection could read the browser token.

### SLIM-006 — Estimate vs Quote terminology

User-facing Slim terminology remains `Estimate`, while the broader product architecture has leaned toward `Quote`. This should be decided once rather than gradually mixed.

### SLIM-007 — Sales navigation nesting

Customers is direct under Shop Operations while Estimates, Order Intake, and Orders are nested under Sales. This is more hierarchy than Slim may need.

### SLIM-009 — Employee time/pay source-vs-snapshot ownership

The implementation correctly distinguishes source Time Entries/ledger rows from pay-week summaries, but the rules are spread through the central service/UI files. They should be documented and modularized before external payroll/accounting work is ever considered.

### SLIM-010 — Employee communications architecture

Announcements/messages are correctly separate from customer communication, but they currently live inside the same giant backend/frontend files.

---

## New Findings Added By This Review

### SLIM-011 — Navigation does not fully represent authorization capabilities

Current navigation role filtering uses broad roles.

Examples:

- Payroll navigation is visible to all managers even though sensitive payroll access requires owner or explicit pay-management permission.
- Employee Portal is registered as an ordinary operational area without checking whether the current user has an active linked Employee with portal access enabled.
- Some ribbons link directly to pages whose backend permission policy is narrower than the ribbon's visibility rule.

Backend authorization remains intact, so this is not currently a privilege-escalation finding. It is a UI/authorization-contract mismatch that creates dead-end authorization errors and increases the chance that future developers assume visibility equals permission.

### SLIM-012 — No lint / React Hooks static-analysis gate

`package.json` has scripts for dev, backend migration, build, guard, and tests, but no lint/static-analysis script. CI likewise does not run a React Hooks lint rule.

This matters because the conditional-hook bug found during the PR #10 review passed the existing tests/build/guard and was found through human/automated review instead.

Before significant refactoring, the repo should add a lint gate, particularly `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` plus basic JavaScript correctness rules.

### SLIM-013 — Backup preview UI no longer reflects the backup's full contents

The backup format now includes records from communications/intake, employee/time/pay, messages, announcements, and read state.

The visible Restore Preview in `App.jsx`, however, only enumerates:

- customers;
- estimates;
- orders;
- order_items;
- invoices;
- calendar_events;
- attachments.

The UI notice also still describes backups as containing Slim V1 operational records and attachments.

The backend may validate the broader record inventory correctly, but the owner-facing confirmation screen is incomplete.

### SLIM-014 — Package version metadata is stale

`package.json` still reports:

`0.2.0-v2-stage6`

Stages 7-8 are now merged. Release/application metadata should not lag behind the actual product baseline.

### SLIM-015 — `artifacts/` is intentionally untracked but not ignored

Every clean workspace still reports:

`?? artifacts/`

The folder has repeatedly been preserved intentionally. Adding `/artifacts/` to `.gitignore` would preserve that behavior while reducing accidental staging and making real untracked changes easier to spot.

### SLIM-016 — Navigation aliases imply pages that do not actually exist as distinct surfaces

Current examples:

- `#/payments` renders `InvoicesPage`;
- `#/tasks` renders `ProductionPage`;
- `#/backup` renders the overall `SettingsPage`;
- `#/pricing` also renders `SettingsPage` even though pricing is excluded from Slim;
- Notifications routes to Home;
- Account routes to Settings.

Aliases are not inherently wrong, but labels that imply separate modules/pages should either resolve to a distinct experience or be collapsed/renamed. The stale `/pricing` alias is especially worth removing because it conflicts with the explicit no-Pricing-Engine Slim boundary.

---

## Navigation Review Notes

A full current map is maintained in:

`docs/SLIM_NAVIGATION_MAP.md`

The main structural observations are:

1. Shop Operations can probably be flatter.
2. Employee Portal should be capability/eligibility aware rather than just another role-neutral operational area.
3. Payroll needs capability-aware visibility.
4. Some aliases should be removed or re-labeled rather than pretending to be standalone pages.
5. Order Intake placement is a product decision, not an urgent code defect.

---

## File-Size / Coupling Observation

The repository tree at this baseline shows approximately:

- `backend/src/services.js`: 307 KB;
- `backend/src/services.test.js`: 146 KB;
- `backend/src/backup.js`: 56 KB;
- `backend/src/server.js`: 32 KB.

This does not mean large files are automatically broken. The concern is that unrelated domains share schemas, helpers, mutation rules, permissions, and tests inside the same modules, making a change to one area harder to isolate.

The remediation should therefore be domain extraction, not arbitrary file splitting.

---

## Release / Security Review Notes

### Sessions

Database-backed hashed session tokens are good. Browser `localStorage` is the remaining commercial-hosting weakness and belongs in a later authentication hardening batch.

### Uploads

Attachment upload paths retain size limits, content validation, checksum/integrity checks, private storage, and symlink/path protection. No new issue was added here during this review.

### Messages and announcements

Recent PR review corrections addressed sender/recipient synchronization, inactive historical participant viewing, archived announcement immutability, announcement timezone conversion, audit body history, and backup compatibility. No new Stage 7-8 blocker was identified in this pass.

### Backup compatibility

Stage 7-8 explicitly restored compatibility with Stage 5-6 schema-012 backups. The remaining issue found here is owner-facing preview completeness rather than backend compatibility.

---

## Review Conclusion

The repo is ready for a deliberate hardening cycle.

The recommended order is not to start with a giant full-app refactor. Put automated guardrails in place first, then resolve the production source-of-truth decision, then extract the employee/time/pay/communications domains that have grown most recently, then continue decomposing the remaining monolith incrementally.

See:

`docs/SLIM_HARDENING_REMEDIATION_PLAN.md`

for the grouped execution plan.
