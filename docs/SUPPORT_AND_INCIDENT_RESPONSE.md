# Support And Incident Response

This runbook defines the controlled commercial support process for SignGuy
Slim. It complements the app's audit trail, Release A server backup/restore,
Release B onboarding/account recovery controls, Release C authorization policy,
and Release D health/readiness/diagnostics.

Do not collect passwords, password reset tokens, signup invitation tokens,
session cookies, CSRF tokens, backup passphrases, SendGrid API keys, webhook
secrets, private message bodies, or raw customer artwork as ordinary support
evidence.

## Severity Levels

| Severity | Definition | Examples |
| --- | --- | --- |
| P0 | Data loss, suspected security incident, tenant crossover, destructive restore issue, or exposed secret. | customer data visible to another tenant, missing attachments after deploy, compromised owner account |
| P1 | Shop cannot operate a critical workflow. | owner/admin cannot log in, DB unavailable, email intake down during business hours, backup restore blocked |
| P2 | Important workflow degraded with workaround. | SendGrid rejection, one user locked out, quota exceeded, attachment upload failing for one file type |
| P3 | Normal bug, usability issue, stale copy, or non-critical question. | confusing empty state, minor layout issue, report wording question |

## First Checks

1. Check `/api/health` for process liveness.
2. Check `/api/ready` for database, migration, restore-marker, and production
   storage readiness.
3. Run `npm run backend:diagnostics` on the host with the production
   environment loaded.
4. Find the reported `X-Request-Id` or client-visible `request_id` in the
   structured logs.
5. Confirm the current deployment SHA and whether a deploy, migration, backup,
   restore, or configuration change happened near the incident time.
6. Review application audit events for the affected tenant and entity where the
   user has provided safe identifiers.

## Evidence To Collect

- request ID and approximate timestamp;
- affected tenant slug or tenant ID if already known by the operator;
- affected user ID or email when needed for account support;
- affected order, quote, invoice, work order, or attachment ID;
- endpoint path and HTTP method;
- HTTP status and safe error code;
- browser/device/browser-version information for UI defects;
- screenshot with customer-private information redacted where practical;
- `npm run backend:diagnostics` output;
- relevant structured log lines.

## Evidence Not To Collect

- passwords;
- reset or invitation URLs while still active;
- backup passphrases;
- Cookie, Set-Cookie, Authorization, or CSRF header values;
- raw attachment/artwork files unless the customer explicitly approves and a
  secure transfer process exists;
- private employee message content unless the incident specifically concerns
  that content and the owner approves review.

## P0 Procedure

1. Preserve evidence. Do not run cleanup commands, delete files, rotate logs, or
   overwrite backups.
2. Stop and drain traffic if tenant crossover, credential leakage, destructive
   restore, or active data loss is plausible.
3. Confirm whether `/api/ready` reports an incomplete restore marker,
   migrations pending, or storage failure.
4. Snapshot the current database and attachment roots using the Release A server
   backup procedure if doing so will not overwrite evidence.
5. Revoke compromised users or sessions using owner/admin controls where the
   owner is available; otherwise follow the operator recovery path.
6. Restore only after identifying the last known good backup and confirming the
   restore target is correct. Do not use backup restore as a generic debugging
   step.
7. Document customer notification needs through the business/legal incident
   process.

## P1 Procedure

1. Check health and readiness.
2. Confirm production storage mounts are present and writable.
3. Check recent deploy/migration logs and post-deploy CI state.
4. Run operator diagnostics.
5. If the issue is login/account access, use the account recovery runbook.
6. If the issue is email delivery, use the email operations section below.
7. If the issue is storage quota, confirm tenant usage and quota policy before
   changing operator-managed quota.
8. Escalate to P0 if investigation suggests data loss, data crossover, or a
   security incident.

## Account Support

### Owner Forgot Password

Preferred path: public password reset if SendGrid recovery delivery is
configured.

Fallback path: an authenticated owner/admin may create a same-tenant reset link
from Settings. If no owner/admin can log in and the requester has been verified
outside Slim, the deployment operator may generate an audited same-tenant reset
link for an existing active user:

```powershell
npm run backend:account:create-operator-password-reset -- --tenant-slug shop-slug --email owner@example.com
```

This command is for existing tenants only. Do not use the bootstrap invitation
command after a tenant exists.

### Owner Email Inaccessible

Verify ownership through an approved business process before changing users or
delivering any reset link. Do not send active reset links to an unverified new
email address. Record the reason in the audit trail when using in-app
owner/admin recovery functions.

### Invitation Expired Or Leaked

Owner/admin users should revoke the invitation and issue a new one. For the
first tenant bootstrap link, use:

```powershell
npm run backend:account:revoke-bootstrap-invitations
npm run backend:account:create-bootstrap-invitation -- --email owner@example.com --expires-in-hours 24
```

### Suspected Compromised Account

Deactivate the affected user if business operations allow it. Password reset
completion revokes existing sessions for that user. Preserve request IDs,
timestamps, and audit evidence.

## Email Operations

Use Settings to confirm sender configuration and SendGrid readiness. Use
customer communication history and operator diagnostics to identify failed,
bounced, blocked, dropped, spam-report, or stale deferred sends.

Manual resend is the initial controlled recovery path:

1. Confirm the intended customer, document, recipient, and attachment choices.
2. Correct sender/recipient/provider configuration if needed.
3. Resend from the existing Quote, Order, or Invoice email composer.
4. Let Slim generate a fresh idempotency key for the explicit resend action.
5. Preserve the original failed delivery record and provider/audit history.

Do not edit database delivery rows to make a failed provider request look
successful.

## Backup And Restore Incidents

Use customer portable Backup & Restore for customer-owned data export/import.
Use Release A server backups only for hosted disaster recovery and production
rollback.

Before any hosted restore:

- confirm the selected backup set with `npm run backend:backup:server` metadata
  or operator diagnostics;
- confirm off-host backup replication status through the hosting platform;
- stop application traffic as required by the server backup runbook;
- verify target database and attachment paths;
- preserve existing data through the emergency backup path;
- inspect `/api/ready` after restore.

Do not run destructive filesystem cleanup commands as a recovery shortcut.

## Safe Support Snapshot

A safe support snapshot may include:

- deployment SHA;
- package version;
- health/readiness response;
- diagnostics JSON;
- request IDs;
- relevant structured logs after redaction;
- audit-event IDs and action names;
- counts of affected records.

It must not include secrets, active credential URLs, cookies, CSRF tokens,
passwords, backup passphrases, or raw customer files.
