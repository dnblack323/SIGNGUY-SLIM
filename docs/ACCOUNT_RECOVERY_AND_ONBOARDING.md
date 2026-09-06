# Account Recovery and Onboarding

Commercial Release B keeps Slim's existing user, tenant, role, capability, and
HttpOnly-cookie session model. It adds bounded controls around how hosted shops
are created, how users recover access, and how tenant storage growth is limited.

## Hosted Registration

Production registration is invite-only by default. Set
`SIGNGUY_SLIM_PUBLIC_REGISTRATION_ENABLED=1` only for a deliberately open
signup deployment.

Owner/admin users create invitations from Settings. An invitation:

- contains a random high-entropy token shown only once;
- stores only a token hash in the database;
- may be restricted to the intended owner email;
- expires according to `SIGNGUY_SLIM_SIGNUP_INVITATION_LIFETIME_SECONDS`;
- is consumed atomically when tenant registration succeeds;
- can be revoked by the creating tenant's owner/admin if a link is disclosed;
- is audited without logging the plaintext token.

Invitation URLs use `SIGNGUY_SLIM_APP_URL`. Configure that value to the public
HTTPS app origin before sending production invitations. In production, Slim will
not persist a new invitation or password-reset token if the public app URL is
missing, non-HTTPS, or contains a path, query string, or fragment.

For the first hosted tenant on an empty production database, use the operator
bootstrap command after production migrations have run:

```powershell
npm run backend:account:create-bootstrap-invitation -- --email owner@example.com --expires-in-hours 24
```

This command creates one hashed invitation with no existing tenant issuer only
when the database has zero tenants. It refuses a second live bootstrap
invitation so operator retries cannot leave multiple first-tenant credentials
active. If the first link is lost or disclosed before it is used, revoke all
live bootstrap invitations and then create a replacement:

```powershell
npm run backend:account:revoke-bootstrap-invitations
```

After the first tenant registers, bootstrap invitation creation is refused and
ongoing onboarding returns to owner/admin invitation management inside
Settings.

For an existing tenant where no owner/admin can authenticate and public reset
delivery is unavailable, a verified deployment operator can generate an
audited same-tenant reset link for an active user:

```powershell
npm run backend:account:create-operator-password-reset -- --tenant-slug shop-slug --email owner@example.com
```

This operator command does not create tenants and must not replace normal
in-app owner/admin account management.

## Password Recovery

Public password-reset requests accept an email address and return the same
generic response whether an active account exists or not. This avoids account
enumeration.

For active matching users, Slim creates a one-time reset token:

- random and high entropy;
- hashed at rest;
- absolute expiration from `SIGNGUY_SLIM_PASSWORD_RESET_LIFETIME_SECONDS`;
- single use;
- rejected for inactive users;
- consumes/revokes other active reset tokens for that user;
- revokes existing sessions after successful password change.

When SendGrid is configured, the reset URL is sent by email from the
provider-verified platform sender configured in
`SIGNGUY_SLIM_RECOVERY_FROM_EMAIL`. Production startup requires this value so
recovery delivery does not rely on tenant-controlled sender verification.
Public reset responses do not wait for provider delivery, and delivery work is
scheduled after the generic response turn.
Duplicate-email fan-out across tenants is capped by
`SIGNGUY_SLIM_PASSWORD_RESET_REQUEST_MAX_MATCHES`. If replacement delivery
fails, Slim revokes the newly inaccessible token and preserves any prior usable
reset link until it expires or is replaced by a successful delivery. When email
delivery is unavailable, owner/admin users can create a same-tenant reset link
from Settings and deliver it through an operator-approved support channel.

## Abuse Controls

Release B uses fixed-window SQLite-backed rate limits with hashed bucket keys.
Default budgets cover:

- login by IP and submitted account identity;
- registration by IP;
- password reset request by IP and email;
- password reset completion by IP and token;
- onboarding invitation generation by tenant/user;
- operator password-reset link generation by tenant/user;
- authenticated customer-email sends;
- authenticated uploads;
- backup export, preview, and restore.

Exhausted budgets return `429 rate_limit_exceeded` with a retry time. These
limits are application controls and should be paired with normal edge/proxy
limits for a hosted deployment.

## Tenant Storage Quotas

Each tenant has an effective storage quota from `tenants.storage_quota_bytes` or
`SIGNGUY_SLIM_DEFAULT_TENANT_STORAGE_QUOTA_BYTES`. Usage is derived from stored
private order attachments and incoming-request attachments.

Quota is checked before committing durable bytes for:

- normal order attachments;
- camera/photo uploads;
- annotation derivatives;
- incoming-request attachment persistence;
- copying intake attachments to orders;
- customer portable backup restore.

Quota failures return `storage_quota_exceeded` and should not leave committed
database rows or orphaned durable files. Deleted order attachments remain
charged to quota while their files are retained on disk; quota is released only
when a later retention process physically removes retained bytes.

Hosted quota policy is not tenant self-service business data. Tenant users can
view usage and quota in Settings, but quota increases are deployment-operator
policy rather than an in-app owner/admin setting. Portable backups exclude quota
settings, rate-limit buckets, invitations, reset tokens, active sessions,
cookies, and CSRF state.

## Operational Checklist

- Keep production registration invite-only unless open signup is intentional.
- For first deploys, create the initial tenant with
  `npm run backend:account:create-bootstrap-invitation` instead of temporarily
  opening public registration.
- If the initial bootstrap invitation is lost or disclosed before registration,
  run `npm run backend:account:revoke-bootstrap-invitations` before creating a
  replacement.
- Set `SIGNGUY_SLIM_APP_URL` to the public HTTPS origin.
- Set `SIGNGUY_SLIM_PASSWORD_RESET_REQUEST_MAX_MATCHES` deliberately if the
  hosted deployment allows the same login email across multiple tenants.
- Configure SendGrid before relying on self-service reset delivery.
- Configure `SIGNGUY_SLIM_RECOVERY_FROM_EMAIL` to a SendGrid-verified sender.
  Production preflight rejects missing or malformed recovery sender values
  before startup.
- Use owner/admin reset-link generation only after confirming the requester's
  identity through an approved support process.
- Treat invitation and reset URLs as credentials while active.
- Tune rate-limit environment variables only after observing real traffic.
- Monitor tenant storage usage and raise quotas deliberately through the
  deployment/operator process.
- Use `docs/SUPPORT_AND_INCIDENT_RESPONSE.md` for owner lockout, suspected
  compromise, invitation leakage, SendGrid outage, quota incident, failed
  portable restore, and failed hosted restore procedures.
- Keep Release E, Step 3, and Stage 9 out of Release D deployments unless they
  are separately implemented and reviewed.
