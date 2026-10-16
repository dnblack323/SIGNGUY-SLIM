# Standalone feature integration validation — October 16, 2026

## Provenance and scope

The September 23 implementation was recovered from the existing dirty working tree at `b5475ddc8ef64e839478f746c317d20a09298a3c`. No replacement implementation or merge of the unchanged remote `emergent/work` branch was used. Existing changed and untracked files were copied to an external recovery directory before switching to `codex/complete-emergent-integration`. The pre-existing `.cursor/` directory and user-owned `artifacts/` remain outside the commit.

The port uses the existing Node/React backend, SQLite database, HttpOnly cookie sessions, CSRF protection, attachment storage, and backup infrastructure. No Emergent SDK, hosting service, external database, or vendor authentication is required. No runtime dependency or manifest change was introduced. The only dependency resolution changes are existing development transitive packages `brace-expansion` 5.0.9 → 5.0.12, `source-map-js` 1.2.1 → 1.2.2, and `undici` 8.10.0 → 8.12.2, to resolve current audit failures in the existing CI gate.

## Integrated behavior

| Area | Implementation |
| --- | --- |
| Platform Creator | Separate platform credentials, hashed sessions and cookie; tenant creation, suspension/reactivation, storage quotas, users, session revocation, audit trail, and audited tenant impersonation. |
| Production | Seven authoritative department columns: Design / Proof, Router / CNC, Print / Vinyl, Assembly, Paint / Finishing, Install / Shipping, Done. Work-order holds, budgets, labor totals and active-worker indicators. |
| Kiosk | Tenant-authenticated kiosk with employee PINs, tenant-bound bcrypt hashing, legacy hash upgrade, login/PIN throttling, inactivity lock, shifts, unpaid breaks, work-order and non-billable timers, and automatic timer closure. |
| Time and pay | Shared authoritative time entries, existing correction/overlap/closed-week rules, advance loans and deductions, immutable closed-week payroll snapshots, reopen rollback and CSV export. |
| Employee portal/PWA | Assigned queue, Time Clock, My Pay, punch-fix requests with authorized review, manifest and service worker. Private API, HTML and application-shell responses are not cached for offline use. |
| Exceptions | Long open shifts, over-budget work, low direct labor, outstanding loans, and punch-fix review. |
| Durability | Additive migrations 019–022 and encrypted tenant backup/restore coverage for new operational records, with existing historical backup compatibility and server recovery infrastructure retained. Authentication secrets and employee PINs are excluded from portable tenant backups. |

## Focused corrections during integration

- Enforced the existing manager-only completed-work reopen rule through the department-stage endpoint, with audit evidence.
- Kept legacy completion/reopen operations synchronized with the seven-column board.
- Mapped pre-port restored work orders to the same department/hold defaults used by migration 020.
- Preserved unpaid kiosk breaks when closing or correcting shifts through the employee portal/admin paths; closed active timers when shifts close or are voided.
- Applied existing closed-pay-week protection and payroll propagation to kiosk punches.
- Updated the schema-013 migration fixture to seed its historical row directly rather than invoking a current service method that now writes the migration-020 column. All migration assertions remain intact.

## Validation

The required install, migrations, full tests, lint, guard, production build and whitespace checks were run. Focused regressions cover populated schema-018 upgrade through 022, repeated migration idempotency, SQLite foreign-key/integrity checks, cross-tenant production access, staff reopen denial, legacy backup mapping and mixed kiosk/portal time flows. Existing hardening tests continue to cover platform/tenant credential separation, expired/revoked sessions, CSRF, quotas, suspension, impersonation, login/PIN rate limits, bcrypt PIN upgrades, time correction authorization, time overlaps, closed payroll weeks, loan snapshots and tenant backup round trips.

The full pre-correction baseline passed 476 tests in seven files. Four additional integration regressions bring the final suite to 480 tests. Lint has zero errors and the existing 18 hook warnings; production build retains the large-chunk advisory. Operations smoke reports healthy/ready with request correlation. Both dependency audits report zero vulnerabilities after the limited lockfile resolution update.

## Actual browser smoke

Used the real application through the Codex in-app browser at `http://127.0.0.1:5176`, backed by this repository's backend on port 4175 and a disposable SQLite database, attachments and backup roots under the system temporary directory. No live shop data or user-owned artifacts were used.

Verified by UI actions and persisted rendered state:

1. Platform Creator password login, tenant list/detail, users/sessions/storage controls, and audited owner impersonation.
2. Seven rendered Production Board columns; moved WO-00002 to Print / Vinyl, reloaded, and observed the same stage in the kiosk task picker.
3. Employee PIN login, kiosk clock-in, job selection/start, break start (which cleared the active timer), break end and clock-out.
4. Normal employee password login; Time Clock showed the kiosk punch history. Portal clock-in persisted across reload; portal clock-out persisted across another reload and a fresh tab.

The original tab recorded Vite websocket errors during the deliberate frontend stop for dependency installation; fresh-tab checks are used for post-restart console evidence. Browser acceptance is separate from unit tests; jsdom navigation notices are not treated as browser verification.

## Operator setup and limitations

Platform Creator setup remains operator-owned: configure `SIGNGUY_SLIM_PLATFORM_ADMIN_EMAIL` and `SIGNGUY_SLIM_PLATFORM_ADMIN_PASSWORD` through the existing server environment. Development auto-login is disabled in production. Kiosks require a normal tenant session and an active employee with a configured PIN and effective pay rate. Historical tenant restores require credentials/PINs to be configured again. Real-device PWA installation and owner acceptance on the deployed host were not part of the focused localhost smoke test. Publication and exact-final-commit CI/merge evidence are recorded on the integration pull request.
