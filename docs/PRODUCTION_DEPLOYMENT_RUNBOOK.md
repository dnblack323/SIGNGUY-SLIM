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
Do not bind-mount the SQLite database file directly; mount durable storage at
the parent directory level and place the database file inside that directory so
restore can rename the database and sidecars safely.
Do not configure attachment or backup roots at the SQLite sidecar paths
`${SIGNGUY_SLIM_DB_PATH}-wal`, `${SIGNGUY_SLIM_DB_PATH}-shm`, or
`${SIGNGUY_SLIM_DB_PATH}-journal`, including those paths reached through Linux
bind-mount aliases of the database directory.
Create those runtime directories explicitly during provisioning. Operational
backup, restore, migration commands, including `migrate-production --no-backup`,
and production backend startup treat a missing attachment or backup root as an
unavailable durable volume and do not recreate it silently.
The server backup root must not be nested under the attachment source root.
It also must not sit beneath a filesystem alias of the attachment root or one
of its subdirectories, including Linux bind mounts sourced from an attachment
subdirectory. On Linux, mountinfo roots are translated through their source
mounted filesystem before alias checks are compared, so `/srv`-mounted storage
aliases do not bypass these protections.
Backup and migration commands refuse to run while a combined-restore marker is
present beside the configured database.
If the production database parent directory already exists, it must already be
private to the service account; startup validation will not chmod a shared
existing directory on the operator's behalf.
Operational restore commands also require the configured production database
parent directory to preexist before recovery begins. A missing database volume
must be remounted or reprovisioned explicitly rather than recreated as an empty
host-local directory.
Production startup and production migration follow the same database-parent
precondition.
Combined restore must restore live database and live attachments together, or
restore both to separate staging paths. Do not mix one live target with one
staging target. Do not use hard-linked alternate filenames for the live
database target, and do not name a combined restore database target
`.signguy-slim-restore-in-progress.json`; that filename is reserved for the
durable restore marker.
Restore target overrides must also stay separated through filesystem aliases:
do not point a database target beneath an alias of the live attachment root, or
an attachment target at a path that contains the live database through an alias
of the database parent. Explicit restore target overrides must be non-empty;
`--target-attachments=` and similar blank values are rejected rather than
defaulting to the command's working directory.
Restore targets also must not use Linux bind aliases sourced from descendants of
the selected server backup root.
Attachment restore targets must not be symlinks, including dangling symlinks to
temporarily unavailable volumes.
Database restore targets must not be the configured live database's SQLite
sidecar paths (`-wal`, `-shm`, or `-journal`), including those paths reached
through filesystem aliases or Linux bind-mount aliases of the configured
database parent. If an interrupted combined restore leaves
`.signguy-slim-restore-in-progress.json` beside the
target database, a confirmed `restore-server` retry may replace the validated
stale marker by renaming a temporary marker over it and complete recovery before
production startup is allowed. Active or freshly heartbeated restore markers
block competing restore attempts.
Live database-only and live attachment-only restores use the same marker before
validation so they cannot race combined restore publication.
In production the backend opens file-backed SQLite with WAL and
`PRAGMA synchronous = FULL`. Nonproduction keeps `NORMAL` synchronous behavior
for speed, but hosted production favors stronger flush semantics.
Uploaded, annotated, intake-carried, and tenant-backup-restored attachment bytes
are flushed before their database rows commit. Upload and annotation staging may
come from the host temp directory, but publication uses a destination-local temp
file under the attachment root before the final rename, so separate mounted
attachment storage is supported.
Blank or whitespace-only `SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST` values use
the documented default retention count.

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
`NODE_ENV=production`, requiring the configured database parent, attachment
root, and server backup root to already exist as provisioned durable
directories. The validation command is non-mutating and must fail rather than
create replacement host-local directories when a durable volume is unavailable.

## Deploy and Upgrade

1. Confirm the current production backup policy is running.
2. Fetch or deploy the new code.
3. Install dependencies.
4. Run `npm run backend:migrate:production`; add `-- --initialize` only when
   provisioning the first production database at an intentionally empty
   `SIGNGUY_SLIM_DB_PATH`.
   The configured database parent directory must already exist before either
   production migration entrypoint runs, including first-deploy initialize.
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
