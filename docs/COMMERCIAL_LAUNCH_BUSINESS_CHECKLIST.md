# Commercial Launch Business Checklist

This checklist separates repository/code readiness from owner, operator, and
legal business responsibilities. It is not legal advice and does not create
legal approval.

## Code-Complete Inputs

- Hardening Groups A-F are complete.
- Commercial Releases A-C are complete.
- Commercial Release D provides health/readiness, request correlation,
  structured logging, operator diagnostics, support runbooks, CI gates, and
  release checklists.
- Customer portable backups remain separate from hosted server backups.
- Payroll/pay tracking is internal operational tracking only.
- Stage 9 Facebook/Meta remains deferred.

## Requires Owner/Legal Review

- Terms of Service.
- Privacy Policy.
- Data retention statement.
- Customer data deletion/export process.
- Acceptable use policy.
- Security incident contact process.
- Customer support contact method and expected response times.
- Backup/recovery responsibility statement.
- Subscription, cancellation, and refund terms when billing is added.
- Email consent and sender obligations.
- Payroll disclaimer.
- Sales Tax disclaimer.

## Payroll Disclaimer

Slim pay tracking is an internal shop operations ledger and estimate. It is not:

- payroll tax filing;
- tax withholding calculation;
- overtime-law compliance engine;
- payroll-provider service;
- direct deposit;
- benefits administration.

Owners remain responsible for wage, tax, employment, and recordkeeping
obligations outside Slim.

## Sales Tax Disclaimer

Slim stores tax rates and financial snapshots for quotes, orders, and invoices.
It does not file taxes, remit taxes, determine nexus, manage exemptions beyond
entered shop data, or provide accounting/legal tax advice.

## Backup Responsibility

Customer portable backups support customer data ownership, export, and future
Slim-to-MVP portability. Hosted server backups support disaster recovery for the
running deployment. These are separate artifacts and must not be conflated.

The operator remains responsible for off-host replication, retention policy,
restore drills, and customer-facing recovery commitments.

## Email Sender Responsibility

Before enabling customer email in production:

- configure the SendGrid API key server-side only;
- verify the sender or domain in SendGrid;
- set a production recovery sender;
- document reply-to expectations;
- monitor bounces, blocks, drops, and provider account health.

## Security And Privacy Operations

- Publish the business contact for security incidents.
- Define who may inspect logs and audit trails.
- Define when customer files may be requested and how they are transferred.
- Define breach/customer notification responsibilities through legal counsel.
- Do not request customer passwords, active reset URLs, session cookies, CSRF
  tokens, backup passphrases, or provider secrets during normal support.

## Commercial Limitations Before Final Ready Classification

- Release E customer-facing document polish remains outstanding.
- Final commercial re-audit remains required after Release E.
- Browser/device coverage is limited to the environments actually smoked before
  launch.
- Stage 9 Facebook/Meta order intake remains deferred until the required Meta
  business app/Page setup exists and the user separately authorizes that work.

