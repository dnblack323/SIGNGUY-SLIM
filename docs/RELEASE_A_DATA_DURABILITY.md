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
- `SIGNGUY_SLIM_DB_PATH` must be a regular file when it already exists;
- runtime data must not live under the normal repository working tree;
- the configured directories must be creatable and writable;
- the server backup root must not be nested inside the database or attachment
  source paths;
- the attachment root must not be nested inside the backup root;
- directory-backed runtime roots must not contain the repository checkout;
- the database file must not be nested inside the attachment root or server
  backup root;
- the configured database path must not itself contain attachment or server
  backup roots, which prevents a file path typo from being created as a
  directory by runtime-root provisioning;
- writable paths are canonicalized and storage separation is rechecked after
  symlinked ancestors are resolved;
- server backup directories are treated as private infrastructure storage and
  are created with owner-only permissions where the platform supports them;
- mounted durable volumes should expose normal child directories for database,
  attachment, and backup paths instead of using the mount root as the runtime
  root;
- attachment and server-backup roots that point at filesystem or volume roots
  are rejected during production validation;
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

The server database backup is sensitive infrastructure data, not a tenant
export. It can contain password hashes, session hashes, audit records, all
tenant business records, and private operational metadata. It must be stored and
replicated as privileged operator data.
Backup directories are created owner-only where supported, and copied database
and metadata files are written owner-readable/writeable only.

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
- require the attachment source root to already exist as a plain directory;
- production attachment and full-backup CLI commands require the configured
  attachment source root to preexist and do not provision a missing source as an
  empty directory;
- reject symlinked roots or symlinked entries;
- reject paths that escape the attachment root;
- preserve relative paths only;
- record each file's relative path, byte size, and SHA-256 checksum;
- verify copied files against the manifest;
- support an empty attachment root;
- avoid backing up backup directories as attachments by rejecting nested backup
  and attachment roots in production configuration.

Attachment manifest paths are strictly relative POSIX-style paths. Traversal,
absolute paths, Windows drive-prefix paths, UNC-style paths, empty path
segments, symlinked sources, and symlinked archived ancestors are rejected
during backup and restore.

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
only completed backup-set directories with valid SignGuy Slim server-backup
metadata and fully verified database/attachment contents inside the configured
backup root. Partial, malformed, missing-metadata, checksum-corrupt, symlinked,
or otherwise questionable directories are left in place for operator inspection
instead of being silently deleted. Retention preserves the backup set created
by the current operation even if wall-clock metadata would otherwise sort it
before older sets.

Full backups verify database-to-attachment coherence by comparing the copied
attachment manifest to active `order_attachments` rows and accepted stored
`intake_attachments` rows in the SQLite snapshot. A set fails rather than
publishing when the copied attachment bytes are missing or disagree with the
database's recorded size/checksum. Stopping or draining the app before a full
backup remains the preferred way to avoid live-write retry windows.

Off-host durability is still an operational requirement. A completed backup set
must be copied or replicated to storage outside the application host. Release A
does not add vendor-specific off-host replication code.

## Restore Contract

Server restore is an operator-only, offline recovery action. Restore commands
must:

- require an explicit confirmation flag;
- validate the selected backup database with `PRAGMA quick_check`;
- validate the selected backup database and attachment manifest against the
  hashes and byte counts recorded in backup metadata;
- validate the attachment manifest and file checksums;
- preserve the currently configured database or attachment root as an emergency
  pre-restore copy before replacement;
- preserve and clear SQLite WAL/SHM sidecars so stale pages from the previous
  database, including rollback-journal files, cannot affect the restored
  database;
- make restored database files owner-writable before publication;
- replace the target through a temporary path and rename where practical;
- validate a combined database/attachment backup set before publishing either
  restored target;
- reject combined restore target overrides where the attachment target would
  contain the restored database;
- reject restore targets that overlap the configured server backup root;
- allow restoring attachments directly to the configured live attachment root,
  but reject override targets that are ancestors of that live root;
- reject attachment restore targets that point at mounted volume roots instead
  of normal child directories, including Linux mount points listed in
  `/proc/self/mountinfo`;
- reject database-only restore targets inside the configured live attachment
  root;
- reject unrecorded source-side SQLite `-wal`, `-shm`, and `-journal` files
  before opening the backup database artifact;
- treat dangling target SQLite sidecar symlinks as existing unsafe restore
  targets before database publication;
- publish restored attachment roots with owner-only permissions on platforms
  that support POSIX modes;
- fail without mutating the current live files when validation fails;
- never operate on paths outside the configured backup set and runtime roots.

The application should be stopped during server restore. After restore, the
operator should run migrations and a smoke test before resuming production
traffic.

Production backend startup does not apply pending migrations. If the configured
database is missing or behind the checked-in migrations, startup fails and the
operator must run the production migration workflow first so a verified server
backup is created before schema mutation.
Databases that contain migration IDs unknown to the running application are
treated as newer unsupported schemas and are rejected by startup, production
migration, and server database restore.

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
