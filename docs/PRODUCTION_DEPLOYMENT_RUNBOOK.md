# Production Deployment Runbook

This runbook describes the supported initial commercial deployment shape after
Release A.

## Supported Topology

The supported first commercial topology is:

- one SignGuy Slim backend process;
- same-origin HTTPS frontend/backend where practical;
- SQLite on durable local or mounted block storage;
- private attachment root on durable storage;
- server backup root on durable storage;
- completed backup sets copied off-host by the operator;
- SendGrid configured only after sender identity is verified;
- `SIGNGUY_SLIM_TRUST_PROXY=1` only behind a trusted HTTPS-terminating proxy.

Horizontal backend scaling, multi-writer database access, PostgreSQL, object
storage SDKs, and vendor-specific infrastructure are outside Release A.
When using mounted volumes, configure normal private child directories on those
volumes for the database directory, attachment root, and server backup root.
Do not point `SIGNGUY_SLIM_ATTACHMENT_ROOT` or
`SIGNGUY_SLIM_SERVER_BACKUP_ROOT` at the mounted volume root itself.
Create those runtime directories explicitly during provisioning. Operational
backup, restore, and backup-required migration commands treat a missing
attachment or backup root as an unavailable durable volume and do not recreate
it silently.

## Required Production Environment

Set these for production:

```text
NODE_ENV=production
PORT=4175
SIGNGUY_SLIM_DB_PATH=/absolute/durable/path/signguy-slim.sqlite
SIGNGUY_SLIM_ATTACHMENT_ROOT=/absolute/durable/path/attachments
SIGNGUY_SLIM_SERVER_BACKUP_ROOT=/absolute/durable/path/server-backups
SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST=30
SIGNGUY_SLIM_COOKIE_SECURE=1
SIGNGUY_SLIM_TRUST_PROXY=0
SIGNGUY_SLIM_ALLOWED_ORIGINS=
```

The server backup root contains privileged all-tenant infrastructure data. It
must be owner-only on the host and copied to encrypted off-host storage by the
operator.

For split-origin hosting, set `SIGNGUY_SLIM_ALLOWED_ORIGINS` to the exact
trusted frontend origin list and configure CORS/proxy behavior accordingly. Do
not use wildcard origins with credentials.

Set these only when customer email/intake is configured:

```text
SIGNGUY_SLIM_SENDGRID_API_KEY=
SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET=
SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET=
SIGNGUY_SLIM_INTAKE_DOMAIN=intake.signguy-slim.local
```

## Startup Checks

Validate production storage before rollout:

```powershell
npm run backend:config:production
```

The backend also runs production storage validation before listening when
`NODE_ENV=production`.

## Deploy and Upgrade

1. Confirm the current production backup policy is running.
2. Fetch or deploy the new code.
3. Install dependencies.
4. Run `npm run backend:migrate:production`; add `-- --initialize` only when
   provisioning the first production database at an intentionally empty
   `SIGNGUY_SLIM_DB_PATH`.
5. Build frontend assets with `npm run build`.
6. Start the backend with production environment variables.
7. Complete the smoke test below.
8. Confirm the generated pre-migration backup set was copied off-host.

## Manual Smoke Test

Before routing live customer traffic, verify:

- register or log in;
- create a customer;
- create a quote;
- convert quote to order;
- add an order item;
- release production work;
- create or view a calendar event;
- upload and download a private attachment;
- create an annotated attachment copy;
- create an invoice;
- record a valid payment;
- create an employee;
- clock in and clock out in the Employee Portal;
- view My Pay;
- publish an announcement;
- send an internal employee message;
- send or dry-run a customer email according to SendGrid configuration;
- create an encrypted customer portable backup;
- create a full server backup;
- log out and log back in.

## Recovery Drill

Before accepting outside shops, perform a staging recovery drill:

1. create realistic tenant data with attachments;
2. run `npm run backend:backup:server`;
3. copy the backup set to an off-host location and retrieve it;
4. restore database and attachments into fresh runtime paths;
5. run migrations, using `-- --initialize` only for an intentionally empty
   restored database target;
6. start the backend;
7. complete the smoke test above.

## Release Boundary

Release A reduces the data-durability blockers but does not complete all
commercial-readiness remediation. Release B and later audit findings still need
separate authorization. Stage 9 Facebook/Meta intake remains deferred.
