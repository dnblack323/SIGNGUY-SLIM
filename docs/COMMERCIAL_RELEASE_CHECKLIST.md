# Commercial Release Checklist

Use this checklist for every controlled SignGuy Slim commercial deployment.
It is a release gate, not proof that all future commercial requirements are
complete.

## Release Identity

- Intended release SHA:
- Source branch:
- Target environment:
- Operator:
- Approval date/time:
- Rollback decision owner:

## Pre-Deploy Gate

- Local or PR head is the intended reviewed SHA.
- GitHub Slim CI passed on the exact intended SHA.
- `npm audit --json` passed.
- `npm audit --omit=dev --json` passed.
- Production configuration check passed with production environment loaded.
- Database migration status is known.
- Server database, attachment, and backup roots are durable mounted storage.
- Customer portable backup behavior is unchanged.
- Server backup and customer portable backup are treated as separate artifacts.
- Stage 9 Facebook/Meta remains deferred unless separately authorized.

## Backup Gate

- Latest server backup completed successfully.
- Backup metadata identifies database and attachment content.
- Backup set is stored outside the live database and attachment roots.
- Off-host copy/replication completed or the operator explicitly accepts the
  deployment risk.
- Restore drill date is recorded in the operations log.
- No incomplete restore marker is present before deployment.

## Deployment Gate

- Deploy code at the intended SHA.
- Install dependencies with `npm ci`.
- Run production migrations through:

```powershell
npm run backend:migrate:production
```

- Start exactly one backend process for the supported initial SQLite topology.
- Confirm HTTPS termination is active before customer browser traffic.
- Set `SIGNGUY_SLIM_TRUST_PROXY=1` only behind a trusted HTTPS proxy.
- Confirm configured allowed origins match the deployed frontend origin.

## Health And Readiness Gate

- `GET /api/health` returns `200` and `status: ok`.
- `GET /api/ready` returns `200` and `status: ready`.
- Responses do not include secrets, filesystem paths, tenant data, or database
  contents.
- The response includes `X-Request-Id`.
- Structured logs contain request IDs and safe status/event fields.

## Role Smoke Matrix

| Role | Required checks |
| --- | --- |
| Owner | login, Settings, users, backup/export entry point, customer/quote/order/invoice/payment, email settings |
| Admin | login, user/employee administration, backup/export entry point, commercial workflows |
| Manager | login, customers, quotes, orders, incoming requests, production setup, calendar, invoice/payment, time review |
| Staff | login, assigned production work, production evidence attachment/photo/annotation, own/personal calendar entry, Employee Portal |

## Core Workflow Smoke

- Register or use an invite-created tenant in a non-production test tenant.
- Login and refresh browser session.
- Create Customer.
- Create Quote.
- Convert Quote to Order.
- Add/edit Order Item.
- Send Order to Production.
- Move Work Order through ready, in progress, waiting, complete, and reopen.
- Create Calendar event.
- Upload attachment/photo and preview/download it.
- Save an annotation derivative.
- Create Invoice.
- Record valid Payment.
- Create Employee and verify Employee Portal access.
- Clock in/out.
- Review Time & Attendance.
- Review Payroll/My Pay according to capability.
- Publish Employee Announcement and mark read in the portal.
- Send internal Employee Message.
- Receive or simulate signed Incoming Request only in a configured test path.
- Export customer portable backup.
- Logout and restore login with cookie session.

## Error And Empty-State Smoke

- Unauthenticated request returns `401 unauthorized`.
- Unauthorized role request returns `403 permission_denied` or the existing safe
  domain code.
- Invalid input returns validation error without stack trace.
- Unknown same-tenant record returns safe not-found behavior.
- Rate limit returns `429 rate_limit_exceeded`.
- Storage quota failure returns `storage_quota_exceeded`.
- Email provider unavailable/failing send records failure honestly.
- Empty Customers, Orders, Calendar, Incoming Requests, Production, and Employee
  Portal views distinguish no data from request failure.

## Browser And Device Statement

Initial Release D support is limited to current Chromium-family desktop browsers
on normal hosted browser access, Windows desktop/laptop operator workflows, and
mobile/tablet Employee Portal or camera/photo workflows only where explicitly
smoked before launch. Safari and Firefox should be treated as needs-verification
until tested.

## Post-Deploy Observation

- Watch health/readiness for at least one business workflow cycle.
- Confirm structured logs are collected off-process.
- Confirm disk/volume metrics are collected externally.
- Confirm SendGrid account status and sender/domain verification.
- Confirm backup schedule ran after deployment.
- Record any manual smoke failures and rollback decision.

## Sign-Off

- Technical sign-off:
- Operations sign-off:
- Business/legal checklist reviewed:
- Known accepted limitations:
- Release E document polish still outstanding:

