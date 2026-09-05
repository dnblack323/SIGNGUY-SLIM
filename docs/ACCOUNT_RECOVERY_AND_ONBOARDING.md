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
- is audited without logging the plaintext token.

Invitation URLs use `SIGNGUY_SLIM_APP_URL`. Configure that value to the public
HTTPS app origin before sending production invitations.

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

When SendGrid is configured, the reset URL is sent by email. When email delivery
is unavailable, owner/admin users can create a same-tenant reset link from
Settings and deliver it through an operator-approved support channel.

## Abuse Controls

Release B uses fixed-window SQLite-backed rate limits with hashed bucket keys.
Default budgets cover:

- login by IP and submitted account identity;
- registration by IP;
- password reset request by IP and email;
- password reset completion by IP and token;
- authenticated customer-email sends;
- authenticated uploads;
- backup export, preview, and restore.

Exhausted budgets return `429 rate_limit_exceeded` with a retry time. These
limits are application controls and should be paired with normal edge/proxy
limits for a hosted deployment.

## Tenant Storage Quotas

Each tenant has an effective storage quota from `tenants.storage_quota_bytes` or
`SIGNGUY_SLIM_DEFAULT_TENANT_STORAGE_QUOTA_BYTES`. Usage is derived from active
private order attachments and incoming-request attachments.

Quota is checked before committing durable bytes for:

- normal order attachments;
- camera/photo uploads;
- annotation derivatives;
- incoming-request attachment persistence;
- copying intake attachments to orders;
- customer portable backup restore.

Quota failures return `storage_quota_exceeded` and should not leave committed
database rows or orphaned durable files.

Hosted quota policy is not customer-portable business data. Portable backups
exclude quota settings, rate-limit buckets, invitations, reset tokens, active
sessions, cookies, and CSRF state.

## Operational Checklist

- Keep production registration invite-only unless open signup is intentional.
- Set `SIGNGUY_SLIM_APP_URL` to the public HTTPS origin.
- Configure SendGrid before relying on self-service reset delivery.
- Use owner/admin reset-link generation only after confirming the requester's
  identity through an approved support process.
- Treat invitation and reset URLs as credentials while active.
- Tune rate-limit environment variables only after observing real traffic.
- Monitor tenant storage usage and raise quotas deliberately.
- Keep Commercial Release C, D, E, and Stage 9 out of Release B deployments
  unless they are separately implemented and reviewed.
