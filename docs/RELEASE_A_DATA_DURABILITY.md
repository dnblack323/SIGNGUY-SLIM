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
- `PRAGMA synchronous = FULL` in production so SQLite asks the operating system
  to fully flush WAL transactions before reporting success;
- `PRAGMA synchronous = NORMAL` outside production to keep local development and
  test runs fast.

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
- an existing production database file must be writable by the service account;
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
- existing attachment and server-backup roots are compared by filesystem
  identity so mounted aliases cannot point both roles at the same storage;
- existing ancestors are also compared by filesystem identity so a backup root
  nested through a symlink or bind-mount alias of the attachment root is
  rejected before backups can recursively capture themselves;
- production validation also canonicalizes through existing ancestors so a
  backup root under an alias of an attachment subdirectory is rejected before
  it can write backup sets inside the attachment source tree;
- database, attachment, and server backup directories are treated as private
  infrastructure storage with owner-only permissions where the platform
  supports them;
- newly created production database directories are made private, and existing
  database directories must already be private rather than being chmodded by
  validation;
- production backend startup, backup, restore, and migration entrypoints require
  the configured database parent directory to already exist so a missing mounted
  database volume is not recreated on the host filesystem;
- direct database opening creates a missing database parent as private storage
  but does not chmod an existing shared parent directory;
- existing production database files are corrected to owner-readable/writeable
  permissions where the platform supports POSIX modes;
- mounted durable volumes should expose normal child directories for database,
  attachment, and backup paths instead of using the mount root as the runtime
  root;
- the database path itself must be a normal file inside a durable directory,
  not a Linux single-file bind mount, because recovery must be able to rename
  the database and its SQLite sidecars atomically;
- attachment and server-backup roots may not occupy the configured database's
  SQLite sidecar paths (`-wal`, `-shm`, or `-journal`), including those paths
  reached through Linux bind-mount aliases of the database directory;
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
- production backup, restore, and migration CLI commands, including
  `migrate-production --no-backup`, require the configured server backup root
  to preexist and do not provision a missing backup volume as an empty
  directory;
- production CLI commands other than validation require the configured
  attachment root and configured database parent directory to preexist, so an
  unmounted live volume is not recreated on the underlying host filesystem
  during backup, migration, or recovery;
- attachment and full backups reject a backup root nested beneath the
  attachment source even outside production mode, preventing recursive capture
  of previous backup sets as attachment payload, including backup roots reached
  through filesystem aliases or Linux bind mounts of attachment subdirectories;
- backup and migration commands refuse to proceed while a combined-restore
  marker is present beside the configured database;
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
attachment verification succeed. Database backup artifacts are validated through
isolated temporary copies so `PRAGMA quick_check` and coherence reads cannot
leave WAL/SHM sidecars inside completed backup sets. Completed backup files and
the partial backup directory are flushed before publication, and the backup root
is flushed after the final rename before retention pruning can remove older
recovery points. The operator can configure retention by keeping the most
recent successful backup sets under the backup root. Blank or whitespace-only
retention settings use the documented default instead of disabling cleanup.
Retention deletes only completed backup-set
directories with valid SignGuy Slim server-backup metadata and fully verified
database/attachment contents inside the configured backup root. Partial,
malformed, missing-metadata, checksum-corrupt, symlinked, or otherwise
questionable directories are left in place for operator inspection instead of
being silently deleted. Retention preserves the backup set created by the
current operation even if wall-clock metadata would otherwise sort it before
older sets. Backup publication and retention cleanup are serialized with a lock
under the configured backup root so overlapping backup commands cannot each
delete the other command's preserved current set while enforcing `retain-last`.
Backup sets whose database contains migration IDs unknown to the running
checkout are not eligible retention candidates, so a rolled-back application
version cannot prune the last backup it can actually restore.
The lock records an opaque owner token, host/process metadata, and an
`updated_at` heartbeat lease. Another process may reclaim the lock only after
the heartbeat is stale, and cleanup removes the lock only when the current
metadata still belongs to that owner after the heartbeat has stopped.
If final backup-set publication fails after the partial set is renamed, the
final-named set is removed instead of being left behind as a valid-looking
completed backup.

Full backups verify database-to-attachment coherence by comparing the copied
attachment manifest to active `order_attachments` rows and accepted stored
`intake_attachments` rows in the SQLite snapshot. A set fails rather than
publishing when the copied attachment bytes are missing or disagree with the
database's recorded size/checksum. Stopping or draining the app before a full
backup remains the preferred way to avoid live-write retry windows.

Release A also makes normal attachment creation honor the same database/file
boundary: uploaded files, annotated derivatives, intake attachments carried into
orders, and attachments restored from tenant-portable backups are flushed along
with their containing directory before the related database rows are inserted or
committed. Upload and annotation publication first copies staged bytes to a
destination-local temporary file and then renames that file into place, so
attachment roots mounted on a different filesystem from request temp storage do
not fail with cross-device rename errors.

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
- sync the database parent after moving the previous database and sidecars into
  the emergency directory and before publishing the restored database;
- make restored database files owner-writable before publication;
- replace the target through a temporary path and rename where practical;
- validate a combined database/attachment backup set before publishing either
  restored target;
- write a durable combined-restore marker before publication and clear it only
  after both database and attachment targets publish successfully;
- heartbeat the combined-restore marker while restore is running, so an older
  marker with a fresh heartbeat is not treated as stale by a competing restore;
- replace a validated stale combined-restore marker by renaming a temporary
  marker over it, leaving no unmarked interval where startup could pass before
  the retry owns the restore marker;
- preserve the marker parent directory's existing permissions during combined
  restore staging;
- reject combined restore target overrides where the attachment target would
  contain the restored database;
- reject combined restore target overrides where the restored database would be
  placed inside the configured live attachment root;
- reject combined restore target overrides where the attachment target would
  contain the configured live database file;
- reject restore targets that overlap the configured server backup root;
- reject restore targets beneath filesystem aliases of the configured server
  backup root;
- reject restore targets reached through Linux bind aliases sourced from
  descendants of the selected server backup root;
- allow restoring attachments directly to the configured live attachment root,
  but reject override targets that overlap that live root in either direction;
- reject hard-linked alternate database filenames during combined restore so a
  live attachment restore cannot be paired with a database path that does not
  actually replace the configured live database entry;
- reserve `.signguy-slim-restore-in-progress.json` as the combined restore
  marker filename and reject it as a database restore target;
- reject attachment restore targets that point at mounted volume roots instead
  of normal child directories, including Linux mount points listed in
  `/proc/self/mountinfo`; normal child directories under mounted storage remain
  supported restore targets;
- reject attachment restore targets beneath a filesystem alias of the configured
  live attachment root;
- reject dangling symlink attachment restore targets before staging, so restore
  does not replace an operator-created pointer to an unavailable volume;
- reject database restore targets beneath filesystem aliases of the configured
  live attachment root;
- reject attachment restore targets that would contain the configured live
  database through a filesystem alias of the database parent;
- reject database-only restore targets inside the configured live attachment
  root;
- reject mixed combined restores where only the database or only the attachment
  target points at live production storage;
- reject combined restore target pairs where either target contains the other;
- reject blank explicit restore target overrides such as
  `--target-attachments=` instead of resolving them to the process working
  directory;
- reject database restore targets that point at the configured live database's
  SQLite sidecar paths (`-wal`, `-shm`, or `-journal`), including sidecar paths
  reached through filesystem aliases or Linux bind-mount aliases of the
  configured database parent;
- reject live attachment-only restores whose archived attachment manifest does
  not satisfy active attachment rows in the current live database, reading the
  live SQLite database so committed rows still sitting in WAL are included;
- reject live database-only restores whose source database references active
  attachments that are absent from, or checksum-mismatched in, the current live
  attachment root;
- reject combined restore target pairs that are separate lexically but share an
  underlying filesystem entry through symlink, junction, or mount aliases;
- translate Linux mountinfo bind roots through their source mounted filesystem
  before comparing aliases, so roots reported relative to `/srv`-style source
  mounts are still detected;
- preserve existing restore-target parent directory permissions; newly created
  staging/restore directories are private, but shared existing parents are not
  chmodded by restore validation;
- flush the attachment restore parent immediately after moving the previous
  target to its emergency directory, before traversing and publishing the staged
  attachment tree;
- reject unrecorded source-side SQLite `-wal`, `-shm`, and `-journal` files
  before opening the backup database artifact;
- treat dangling target SQLite sidecar symlinks as existing unsafe restore
  targets before database publication;
- publish restored attachment roots with owner-only permissions on platforms
  that support POSIX modes;
- fail without mutating the current live files when validation fails;
- remove a newly published database if its post-rename durability sync fails
  and no pre-restore emergency database existed;
- sync database rollback directory changes before treating rollback as
  confirmed;
- sync attachment rollback directory changes before treating rollback as
  confirmed and clearing the combined-restore marker;
- keep the restore-in-progress marker in place when a post-publication failure
  leaves attachment rollback unconfirmed, so startup cannot serve an
  unverified database/attachment pair;
- allow a confirmed combined restore retry to replace a validated stale
  restore marker left by an interrupted earlier combined restore, while active
  or freshly heartbeated restore markers remain blocking so concurrent restores
  cannot replace each other's marker;
- acquire the same restore marker for live database-only and live
  attachment-only restores before validation, so standalone live restores cannot
  race a combined restore into a mismatched database/attachment pair;
- never operate on paths outside the configured backup set and runtime roots.

The application should be stopped during server restore. After restore, the
operator should run migrations and a smoke test before resuming production
traffic.

Production backend startup does not apply pending migrations. If the configured
database is missing or behind the checked-in migrations, startup fails and the
operator must run the production migration workflow first so a verified server
backup is created before schema mutation. Production startup also requires the
configured attachment source root and server backup root to already exist as
plain directories; a missing attachment or backup volume is treated as an
unavailable durable volume rather than recreated as an empty runtime path. If a
combined-restore marker is present beside the configured database, startup
fails with `server_restore_incomplete` so the operator can rerun recovery before
traffic resumes.
Creating the first production database is an explicit provisioning action. The
operator must pass `--initialize` to `npm run backend:migrate:production` or
`NODE_ENV=production npm run backend:migrate` when `SIGNGUY_SLIM_DB_PATH` does
not exist yet. Without that flag, production migration fails rather than
creating a database at a path that may represent a missing database volume.
Both production migration entrypoints require the configured database parent
directory to already exist, including first-deploy `--initialize`; the operator
must provision or mount that durable parent before migration runs.
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
2. run the production migration command, adding `-- --initialize` only for a
   deliberately provisioned first database;
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
