# Commercial Release B - Account and Abuse Controls

Commercial Release B addresses the commercial-readiness findings that remained
after Release A:

- CRR-003: no bounded abuse controls on public or expensive endpoints.
- CRR-004: no self-service password recovery.
- CRR-005: public registration is not controlled for hosted release.
- CRR-008: tenant storage consumption is not capped before uploads/restores.

This document is the implementation map for Release B. It is intentionally
bounded to account, abuse, and quota controls. Release C role narrowing, Release
D support/legal/monitoring work, Release E quote/invoice polish, and Stage 9
Facebook/Meta intake remain out of scope.

## Current Behavior

### Authentication

Slim currently uses the Group F hardened authentication transport:

- Browser sessions are carried by an HttpOnly cookie.
- Authenticated unsafe requests require a per-session CSRF token.
- `/api/auth/me` refreshes the authenticated user, tenant, capabilities, and
  CSRF token.
- Logout revokes the server-side session and clears the cookie.
- Authorization and tenant scoping remain backend-owned.

Release B preserves that identity and authorization model.

### Registration

`POST /api/auth/register` currently creates a tenant and an owner account from
the public registration payload. The endpoint is protected by the same
cross-site request checks that protect login, but it is not gated by a hosted
commercial onboarding policy. A public visitor can create a tenant if they know
the endpoint and provide valid registration fields.

### Password Recovery

The app currently has login/logout/session restore, but no password-reset flow.
If an owner or staff user forgets a password, there is no bounded in-product or
operator-assisted recovery path. The current password hashing and session
revocation behavior are otherwise preserved.

### Rate Limiting

Public and expensive endpoints currently rely on normal validation, auth,
permissions, body-size limits, provider signatures, and CSRF. There is no shared
attempt budget for repeated login failures, registration attempts, reset
requests, outbound email sends, uploads, or backup import/restore operations.

### Storage Quota

Release A introduced fail-fast durable storage configuration and server backup
durability, but tenant data growth is not capped. Attachment uploads, incoming
request attachments, annotation derivatives, and portable restore operations can
continue consuming durable storage as long as the underlying filesystem allows.

## Target Behavior

### Rate-Limit Model

Release B adds a shared backend rate-limit helper backed by SQLite. The helper:

- Stores bounded window counters in a dedicated table.
- Hashes limit keys so raw IP addresses, emails, tokens, and tenant identifiers
  are not stored in plain text.
- Enforces fixed-window budgets with a server-calculated retry time.
- Deletes expired buckets opportunistically.
- Returns HTTP `429` with `rate_limit_exceeded` for exhausted budgets.

Rate limiting is defense in depth. It does not replace password verification,
CSRF, signed webhook verification, tenant authorization, or upload size limits.

Initial budgets are conservative defaults and may be tuned through environment
variables without schema changes. The default scopes cover:

- login attempts by IP and by submitted account identity;
- registration attempts by IP;
- password reset request attempts by IP and email;
- password reset completion attempts by IP and reset token;
- outbound customer email sends by tenant/user;
- authenticated upload attempts by tenant/user;
- backup preview, restore, and server backup creation by tenant/user.

Signed SendGrid and intake webhooks keep their signature/idempotency controls as
primary protection. Release B does not replace provider authentication with
naive request counting.

### Registration Control

Hosted production registration is controlled by configuration:

- `SIGNGUY_SLIM_PUBLIC_REGISTRATION_ENABLED=1` allows open public registration.
- In production, absence of this setting disables open public registration.
- Local development defaults remain friendly for tests and single-machine
  development.

When public registration is disabled, tenant creation requires a valid
single-use signup invitation. Invitations:

- contain a random high-entropy token;
- store only the token hash in the database;
- may optionally be bound to an owner email address;
- expire;
- are consumed atomically when registration succeeds;
- cannot be reused after use, expiration, or revocation;
- are audited.

Owner/admin users can create onboarding invitations for controlled pilots. The
returned invitation token is shown only once. If provider email is configured,
the invitation may be emailed by the operator workflow; otherwise the operator
can copy the invitation URL.

### Password Recovery

Release B adds a password reset flow:

- public reset request accepts an email address and always returns a generic
  response;
- active matching users receive reset links when SendGrid is configured;
- reset tokens are random, single-use, hashed at rest, and expire;
- completing a reset updates the password, consumes the token, and revokes
  existing sessions for that user;
- token replay, expired token use, inactive user reset, and cross-tenant misuse
  are rejected;
- reset completion is rate-limited by IP and token;
- reset request and completion are audited without logging plaintext tokens,
  cookies, passwords, or CSRF values.

An owner/admin operator endpoint can generate a one-time reset link for a user in
the same tenant when email delivery is unavailable. This is a bounded support
path, not a full identity-provider redesign.

### Tenant Storage Quota

Release B adds a tenant quota contract:

- each tenant has an effective byte limit from `tenants.storage_quota_bytes` or
  `SIGNGUY_SLIM_DEFAULT_TENANT_STORAGE_QUOTA_BYTES`;
- tenant storage usage is derived from persisted private attachment rows and
  incoming-request attachment rows;
- normal upload, camera capture, annotation derivative, incoming-request
  attachment persistence, and portable restore flows check quota before
  committing new durable bytes;
- over-quota requests fail with `storage_quota_exceeded` and do not leave
  orphaned durable files;
- owner/admin settings can view current usage and, where authorized, adjust the
  tenant quota;
- staff and Employee Portal users cannot increase quota.

Quota controls do not replace Release A server backup and filesystem durability.
They limit tenant growth so a hosted deployment is not trivially exhausted by one
shop or one compromised account.

### Frontend Behavior

The frontend:

- bootstraps registration policy before showing public registration;
- hides open signup when registration is invite-only;
- supports invite-token registration links;
- supports forgot-password and reset-password screens;
- displays rate-limit and quota errors without clearing valid sessions;
- sends authenticated mutation requests through the existing cookie/CSRF API
  helper;
- shows owner/admin tenant storage usage and quota in Settings.

No browser-readable auth secret, bearer-token fallback, or Stage 9 UI is added.

## Data Model

Release B uses additive migration `015_commercial_release_b_account_abuse_controls.sql`.

Expected schema additions:

- `tenants.storage_quota_bytes`
- `rate_limit_buckets`
- `signup_invitations`
- `password_reset_tokens`

Existing session, user, tenant, customer, order, production, employee, backup,
and portability schemas remain authoritative. Active runtime sessions, CSRF
tokens, reset tokens, and invitation tokens are not customer portable backup
business data.

`storage_quota_bytes` is also hosted runtime policy rather than customer-owned
portable business data. Portable exports omit it, and restore preserves the
destination tenant's current quota policy while importing customer records and
attachments through the normal quota checks.

## Operational Configuration

Release B introduces these production configuration items:

- `SIGNGUY_SLIM_PUBLIC_REGISTRATION_ENABLED`
- `SIGNGUY_SLIM_DEFAULT_TENANT_STORAGE_QUOTA_BYTES`
- rate-limit budget/window environment overrides
- `SIGNGUY_SLIM_APP_URL` or equivalent public app URL for generated invitation
  and password-reset links

Existing SendGrid configuration remains required for email delivery. Missing
SendGrid configuration must not expose account existence. Operators can still
use the bounded same-tenant reset-link endpoint where appropriate.

See `docs/ACCOUNT_RECOVERY_AND_ONBOARDING.md` for the operator runbook.

## Acceptance Checklist

- Public registration disabled by default in production unless explicitly
  enabled.
- Invitation-only registration creates a tenant owner and consumes the invite
  exactly once.
- Password reset request does not enumerate accounts.
- Password reset completion rotates the password, revokes sessions, and rejects
  token replay.
- Login/register/reset/upload/email/backup limits return 429 when exhausted.
- Upload and restore quota failures leave no committed durable files or database
  rows.
- Owner/admin can inspect storage usage and quota.
- Staff cannot increase tenant quota.
- Portable backups exclude runtime sessions, reset tokens, invite tokens, and
  rate-limit buckets.
- Existing Group F cookie/CSRF behavior remains intact.
- Existing tenant isolation remains intact.
- Stage 9 remains absent.
