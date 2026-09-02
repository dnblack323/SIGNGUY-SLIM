# Release A Data Durability Plan

Release A remediates the commercial-readiness durability blockers identified as
`CRR-001` and `CRR-002`, plus the production storage/configuration portion of
`CRR-007`. It does not implement Stage 9, account recovery, rate limiting,
authorization redesign, monitoring dashboards, legal rollout work, or
quote/invoice polish.

## Scope

Release A is limited to:

- production database durability checks and documented operating requirements;
- SQLite runtime hardening appropriate for a single hosted Slim instance;
- operator-driven server database backup and restore commands;
- operator-driven attachment backup and restore commands;
- server backup metadata, checksum verification, and retention controls;
- production startup fail-fast validation for storage paths;
- preservation of the existing customer-portable encrypted backup format;
- documentation for deployment, recovery, and release smoke testing.

Release A deliberately does not add:

- PostgreSQL or another database engine;
- object storage SDKs or vendor-specific cloud backup code;
- an internal scheduler;
- customer-facing infrastructure-backup UI;
- new business features;
- Stage 9 Facebook/Meta code, configuration, dependencies, or placeholders.

## Current Database Model

Slim currently uses SQLite through `node:sqlite` and the repository's migration
runner. The default local-development database path is:

```text
data/signguy-slim.sqlite
```

That default is convenient for local development but is not a commercial hosting
durability contract. A production deployment must explicitly set an absolute
database path on durable storage:

```text
SIGNGUY_SLIM_DB_PATH
```

The application treats the SQLite file as the authoritative business database.
Portable customer backups are separate tenant export/import artifacts and are
not a replacement for hosted server backups.

## Target Database Runtime Contract

For a file-backed SQLite database, the backend should open the database with:

- foreign keys enabled;
- a busy timeout to reduce avoidable write-lock failures;
- WAL journaling for the hosted single-process deployment shape;
- normal synchronous behavior appropriate for WAL.

The supported initial commercial topology is one Slim backend process writing to
one SQLite database on durable local or mounted block storage. Multi-writer,
multi-process, and horizontally scaled database access are outside the initial
Slim release topology.

## Production Storage Validation

In production, Slim must fail before accepting requests if durable storage has
not been explicitly configured. The production startup contract is:

- `SIGNGUY_SLIM_DB_PATH` is required;
- `SIGNGUY_SLIM_ATTACHMENT_ROOT` is required;
- `SIGNGUY_SLIM_SERVER_BACKUP_ROOT` is required;
- all three paths must be absolute;
- `SIGNGUY_SLIM_DB_PATH` must not be `:memory:`;
- runtime data must not live under the normal repository working tree;
- the configured directories must be creatable and writable;
- the server backup root must not be nested inside the database or attachment
  source paths;
- the attachment root must not be nested inside the backup root;
- production HTTPS/cookie settings from Group F remain separate but still
  required for commercial hosting.

This validation is intended to catch accidental deployments using development
defaults, ephemeral container filesystems, `dist/`, `node_modules/`, or other
repository-local runtime locations.

## Server Database Backup

Release A introduces an operator command that creates a consistent SQLite backup
without stopping the application. The backup command uses SQLite's native backup
mechanism through `VACUUM INTO` so the backup file is a complete, standalone
database snapshot rather than a copy of only the main `.sqlite` file while WAL
pages are still pending.

A database backup must:

- write into a new backup-set directory under `SIGNGUY_SLIM_SERVER_BACKUP_ROOT`;
- use a temporary partial directory before publishing the completed set;
- include metadata with created time, application version, commit when known,
  source database path hash, backup file size, backup checksum, and applied
  schema migration IDs;
- verify the copied database with `PRAGMA quick_check`;
- never include plaintext authentication cookies, CSRF tokens, sessions, API
  keys, or provider credentials beyond whatever business data is already in the
  database schema;
- leave previous successful backup sets intact if the new backup fails.

## Attachment Storage Model

Slim attachment bytes are private operational files stored under
`SIGNGUY_SLIM_ATTACHMENT_ROOT`. Database rows own tenant, order, MIME,
checksum, and relationship metadata. Attachment service code stores files under
server-generated IDs and tenant/order path segments, not under user-supplied
filenames.

Original customer/order attachment bytes remain immutable. Annotated
derivatives are stored as separate attachment rows with derivative metadata.
Release A does not change that business model.

## Server Attachment Backup

Release A introduces an operator command that copies the configured attachment
root into a backup-set directory and writes a checksum manifest.

An attachment backup must:

- walk the attachment root recursively;
- reject symlinked roots or symlinked entries;
- reject paths that escape the attachment root;
- preserve relative paths only;
- record each file's relative path, byte size, and SHA-256 checksum;
- verify copied files against the manifest;
- support an empty attachment root;
- avoid backing up backup directories as attachments by rejecting nested backup
  and attachment roots in production configuration.

## Combined Server Backup

The normal hosted backup operation creates one backup set containing:

```text
backup-metadata.json
database.sqlite
attachments/
attachments-manifest.json
```

The backup-set directory is published atomically after both database and
attachment verification succeed. The operator can configure retention by keeping
the most recent successful backup sets under the backup root. Retention deletes
only validated backup-set directories inside the configured backup root.

Off-host durability is still an operational requirement. A completed backup set
must be copied or replicated to storage outside the application host. Release A
does not add vendor-specific off-host replication code.

## Restore Contract

Server restore is an operator-only, offline recovery action. Restore commands
must:

- require an explicit confirmation flag;
- validate the selected backup database with `PRAGMA quick_check`;
- validate the attachment manifest and file checksums;
- preserve the currently configured database or attachment root as an emergency
  pre-restore copy before replacement;
- replace the target through a temporary path and rename where practical;
- fail without mutating the current live files when validation fails;
- never operate on paths outside the configured backup set and runtime roots.

The application should be stopped during server restore. After restore, the
operator should run migrations and a smoke test before resuming production
traffic.

## Customer Portable Backup Compatibility

Slim's existing customer-facing portable backup remains a separate feature:

- encrypted `.signguy-backup` package;
- password protected;
- tenant/business data scoped;
- includes attachment contents needed for tenant portability;
- excludes active authentication sessions and runtime secrets.

Release A must not convert server backups into customer portable backups and
must not include active sessions, cookies, CSRF state, SendGrid keys, or other
runtime secrets in the portable export. Server backups are operational disaster
recovery artifacts. Portable backups are tenant export/import artifacts.

The shared `SIGNGUY-DATA-PORTABILITY` repository remains the future Slim-to-MVP
upgrade contract owner. Release A preserves that boundary and does not change
the shared portability schema.

## Migration and Upgrade Workflow

Production migration should be performed with a pre-migration server backup:

1. stop or drain production traffic when operationally possible;
2. run the production migration command;
3. verify the command created a server backup before migrations;
4. verify migrations completed;
5. restart the application;
6. run the manual smoke test;
7. copy the backup set off-host according to the operator retention plan.

## Manual Recovery Drill

Before accepting outside shops, the operator should complete this drill on a
staging copy:

1. create a customer, quote, order, production work order, invoice, payment,
   employee, time entry, announcement, message, and private attachment;
2. create a combined server backup;
3. restore database and attachments into a fresh runtime directory;
4. run migrations;
5. start the application against the restored runtime paths;
6. confirm login, tenant data, attachment download, production board, invoice
   balance, employee portal, and portable backup export still work;
7. copy the completed backup set off-host and confirm it can be retrieved.

## Remaining Release Boundaries

After Release A, the application may still remain commercially not ready if
other audit findings remain unresolved. In particular, Release A does not cover:

- rate limiting and account recovery;
- self-registration product policy;
- authorization matrix cleanup;
- hosted monitoring and support tooling;
- legal/business rollout checklist;
- quote/invoice customer-facing polish;
- Stage 9 Facebook/Meta intake.
