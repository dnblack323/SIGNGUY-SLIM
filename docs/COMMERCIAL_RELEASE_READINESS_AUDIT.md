# SignGuy Slim Commercial Release Readiness Audit

Audit date: 2026-09-02

Audited repository: `dnblack323/SIGNGUY-SLIM`

Audited main SHA: `ef0958039c098e3b9cc662030f1c48ef5c26844f`

Scope: audit only. Hardening Groups A-F are treated as complete and merged. Version 2 Stage 9 Facebook/Meta work remains deferred and was not implemented, scaffolded, or planned as part of this audit.

## Overall Classification

**NOT READY** for paying outside sign shops in a hosted commercial setting.

The current app is in strong shape for controlled pilot use by an operator who can manually manage persistence, backups, accounts, and abuse controls. It should not accept paying customers until the BLOCKER items below are fixed and the HIGH items either fixed or explicitly accepted with documented operational mitigations.

## Finding Counts

| Severity | Count |
| --- | ---: |
| BLOCKER | 2 |
| HIGH | 6 |
| MEDIUM | 8 |
| LOW | 4 |
| ACCEPTED / DEFERRED | 5 |

## Validation Evidence

| Check | Result |
| --- | --- |
| Baseline verification | Local `main` and `origin/main` both resolved to `ef0958039c098e3b9cc662030f1c48ef5c26844f` before audit changes. |
| Tracked working tree before audit doc | Clean. |
| `npm run test` | Passed: 203 tests across 4 files. |
| `npm run lint` | Passed: 0 errors, 14 warnings. |
| `npm run guard` | Passed: no excluded later-stage or full-MVP imports or dependencies found. |
| `npm run build` | Passed: Vite production build completed. |
| `SIGNGUY_SLIM_DB_PATH=:memory: npm run backend:migrate` | Passed: migrations applied to in-memory database. |
| `git diff --check` | Passed. |
| Audit-document trailing whitespace scan | Passed. |
| `npm audit --json` | Passed: 0 vulnerabilities. |
| `npm audit --omit=dev --json` | Passed: 0 production vulnerabilities. |
| `npm ci` | Failed non-destructively with Windows `EPERM` unlinking the Rolldown native binding under `node_modules/@rolldown/.binding-win32-x64-msvc-*`. No clean/reset/delete workaround was run. |

## Top Commercial Risks

1. **CRR-001**: No hosted server-side database backup/retention/restore plan.
2. **CRR-002**: Attachment bytes depend on local filesystem persistence without a production durability contract.
3. **CRR-003**: No rate limiting or abuse controls on login, registration, upload, restore, and other expensive endpoints.
4. **CRR-004**: No password reset or account recovery path.
5. **CRR-006**: `staff` can call broad commercial write routes, including customer/order/quote/email surfaces.
6. **CRR-005**: Public tenant self-registration is open without invite control, verification, or rate limiting.
7. **CRR-007**: Production configuration is incomplete and not fail-fast for hosted deployment mistakes.
8. **CRR-008**: No per-tenant storage quota or upload budget.
9. **CRR-009**: SQLite is not configured/documented for production concurrency and recovery constraints.
10. **CRR-011**: Operational observability is too thin for commercial support.

## Findings

### CRR-001

Severity: **BLOCKER**

Category: Hosted data durability and recovery

Affected file/component: `backend/src/db.js`, `.env.example`, `README.md`, deployment/operator documentation.

Evidence: `backend/src/db.js` defaults to `data/signguy-slim.sqlite` and opens a local SQLite file. The repository has portable tenant backup support, but no automated server-side database backup, retention schedule, off-machine copy, point-in-time restore procedure, or production restore drill. `.env.example` only lists the local database path and does not define a hosted backup contract.

Commercial risk: A disk loss, bad deployment, failed host, accidental overwrite, or operator mistake can permanently destroy all tenant business records. Portable exports are valuable, but they depend on someone manually creating and safely storing them before the incident.

Recommended correction: Add an initial production operations runbook and automation for SQLite database backups: scheduled consistent snapshots, off-host/off-volume retention, restore drill, pre-migration backup, and rollback expectations. If the initial topology uses a persistent volume, document and verify that volume separately from application code.

Code change required: **Yes**, if the app should provide a backup command, health/reporting metadata, or pre-migration backup helper. Otherwise a documented deployment automation/runbook can satisfy the first release gate.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Temporarily yes**, only if the operator owns and tests a concrete off-host backup and restore process before onboarding paying customers.

### CRR-002

Severity: **BLOCKER**

Category: Attachment/file durability

Affected file/component: `backend/src/domains/shared.js`, `backend/src/domains/attachments/service.js`, `backend/src/backup.js`, `.env.example`, deployment documentation.

Evidence: Attachment storage defaults to `data/attachments` through `SIGNGUY_SLIM_ATTACHMENT_ROOT`. Uploads and annotation derivatives are stored as filesystem bytes while metadata stays in SQLite. The code correctly protects filenames, paths, MIME/content, symlinks, checksums, and private authenticated preview/downloads, but the repository does not document a required persistent volume/object store, backup inclusion schedule, retention, or restore procedure for the hosted attachment root.

Commercial risk: Customer artwork, proofs, photos, annotated derivatives, and intake attachments can disappear across redeploys or host replacement if the app is deployed on ephemeral disk. This is a direct customer-data-loss risk.

Recommended correction: Define and enforce a production attachment durability contract: persistent mounted storage or object storage, off-host backups, restore relationship verification, storage monitoring, and operator recovery steps. Add a deployment checklist that makes ephemeral attachment storage an explicit no-go.

Code change required: **Possibly**. Durable mounted storage can be operational, but adding startup checks/warnings and backup verification would reduce operator error.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Temporarily yes**, if production deployment uses persistent storage and an audited off-host backup process before launch.

### CRR-003

Severity: **HIGH**

Category: Rate limiting and abuse protection

Affected file/component: `backend/src/server.js`, public auth routes, webhook routes, upload routes, backup preview/restore/export.

Evidence: Searches found no rate-limit, throttle, lockout, or attempt-control implementation. Public `POST /api/auth/login` and `POST /api/auth/register` exist. Authenticated but expensive routes include multipart uploads, backup preview/restore, email send, and broad mutation surfaces.

Commercial risk: Password guessing, tenant-registration spam, disk exhaustion, backup CPU/memory pressure, and email-provider abuse are possible without application or edge limits.

Recommended correction: Add simple bounded rate controls before release. At minimum protect login, registration, webhooks, uploads, backup preview/restore/export, and email sends. Prefer a small in-app limiter plus documented reverse-proxy limits for initial deployment.

Code change required: **Yes**.

Migration required: **No**, unless durable per-account throttling is implemented.

Documentation/operations mitigation sufficient: **Only partially**. Edge limits help, but login and tenant-registration abuse should be enforced close to the app as well.

### CRR-004

Severity: **HIGH**

Category: Account recovery and support readiness

Affected file/component: auth/user management in `backend/src/services.js`, login UI in `src/App.jsx`, support documentation.

Evidence: The code supports registration, login, adding users, activating/deactivating users, and session revocation. Searches found no password reset, forgot-password, recovery token, owner recovery, or operator recovery workflow.

Commercial risk: A paying shop owner who forgets the only active owner password requires direct developer/database intervention. That is not a scalable or safe commercial support model.

Recommended correction: Add a bounded password reset/recovery flow or a documented operator-admin recovery command with audit logging. Preserve the existing identity model; do not add SSO/MFA in this release unless separately authorized.

Code change required: **Yes** for a self-service reset. A guarded operator command plus runbook may mitigate controlled pilot use.

Migration required: **Possibly**, if reset tokens are stored.

Documentation/operations mitigation sufficient: **No** for broad paying-customer launch; **partial** for a small controlled pilot.

### CRR-005

Severity: **HIGH**

Category: Public registration control

Affected file/component: `POST /api/auth/register` in `backend/src/server.js`, `SlimService.registerTenant` in `backend/src/services.js`, `src/App.jsx`.

Evidence: Registration is public and creates a tenant, owner user, and active intake address. Input validation protects slug/email/password shape and tenant uniqueness, and Group F adds origin/fetch-metadata protections before cookie issuance. There is no invite code, allowlist, email verification, payment gate, admin approval, or rate limiting.

Commercial risk: A publicly reachable hosted app can accumulate junk tenants, consume storage, increase support exposure, and create abuse paths before the shop has paid or been vetted.

Recommended correction: For initial controlled commercial use, add an operator-controlled registration mode: invite codes, disabled self-registration by default, or an allowlisted signup workflow. Pair with rate limiting.

Code change required: **Yes**, unless deployment places registration behind an external controlled front door.

Migration required: **Possibly**, if invite records are persisted.

Documentation/operations mitigation sufficient: **Partial** only for a non-public pilot URL.

### CRR-006

Severity: **HIGH**

Category: Authorization scope

Affected file/component: `backend/src/domains/shared.js`, `backend/src/server.js`, `backend/src/domains/customers/service.js`, `backend/src/domains/quotes/service.js`, `backend/src/domains/orders/service.js`, `backend/src/domains/communications/service.js`, `docs/SLIM_NAVIGATION_MAP.md`.

Evidence: `WRITE_ROLES` includes `owner`, `admin`, `manager`, and `staff`. Customer, Quote, Order, Incoming Request, Production, Calendar, customer email, and manual communication routes generally use `WRITE_ROLES`. The navigation map confirms broad visibility for several commercial areas. Financial stripping exists for production/order summaries, and payment mutations are manager-gated, but the generic staff role remains broad.

Commercial risk: A shop may expect staff to clock in, view assigned production, or use the Employee Portal without being able to edit commercial records or email customers. Current backend authorization permits more than many outside shops would consider commercially safe.

Recommended correction: Define a commercial role/capability matrix and tighten backend permissions. A likely first pass is: owner/admin for settings/users/backup; owner/admin/manager for commercial document/payment/customer-email mutations; staff for assigned production/portal operations; pay capability for payroll. Keep frontend navigation aligned, but enforce backend first.

Code change required: **Yes**.

Migration required: **No**, unless adding granular persisted capabilities.

Documentation/operations mitigation sufficient: **Partial**. Shops can assign trusted users only, but that limits practical employee use.

### CRR-007

Severity: **HIGH**

Category: Production configuration and startup validation

Affected file/component: `.env.example`, `backend/src/server.js`, `README.md`, `docs/GROUP_F_AUTH_TRANSPORT_AUDIT.md`, `docs/V2_STAGE1_2_REUSE_MAP.md`.

Evidence: `.env.example` lists only `SIGNGUY_SLIM_DB_PATH`, `SIGNGUY_SLIM_ATTACHMENT_ROOT`, `SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES`, and `PORT`. Runtime code also uses `NODE_ENV`, `SIGNGUY_SLIM_COOKIE_SECURE`, `SIGNGUY_SLIM_TRUST_PROXY`, `SIGNGUY_SLIM_ALLOWED_ORIGINS`, `SIGNGUY_SLIM_SENDGRID_API_KEY`, `SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET`, `SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET`, `SIGNGUY_SLIM_INTAKE_DOMAIN`, and `SIGNGUY_SLIM_COMMIT_SHA`/`GITHUB_SHA`. The server starts with defaults and does not fail fast for unsafe production omissions.

Commercial risk: A hosted deployment can silently start without secure-cookie intent, webhook secrets, origin allowlists, SendGrid config, durable paths, or release metadata. Misconfiguration becomes a runtime customer failure rather than a deployment failure.

Recommended correction: Add a production configuration checklist and a small startup validation layer. Fail fast or loudly warn when `NODE_ENV=production` lacks HTTPS/secure-cookie posture, durable DB/attachment paths, required webhook secrets, allowed origins for split hosting, SendGrid configuration if customer email is enabled, and release SHA metadata.

Code change required: **Yes** for fail-fast validation; documentation alone should not be the only guard.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Partial** for controlled internal deployments; not enough for repeatable commercial hosting.

### CRR-008

Severity: **HIGH**

Category: Upload/storage abuse

Affected file/component: `backend/src/server.js`, `backend/src/domains/shared.js`, `backend/src/domains/attachments/service.js`, `backend/src/domains/communications/service.js`.

Evidence: Individual upload and inbound attachment sizes are capped by `SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES` with a 10 MB default. MIME, extension, and content validation are strong. No per-tenant storage quota, per-order count limit, daily upload budget, or disk-space guard was found.

Commercial risk: A single tenant or compromised account can fill disk over time through repeated uploads, annotations, backup operations, or intake attachments. On a small hosted instance this can take the app down for all tenants.

Recommended correction: Add storage limits: tenant-level quota, per-file limit, optional per-order attachment count, and operator-visible storage usage. Add monitoring/alerts for DB and attachment volume.

Code change required: **Yes** for app-enforced quota.

Migration required: **Possibly**, if quota settings or usage snapshots are stored.

Documentation/operations mitigation sufficient: **Partial**, if reverse-proxy limits and disk monitoring are in place.

### CRR-009

Severity: **MEDIUM**

Category: SQLite production concurrency and durability tuning

Affected file/component: `backend/src/db.js`, deployment documentation.

Evidence: SQLite is opened through `node:sqlite` with `PRAGMA foreign_keys = ON`. No WAL mode, busy timeout, synchronous setting, single-process deployment note, or write-concurrency guidance was found in code.

Commercial risk: For a small sign shop, SQLite can be acceptable. For a hosted multi-tenant deployment, lack of documented single-process constraints and lock-handling increases risk of transient write failures or operational confusion under concurrent use.

Recommended correction: Document the supported initial topology as one backend process using a persistent local SQLite database. Consider enabling WAL and a busy timeout, and include a restore-from-backup drill.

Code change required: **Recommended**, but not mandatory if initial usage is very small and operational constraints are explicit.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes**, for a controlled small-shop release.

### CRR-010

Severity: **MEDIUM**

Category: Email deliverability and retry operations

Affected file/component: `backend/src/domains/communications/service.js`, Settings email UI, SendGrid deployment docs.

Evidence: SendGrid sends are idempotent by key, provider failures are recorded honestly as failed, delivery events are stored idempotently, and production webhook secrets are required when `NODE_ENV=production`. There is no retry queue, bounce-management workflow, verified-domain checklist in `.env.example`, or operator send-failure dashboard beyond communication history/status.

Commercial risk: Email delivery failures may require manual operator intervention and may be missed by shop users unless they inspect history.

Recommended correction: Add a production email checklist and a small operator workflow for failed/deferred/bounced sends. A retry queue can be deferred if manual resend is clearly documented.

Code change required: **Not immediately**, unless automatic retry is required for launch.

Migration required: **No** for documentation/manual workflow; **possibly** for queued retries.

Documentation/operations mitigation sufficient: **Yes**, for initial controlled release.

### CRR-011

Severity: **MEDIUM**

Category: Operational monitoring and error diagnostics

Affected file/component: `backend/src/server.js`, logging/deployment documentation.

Evidence: API errors return stable JSON and avoid leaking stack traces. The catch block does not log unexpected server errors, attach request IDs, or expose an operator-visible error correlation path. No health/readiness endpoint was found.

Commercial risk: When a customer reports a failure, the operator may not be able to distinguish validation errors, DB failures, provider failures, and unexpected exceptions quickly.

Recommended correction: Add minimal structured request/error logging with redaction, request IDs, startup config summary, and a safe health/readiness endpoint that checks API and DB reachability without exposing sensitive details.

Code change required: **Yes**.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Partial** only for very small pilot use.

### CRR-012

Severity: **MEDIUM**

Category: CI/release gate adequacy

Affected file/component: `.github/workflows/ci.yml`, package scripts, release process documentation.

Evidence: CI runs clean install, migrations, tests, lint, guard, and build on PRs and pushes to main. `npm audit` is not part of CI. There is no explicit production smoke, health smoke, or packaged deployment smoke in CI.

Commercial risk: Dependency vulnerabilities and deployment-only failures can slip through a green PR CI.

Recommended correction: Add a release workflow or CI job for `npm audit`, production-start smoke, health/readiness smoke after implementation, and at least one backup export/preview/restore smoke if not already covered by the regular test suite.

Code change required: **Yes**, for CI/workflow additions.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Partial**, if the operator runs the checklist manually before each release.

### CRR-013

Severity: **MEDIUM**

Category: Customer-facing document polish

Affected file/component: `backend/src/services.js`, `backend/src/pdf.js`, Quote/Invoice PDF generation.

Evidence: PDF rendering is generated from plain text lines in `documentPdf`. Terminology is customer-facing and avoids internal "Estimate" filenames for quote PDFs, but output is intentionally minimal and not a branded commercial document template.

Commercial risk: Quotes and invoices are functionally correct enough for pilot use, but may look unfinished or lack fields that outside shops expect on customer-facing paperwork.

Recommended correction: Define the minimum commercial Quote/Invoice document template: logo, company legal/contact info, customer info, line items, taxable/tax totals, terms, status, and consistent filenames. Keep accounting complexity out of scope.

Code change required: **Likely yes** for polished PDFs.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes**, if the first release positions PDFs as simple generated documents.

### CRR-014

Severity: **MEDIUM**

Category: Legal/business launch operations

Affected file/component: README/deployment documentation, public registration and hosted operations.

Evidence: The repository documents product scope and payroll limitations, but no launch checklist was found for privacy policy, terms of service, data retention, deletion/export process, hosted backup responsibility, or customer support expectations.

Commercial risk: Outside shops will store customer names, email addresses, addresses, artwork, invoices, time entries, and pay-tracking data. Commercial hosting needs business-facing terms and operational promises even when code security is sound.

Recommended correction: Create a launch operations checklist covering privacy, terms, retention, export/delete process, support SLA, account recovery, backup responsibility, and incident response.

Code change required: **No**, except links/settings if terms are surfaced in-product.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes**.

### CRR-015

Severity: **MEDIUM**

Category: Support and recovery tooling

Affected file/component: Settings/users UI, backend user/session functions, operator documentation.

Evidence: Owner/admin users can add/update users and deactivate users; deactivation revokes sessions. There is no operator support tool for safe owner recovery, tenant unlock, email troubleshooting, or tenant restore orchestration beyond the in-app backup/restore screen.

Commercial risk: Early customers will need help with account lockouts, email misconfiguration, restore attempts, and user deactivation. Direct DB surgery is too risky as the normal support path.

Recommended correction: Add a small documented operator support runbook and, where useful, CLI/admin-only commands for owner recovery and diagnostic summaries. Log all support mutations.

Code change required: **Possibly**.

Migration required: **No**, unless new support audit records are added.

Documentation/operations mitigation sufficient: **Partial**.

### CRR-016

Severity: **MEDIUM**

Category: Empty/error state and release usability verification

Affected file/component: major React feature modules under `src/features/`, browser release checklist.

Evidence: The test suite covers many route and UI behaviors, but this audit did not find a maintained commercial smoke-test script or browser matrix for desktop, tablet, and mobile Employee Portal. Some pages use basic empty states and inline errors; release-critical deep-link/refresh and device-specific checks are not automated.

Commercial risk: Shop users may hit confusing states on real devices even when backend correctness is strong.

Recommended correction: Run and document a manual release smoke test on target devices before first commercial pilot. Add Playwright/browser smoke coverage later for login, order workspace, production, attachments, Employee Portal, backup, and logout.

Code change required: **Not initially**, unless smoke testing exposes defects.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes** for controlled release.

### CRR-017

Severity: **LOW**

Category: Documentation staleness

Affected file/component: `README.md`, `docs/SLIM_HARDENING_REMEDIATION_PLAN.md`, `docs/SLIM_NAVIGATION_MAP.md`, `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`.

Evidence: Some documents still use branch-era wording such as "current feature branch" for work now merged into `main`, and the remediation plan describes Group F as implemented on its branch rather than fully merged.

Commercial risk: Low direct runtime risk, but stale status text can mislead future audits and release planning.

Recommended correction: Refresh status language after this audit, keeping Stage 9 deferred.

Code change required: **No product code**.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes**.

### CRR-018

Severity: **LOW**

Category: Release metadata discoverability

Affected file/component: `package.json`, `backend/src/backup.js`, backend API.

Evidence: `package.json` has version `0.2.0-v2-stage8`; backups include `SIGNGUY_SLIM_COMMIT_SHA` or `GITHUB_SHA` when configured. No authenticated release/version endpoint or startup-visible build identifier was found.

Commercial risk: Support cannot easily confirm what code a customer deployment is running.

Recommended correction: Add a safe authenticated version endpoint or include release SHA in startup logs/admin settings, backed by deployment configuration.

Code change required: **Yes**, small.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Partial**.

### CRR-019

Severity: **LOW**

Category: Email HTML sanitization future-proofing

Affected file/component: `backend/src/domains/shared.js`, `backend/src/domains/communications/service.js`, Incoming Requests UI.

Evidence: Inbound HTML is stored as both original and `sanitized_html`. Current frontend rendering found no `dangerouslySetInnerHTML`; React escaping and iframe sandboxing are preserved. The sanitizer is simple string filtering and should not be treated as sufficient for future raw HTML rendering.

Commercial risk: No current release blocker because the sanitized HTML is not rendered raw. Risk rises if future UX displays incoming email HTML.

Recommended correction: Keep rendering email as escaped text unless a robust sanitizer is introduced and tested.

Code change required: **No**, unless raw HTML rendering is added later.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes**.

### CRR-020

Severity: **LOW**

Category: Browser/device support statement

Affected file/component: README/release docs, camera/annotation UX.

Evidence: Camera capture, upload, downloads, cookie auth, and Employee Portal views rely on modern browser behavior. The repo documents physical-camera testing as environment dependent in prior stage docs, but no commercial browser/device support statement was found.

Commercial risk: Low to medium support friction if a shop uses unsupported mobile browsers, blocked camera permissions, or non-secure contexts.

Recommended correction: Document supported browsers and the secure-context requirement for camera testing. Keep real-device camera smoke as deployment validation, not a repository merge blocker.

Code change required: **No**.

Migration required: **No**.

Documentation/operations mitigation sufficient: **Yes**.

## Accepted / Deferred Items

### CRR-A01: Stage 9 Facebook/Meta Deferred

Severity: **ACCEPTED / DEFERRED**

Category: Product scope

Evidence: Searches found no Facebook/Meta implementation, OAuth, webhook, dependency, navigation, or placeholder UI in the active source. Mentions are documentation-only deferrals.

Release decision: Keep deferred. Do not start Stage 9 until Meta business app/Page setup, webhook routing, permissions, and app review requirements are available.

### CRR-A02: Payroll Is Internal Pay Tracking

Severity: **ACCEPTED / DEFERRED**

Category: Product/accounting scope

Evidence: README and Group D docs describe Time and Pay as internal tracking only, not tax withholding, payroll filing, direct deposit, or external payroll processing.

Release decision: Accept for initial Slim scope, but product copy must remain explicit.

### CRR-A03: SQLite Is Acceptable Under Initial Constraints

Severity: **ACCEPTED / DEFERRED**

Category: Database topology

Evidence: Current implementation uses local SQLite with transactional migrations and tenant-scoped tables. This is reasonable for small single-process deployments if persistence and backup controls are fixed.

Release decision: Accept for controlled small-shop release only with documented single-process constraints, backup/restore, and monitoring. Revisit if hosting many active shops or multiple API processes.

### CRR-A04: No SSO/MFA/Social Login

Severity: **ACCEPTED / DEFERRED**

Category: Identity scope

Evidence: Group F explicitly preserved the current identity model and hardened transport without adding new identity providers.

Release decision: Accept for initial controlled release. Reassess MFA for broader commercial exposure.

### CRR-A05: Portable Backup Excludes Runtime Sessions

Severity: **ACCEPTED / DEFERRED**

Category: Backup contract

Evidence: Backup validation rejects password hashes and excludes sessions/auth cookies/CSRF/runtime secrets from portable tenant backup data.

Release decision: Correct by design. Do not make live auth sessions portable business data.

## Readiness by Area

### Authentication and Session

Status: **Ready after Group F, subject to rate limiting and production configuration fixes.**

Evidence reviewed:

- Auth session tokens are generated with `crypto.randomBytes(32)`, hashed with SHA-256, stored in `sessions.token_hash`, and never returned in frontend JSON.
- Browser authentication uses HttpOnly cookies: local HTTP uses `signguy_slim_session`; secure contexts use `__Host-signguy_slim_session`.
- Cookie attributes include `HttpOnly`, `Path=/`, `SameSite=Lax`, expiry, max-age, and `Secure` when production/HTTPS/explicit secure mode applies.
- `X-Forwarded-Proto` affects secure-cookie detection only when `SIGNGUY_SLIM_TRUST_PROXY=1`.
- `/api/auth/me` authenticates through cookies and returns user, tenant, server-calculated capabilities, and `csrf_token`.
- Unsafe authenticated methods require `X-CSRF-Token`; unauthenticated unsafe calls remain `401`; bad CSRF returns `403 csrf_invalid`.
- Login/register/logout include Origin/Fetch Metadata protections.
- Frontend API calls use `credentials: "include"` and no default app-auth `Authorization: Bearer` header.

Remaining release risks: CRR-003, CRR-004, CRR-005, CRR-007.

### Authorization Matrix

This matrix reflects current backend posture, not desired commercial posture.

| Area | Owner | Admin | Manager | Staff | Pay-enabled staff | Employee Portal |
| --- | --- | --- | --- | --- | --- | --- |
| Customers | view/write | view/write | view/write | view/write | same as staff | no direct portal route |
| Quotes | view/write/send | view/write/send | view/write/send | view/write/send | same as staff | no direct portal route |
| Orders | view/write/email/attachments | view/write/email/attachments | view/write/email/attachments | view/write/email/attachments | same as staff | no direct portal route |
| Incoming Requests | view/write/convert/link | view/write/convert/link | view/write/convert/link | view/write/convert/link | same as staff | no direct portal route |
| Production | view/write transitions | view/write transitions | view/write transitions | view/write transitions with financial stripping | same as staff | no direct portal route |
| Calendar | view/write | view/write | view/write | view/write | same as staff | no direct portal route |
| Employees | manage | manage | list/review time only | no management | no extra employee admin | linked active employee only |
| Time | review/manage | review/manage | review/manage | portal own clock only if eligible | portal own clock only if eligible | clock in/out, own time |
| Payroll | manage | pay summary access via manager role is blocked unless pay capability? pay domain uses pay capability where implemented | requires pay capability for pay-management surfaces | blocked unless pay-enabled employee capability | can access pay-management where explicitly enabled | own pay only |
| Announcements | manage | manage | read/list as applicable | read/list as applicable | same as staff | targeted read/unread |
| Employee Messages | portal/direct participant behavior | portal/direct participant behavior | portal/direct participant behavior | portal/direct participant behavior | same as staff | one-to-one messages if eligible |
| Invoices | view/create/status/send | view/create/status/send | view/create/status/send/payment | view/create/status/send, no payment | same as staff unless pay route | no direct portal route |
| Payments | manage | manage | manage | blocked | blocked unless role also manager | no direct portal route |
| Settings | manage | manage | view only | view only | view only | no direct portal route |
| Backup/Restore | manage | manage | blocked | blocked | blocked | blocked |

Commercial concern: Staff access is broad for commercial records. See CRR-006.

### Tenant Isolation

Status: **Ready based on inspected code and current tests.**

Evidence: Server obtains an actor from the authenticated session, and domain methods consistently scope primary reads/writes by `actor.tenant_id`. Secondary relationships such as customer/order/invoice/email links, Work Order item links, attachments, calendar assignees/resources, employees, payroll, announcements, messages, and restore validation are tenant-checked. Backup restore validates source tenant relationships and restores into an empty target tenant with ID remapping.

No concrete cross-tenant access defect was found during this audit.

### Registration and Tenant Creation

Status: **Functionally correct but not commercially ready for public exposure.**

Tenant isolation, owner creation, default role, duplicate slug/email handling, password hashing, default intake address creation, and session establishment are implemented. Open self-registration remains a commercial control gap without rate limiting/invites/verification. See CRR-005.

### Password Security

Status: **Adequate baseline, missing abuse/recovery controls.**

Passwords are hashed with bcrypt cost 12 via `bcryptjs`, inputs require 8-128 characters, login uses a generic invalid-shop/email/password response, and inactive users cannot authenticate. No plaintext password storage/logging was found in tracked source. Missing controls: rate limiting and password reset/recovery.

### Secrets and Configuration

Status: **No committed secrets found; production config checklist incomplete.**

Repository search found no hard-coded API keys, private keys, or real credentials outside test fixtures and docs. `.env` files and runtime data are ignored. `.env.example` is incomplete for production. See CRR-007.

### Database and Migration Safety

Status: **Application migrations are disciplined; production operations need hardening.**

Migrations are ordered `001` through `014`; `runMigrations` tracks applied IDs and wraps each migration in `BEGIN IMMEDIATE`/`COMMIT` with rollback on failure. Group C migration `014` includes conflict detection and additive production-state triggers. Production DB backup, SQLite tuning, and deployment constraints need work.

### Backup and Recovery

Status: **Portable backup is strong; hosted infrastructure recovery is not ready.**

Portable backup uses AES-256-GCM, PBKDF2-HMAC-SHA256, checksums, schema validation, empty-target restore, relationship validation, attachment byte validation, and secret exclusion. It is not a substitute for automated hosted database and attachment backups. See CRR-001 and CRR-002.

### Attachments, Image, and Camera Privacy

Status: **Security model is good; durability and quota are not ready.**

Attachment routes require authenticated tenant-scoped access; previews/downloads stream through the server with no-store/private cache headers, `nosniff`, safe filenames, path containment, symlink checks, checksums, and MIME/content validation. Original images and annotation derivatives are stored separately and privately. Remaining risks are persistence and quota.

### Production State Integrity

Status: **Ready.**

Group C remains intact: Work Orders are authoritative after release, Order Item production fields are compatibility snapshots, active Work Order membership is constrained, cancelled/historical Work Orders do not drive current status, reopen updates derived status, Calendar status remains independent, and order business status is not equated with production completion.

### Financial Integrity

Status: **Ready for simple manual invoices/payments; tax/accounting scope is limited.**

Money is represented as integer cents. Quantities support up to 4 decimal places and line totals use BigInt rounding. Document totals validate discounts/tax basis points. Payment status rejects overpayment through `paymentStatus`. Invoices are manual records, not payment processing. Production staff financial stripping is present for production/order summaries. Broad staff access to commercial docs remains an authorization policy issue, not a math issue.

### Tax Behavior

Status: **Ready with limitation.**

Slim supports a tenant sales-tax rate in basis points and customer tax-exempt snapshots. It does not implement jurisdictional tax calculation, filings, exemptions beyond stored flags/notes, or accounting integrations. This should be documented clearly for commercial users.

### Communications and Incoming Requests

Status: **Core safety ready; operations and abuse controls pending.**

SendGrid API key is server-only, customer email send is idempotent, provider failures are recorded as failures, webhook events are signed in production, intake webhook signatures are required in production, duplicate intake messages are detected, and attachments go through validation. Operational gaps: no retry queue, incomplete production email config checklist, no public rate limiting, and no registration/inbound abuse controls.

### XSS, SQL Injection, Path Traversal, Command Injection

Status: **No release blocker found.**

No active `dangerouslySetInnerHTML` usage was found. React escapes user strings. Attachment previews are either images or sandboxed iframes. Dynamic SQL inspected in domain modules uses controlled field names from zod-parsed objects or constant table/column inventories, with user values parameterized. Attachment paths are server-generated and guarded by path containment, symlink checks, safe filenames, and checksums. No `child_process` execution path was found.

### Dependency Security

Status: **Ready at audit time.**

`npm audit --json` and `npm audit --omit=dev --json` reported 0 vulnerabilities.

### CI Adequacy

Status: **Strong development CI, missing release gates.**

GitHub CI performs clean install, migration check, tests, lint, guard, and build on PRs and pushes to main. Add dependency audit and production smoke checks before commercial launch.

### Deployment Topology

Recommended initial topology:

- Same-origin frontend and backend behind HTTPS.
- One backend process per SQLite database.
- Persistent disk/volume for `SIGNGUY_SLIM_DB_PATH`.
- Persistent disk/volume or object-backed mount for `SIGNGUY_SLIM_ATTACHMENT_ROOT`.
- Scheduled off-host backup for both DB and attachments.
- Reverse proxy only if `SIGNGUY_SLIM_TRUST_PROXY=1` is configured deliberately for a known TLS-terminating proxy.
- Explicit allowed origins if frontend/backend split origins are used.
- SendGrid configured with a verified sender/domain before enabling customer email.

Required production configuration checklist:

- `NODE_ENV=production`
- `PORT`
- `SIGNGUY_SLIM_DB_PATH`
- `SIGNGUY_SLIM_ATTACHMENT_ROOT`
- `SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES`
- `SIGNGUY_SLIM_COOKIE_SECURE=1` when secure detection is not otherwise reliable
- `SIGNGUY_SLIM_TRUST_PROXY=1` only behind a trusted HTTPS-terminating proxy
- `SIGNGUY_SLIM_ALLOWED_ORIGINS` for split-origin hosting
- `SIGNGUY_SLIM_SENDGRID_API_KEY` if customer email is enabled
- `SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET` in production when SendGrid events are enabled
- `SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET` in production when incoming email intake is enabled
- `SIGNGUY_SLIM_INTAKE_DOMAIN`
- `SIGNGUY_SLIM_COMMIT_SHA` or `GITHUB_SHA`
- External backup destination/credentials managed outside the app

## Manual Commercial Smoke Test

Run this on the production-like deployment before accepting outside shops:

1. Register or invite a tenant owner.
2. Log in, refresh the browser, and confirm session restore.
3. Create a customer.
4. Create a Quote with taxable and non-taxable line items.
5. Send/download the Quote PDF.
6. Convert the Quote to an Order.
7. Edit Order Workspace items and totals.
8. Send required items to Production.
9. Move a Work Order through ready, in progress, waiting, complete, and reopen.
10. Create and complete/reopen a Calendar event without changing production state.
11. Upload an image/file attachment.
12. Create an annotated copy and verify the original is still separately accessible.
13. Generate an Invoice.
14. Record partial and full manual payments; verify overpayment is rejected.
15. Create an Employee linked to a user.
16. Use Employee Portal Time Clock.
17. Review Time and close/reopen a pay week.
18. Publish an Announcement and verify read/unread behavior.
19. Send and read an Employee direct message.
20. Send a customer email with provider configured; verify delivery/failure history.
21. Receive an Incoming Request through the signed webhook path.
22. Export an encrypted backup.
23. Preview and restore into an empty tenant.
24. Log out; verify old session cannot access APIs.
25. Test a deep link/refresh for Orders, Order Workspace, Incoming Requests, Calendar, Employee Portal, and Settings/Backup.

## Remediation Plan

### Release A: Data Durability and Production Topology

Priority: highest.

Fixes: CRR-001, CRR-002, CRR-007, CRR-009, CRR-018.

Likely files: `backend/src/db.js`, `backend/src/server.js`, `.env.example`, `README.md`, deployment docs, possibly package scripts.

Migration need: none expected.

Tests: startup config tests, health/version tests if added, migration/backup smoke.

Release risk: low to medium. Most changes are operational/documentation, but startup validation can break misconfigured deployments by design.

### Release B: Abuse Controls and Account Recovery

Priority: high.

Fixes: CRR-003, CRR-004, CRR-005, CRR-008.

Likely files: `backend/src/server.js`, auth service code, user management UI, tests, possibly new support docs.

Migration need: possible for password-reset tokens, invite codes, or quota settings.

Tests: login/register rate-limit tests, reset/recovery tests, registration-control tests, quota tests, CSRF/session regression.

Release risk: medium. Touches auth and public signup surfaces.

### Release C: Commercial Authorization Policy

Priority: high.

Fixes: CRR-006 plus any role-matrix updates.

Likely files: `backend/src/domains/shared.js`, domain service permission checks, `src/navigation.js`, feature pages, tests, docs.

Migration need: none unless granular capabilities become persisted.

Tests: backend permission matrix tests for each major domain, frontend nav visibility tests, financial redaction tests.

Release risk: medium. Must avoid breaking existing shop workflows while narrowing staff permissions.

### Release D: Operations, Monitoring, and Support

Priority: medium.

Fixes: CRR-010, CRR-011, CRR-012, CRR-014, CRR-015, CRR-016, CRR-017, CRR-020.

Likely files: CI workflow, docs, `backend/src/server.js`, support scripts, frontend smoke tests.

Migration need: unlikely.

Tests: CI additions, smoke checks, logging redaction tests.

Release risk: low to medium.

### Release E: Document Polish

Priority: medium after durability/auth policy.

Fixes: CRR-013.

Likely files: `backend/src/pdf.js`, `backend/src/services.js` or document module, quote/invoice tests, README.

Migration need: none.

Tests: PDF content snapshot/semantic tests.

Release risk: low.

## Explicit Release Recommendation

Do **not** accept paying outside sign shops yet.

Proceed only with a controlled pilot if:

- the deployment uses persistent storage for DB and attachments;
- off-host backups and restore drills are already operating;
- registration is not publicly exposed or is externally controlled;
- trusted users are assigned broad `staff` permissions knowingly;
- the operator accepts manual account recovery and manual SendGrid failure handling.

Stage 9 should remain deferred until after the commercial readiness blockers and high-priority launch controls are resolved.
