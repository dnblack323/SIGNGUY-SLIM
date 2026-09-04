# Server Backup and Recovery

This runbook covers hosted infrastructure backup and restore for SignGuy Slim.
It is separate from the customer-facing encrypted `.signguy-backup` export in
Settings.

## Required Paths

Production deployments must configure durable absolute paths:

```text
SIGNGUY_SLIM_DB_PATH=/srv/signguy-slim/db/signguy-slim.sqlite
SIGNGUY_SLIM_ATTACHMENT_ROOT=/srv/signguy-slim/attachments
SIGNGUY_SLIM_SERVER_BACKUP_ROOT=/srv/signguy-slim/server-backups
SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST=30
```

The database path, attachment root, and server backup root must not be normal
repository-local defaults. The application validates these paths in production
before accepting requests. Directory-backed runtime roots must not be inside
the repository and must not contain the repository. The database file must not
be located inside the attachment root or server-backup root. Storage separation
is rechecked after canonicalizing writable paths so symlinked ancestors cannot
make two configured roots point at the same on-disk directory.
If the configured database path already exists, it must be a regular file.
Existing database files must be writable by the service account.
The configured database path must also not be an ancestor of the attachment or
server-backup roots, because that would let directory provisioning turn the
intended SQLite file path into a directory.
Newly created production database directories are made private where POSIX
permissions are supported. Existing production database directories must already
be private; validation does not chmod an existing shared parent directory.
Direct database opening creates a missing database parent as private storage but
does not chmod an existing shared parent directory.
Operational backup, restore, and migration commands, including
`migrate-production --no-backup`, require the configured server backup root to
already exist. A missing backup root is treated as an unavailable backup
volume, not as an empty directory to create silently. Use the production config
validation command as the explicit provisioning step before first deployment.
Production migration entrypoints also require the configured database parent
directory to already exist, even when `--initialize` is used for the first
database file. The migration command may create the SQLite file; it must not
create a missing database volume parent.
Production backend startup follows the same database-parent rule before it
checks whether the database file itself exists or has pending migrations.

When using mounted storage, point `SIGNGUY_SLIM_ATTACHMENT_ROOT` and
`SIGNGUY_SLIM_SERVER_BACKUP_ROOT` at private child directories on those mounts,
not at the mount point itself. Restore needs a normal runtime directory it can
replace or preserve as an emergency copy without renaming the mounted volume.
Production validation rejects filesystem or volume roots for those directory
settings and compares existing attachment and backup roots by filesystem
identity so bind-mounted aliases cannot point both roles at the same storage.
It also rejects backup roots beneath aliases of attachment subdirectories, which
would otherwise place backup sets inside the source attachment tree.
On Linux, bind-mount comparisons translate mountinfo roots through their source
mounts before comparing paths, because mountinfo roots are relative to the
mounted filesystem rather than always namespace-absolute paths.
`SIGNGUY_SLIM_DB_PATH` must be a normal database file inside a durable
directory, not a Linux single-file bind mount, because database restore must be
able to rename the database and its SQLite sidecars during recovery.
Attachment and backup roots also may not occupy the configured database's
SQLite sidecar paths (`-wal`, `-shm`, or `-journal`), including those paths
reached through Linux bind-mount aliases of the database directory.

## Create Backups

Create a full server backup:

```powershell
npm run backend:backup:server
```

Create only a database backup:

```powershell
npm run backend:backup:database
```

Create only an attachment backup:

```powershell
npm run backend:backup:attachments
```

The full backup set contains:

```text
backup-metadata.json
database.sqlite
attachments/
attachments-manifest.json
```

`database.sqlite` is created with SQLite `VACUUM INTO`, then verified with
`PRAGMA quick_check` through an isolated temporary copy so validation cannot
leave WAL/SHM sidecars inside the immutable backup set. Attachment backup
writes a checksum manifest and verifies each copied file. Full backups also
compare active database attachment rows and accepted incoming-request
attachment rows against the copied attachment manifest so a completed backup
set cannot silently omit referenced private attachment bytes.
Attachment and full backups require the attachment source root to already exist
as a plain directory. A missing attachment root is treated as an unavailable
runtime volume, not as an empty source to recreate and back up. Production
backup commands enforce that precondition before creating a backup set. They
also require the configured backup root to already exist before publishing any
new backup set. Attachment and full backups reject backup roots nested beneath
the attachment source, including roots reached through filesystem aliases of
attachment subdirectories or Linux bind mounts sourced from attachment
subdirectories, even outside production mode, so direct helper or CLI calls
cannot recursively copy prior backup sets as attachment payload. Backup
and migration commands also refuse to proceed while a combined-restore marker
remains beside the configured database.

Server backup sets contain hosted infrastructure data for every tenant in that
deployment. The raw database can include user password hashes, session hashes,
audit records, private customer data, financial records, and all tenant
business data. Store backup sets on encrypted, access-controlled storage and do
not distribute them as customer-portable exports. The backup root and backup
set directories are created with owner-only directory permissions where the
platform supports POSIX modes, and database, metadata, manifest, and copied
attachment files are written owner-readable/writeable only.

## Retention

`SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST` controls how many completed backup sets
remain under `SIGNGUY_SLIM_SERVER_BACKUP_ROOT`. Retention deletes only completed
backup-set directories inside that root with valid SignGuy Slim server-backup
metadata and fully verified database/attachment contents for their backup type.
Partial backup directories, missing-metadata directories, malformed metadata,
checksum-corrupt sets, symlinks, and otherwise questionable data are ignored
rather than silently deleted. Set retention to `0` to disable cleanup. Values
above `10000` are rejected as configuration errors. The backup set created by
the current operation is preserved during retention cleanup even if its
wall-clock metadata sorts older than existing sets.
Blank or whitespace-only retention settings use the documented default.
Backup publication, retention candidate selection, and deletion are serialized
with a lock under the backup root so overlapping backup commands cannot delete
each other's current backup sets while enforcing the same retention limit. The
lock records an opaque owner token, host/process metadata, and an `updated_at`
heartbeat. A competing process may reclaim the lock only after the heartbeat is
stale. Lock cleanup is owner-checked, so a process that no longer owns the lock
does not remove a successor's lock; the owner stops its heartbeat and waits for
that stop to be acknowledged before deleting its lock directory. Completed
backup files and the partial set directory are flushed before publication, and
the backup root is flushed after the final rename before retention pruning
deletes older sets.

Application attachment creation uses the same durability boundary: uploaded,
annotated, intake-carried, and backup-restored attachment bytes are flushed, and
their containing directory is flushed, before the related attachment database
row is inserted or committed.
Backup sets whose database contains migration IDs unknown to the running
checkout are excluded from retention candidates because that checkout cannot
restore them.
If publication fails after the partial set is renamed, the final-named backup
set is removed instead of being left behind as a completed restore candidate.

Retention cleanup does not sanitize historical business data. Deleted
attachments, customers, orders, sessions, or other records may remain in older
server backup sets until those sets age out of both local and off-host
retention.

Local retention is not sufficient for commercial durability. The operator must
copy completed backup sets off-host or replicate the backup root to durable
external storage.

## Restore Database

Stop the application before restoring. Then run:

```powershell
npm run backend:restore:database -- --input C:\path\to\backup-set --confirm RESTORE_DATABASE
```

The restore command validates the selected backup database, preserves the
current configured database and SQLite WAL/SHM sidecars as a `.pre-restore-*`
emergency directory, and replaces the target database from the verified backup.
Stale target WAL, SHM, and rollback-journal sidecars are removed so the
restored database is not mixed with pages from the pre-restore database.
The parent directory is flushed after the old database and sidecars are moved
into the emergency directory and before the restored database is published.
Restore also verifies that the backup metadata byte size and SHA-256 still
match `database.sqlite`, so a tampered but structurally valid SQLite file is
rejected. The staged database is made owner-writable before publication so
read-only archival mode bits do not leave the restored runtime database
unusable.
Database restore also rejects unrecorded source-side SQLite sidecars next to
`database.sqlite` (`-wal`, `-shm`, or `-journal`) before opening the source
artifact. Database restore targets may not be the configured live database's
`-wal`, `-shm`, or `-journal` sidecar paths, including sidecar paths reached
through filesystem aliases or Linux bind-mount aliases of the configured
database parent. Dangling target-sidecar symlinks are treated as existing
restore targets and rejected before publication.

The effective restore target must not be inside the configured server backup
root, and it must not contain the configured server backup root. Restore input
paths are checked against both lexical and canonical backup-root paths so normal
symlinked mount ancestors work without allowing a symlink escape.
Restore targets reached through a filesystem alias of the configured backup
root are rejected by comparing existing ancestors by filesystem identity.
Database-only restore targets must also stay outside the configured live
attachment root. Before a database-only restore replaces the configured live
database, the source database's active attachment rows must match the current
live attachment root. If the attachment bytes are missing or checksum-mismatched,
use combined restore instead of publishing a database that cannot serve its
private files.
Restore also rejects database targets beneath filesystem aliases of the live
attachment root, and attachment targets that would contain the live database
through a filesystem alias of the database parent.

For a staging drill, pass `--target-db C:\path\to\fresh\signguy.sqlite` to
restore into a non-production database path.
The CLI also accepts `--target-db=C:\path\to\fresh\signguy.sqlite`; unknown
restore options are rejected before restore code runs.

## Restore Attachments

Stop the application before restoring. Then run:

```powershell
npm run backend:restore:attachments -- --input C:\path\to\backup-set --confirm RESTORE_ATTACHMENTS
```

The restore command validates `attachments-manifest.json`, copies files into a
temporary target, verifies checksums, preserves any current attachment root as a
`.pre-restore-*` emergency directory, and publishes the restored tree.
Manifest paths are verified against canonical paths and symlinked ancestors
inside archived attachment sets are rejected before bytes are hashed or copied.
The effective restore target must not overlap the configured server backup root
or point at a mounted volume root.
On Linux, restore also checks `/proc/self/mountinfo` for the target itself.
Normal child directories beneath mounted durable storage remain supported.
Dangling symlink attachment restore targets are rejected before staging, so a
restore does not replace an operator-created pointer to an unavailable volume.
Attachment restore may target the configured live attachment root exactly, but
an override target that overlaps that live root in either direction is rejected
so restore cannot rename away a parent or child directory containing live
attachments. Restore also rejects targets beneath a filesystem alias of the
configured live attachment root.
Before an attachment-only restore replaces the configured live attachment root,
the archived manifest must satisfy active attachment rows in the current live
database. This live check reads through SQLite rather than a raw main-file copy
so committed rows still present in WAL are included. Use combined restore for
point-in-time database and attachment recovery.
Restored attachment roots are staged with owner-only directory permissions on
platforms that support POSIX modes.

For a staging drill, pass `--target-attachments C:\path\to\fresh\attachments`
to restore into a non-production attachment root.

## Restore Full Server Backup

Use the combined command as the normal recovery path after validating that the
backup set is the intended recovery point:

```powershell
npm run backend:restore:server -- --input C:\path\to\backup-set --confirm RESTORE_SERVER_BACKUP
```

The combined restore accepts the same optional `--target-db` and
`--target-attachments` arguments. Blank explicit target overrides such as
`--target-attachments=` are rejected instead of being resolved to the process
working directory. It validates the database, attachment
manifest metadata checksum, attachment checksums, and database-to-attachment
coherence before publishing either restored target. The effective restore
targets must be separated so neither target contains the other and so the two
targets do not point through different filesystem aliases to the same
underlying storage. Linux bind-mount aliases are compared after translating
relative mountinfo roots through their mounted source filesystem, so staging
paths that appear separate lexically but share a mounted source tree are
rejected. Combined
restore may target the configured live database and configured live attachment
root together, or separate staging database and staging attachment paths
together. A mixed live/staging target pair is rejected. The database target also
may not be inside the configured live attachment root, and the attachment target
may not contain the configured live database file. Neither restore target may
overlap the configured server backup root. An attachment target override also
may not overlap the configured live attachment root unless it is exactly that
root. Directory aliases of the live database are treated as live database
targets for the mixed live/staging check and for live-attachment coherence
validation, but hard-linked alternate database filenames are rejected because a
rename would replace only that directory entry and not the configured live
database path. If validation fails, the live database and attachment root are
left unchanged. Before publishing either target, the combined restore writes a
durable `.signguy-slim-restore-in-progress.json`
marker beside the target database. The marker is removed only after both the
database and attachment root publish successfully. A confirmed combined restore
retry may replace a validated stale marker left by an interrupted earlier
restore by writing a temporary marker and renaming it over the stale marker.
That keeps a marker present continuously, so startup cannot pass its incomplete
restore check in the middle of a retry. An active or freshly heartbeated marker
blocks a competing restore so two operators cannot replace each other's recovery
marker. If publishing fails after the
database is replaced, the command attempts to restore the pre-restore database
emergency copy, or removes the newly published database when no pre-restore
database existed, before returning the error. The same cleanup applies when a
newly published database fails its post-rename durability sync. If the process
or host stops while the marker remains, production startup fails with
`server_restore_incomplete` instead of serving a database and attachment tree
that may not belong together.
The marker filename itself is reserved and cannot be used as the combined
restore database target.
Restore staging may create a missing target child directory as private storage,
but it does not chmod an existing parent directory such as a shared mount point
or operator-owned recovery directory. The combined restore marker follows the
same rule and does not chmod an existing database-target parent. If a
post-publication error leaves attachment rollback unconfirmed, the restore
marker remains so production startup fails instead of serving an unverified
database and attachment pair.
Database restore rollback syncs the parent directory after moving emergency
database and sidecar files back before reporting recovery confirmed.
When attachment publication fails after the previous attachment tree was moved,
rollback restores that tree and syncs the parent directory before the rollback
is treated as confirmed and the marker can be removed.

After restore:

1. run migrations;
2. start the backend;
3. complete the manual smoke test in `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`;
4. confirm the backup set is also available off-host.

## Production Migration

Production migrations should create a full server backup first:

```powershell
npm run backend:migrate:production
```

This command validates production storage, creates a full server backup, and
then runs migrations. The configured attachment source root and server backup
root must already exist as plain directories, even when `-- --no-backup` is
used; a missing attachment or backup volume is not recreated as an empty source
before migration. Use `-- --no-backup` only after an operator has already
created and verified a current backup set.

Creating the first production database is an explicit provisioning action. If
`SIGNGUY_SLIM_DB_PATH` does not exist yet, run:

```powershell
npm run backend:migrate:production -- --initialize
```

The direct migration entrypoint accepts the same guard:

```powershell
NODE_ENV=production npm run backend:migrate -- --initialize
```

Without `--initialize`, production migration fails rather than creating a new
database at a path that may represent a missing database volume.
With `--initialize`, the database file may be created but the configured
database parent directory must already exist as provisioned durable storage.

Starting the production backend directly does not apply pending migrations. If
the configured database is missing or behind the checked-in migration set, the
server exits and the operator must run `npm run backend:migrate:production` or
`NODE_ENV=production npm run backend:migrate` first, including `-- --initialize`
only for a deliberately provisioned first database. This prevents production
startup from mutating the schema without the Release A pre-migration backup
workflow. Startup also requires the configured attachment source root and
server backup root to already exist as plain directories; missing durable
volumes are not recreated as empty paths before the backend listens.
Production CLI commands other than validation additionally require the
configured database parent directory and attachment root to already exist before
backup, migration, or recovery begins, so a missing live volume is not silently
replaced by a new host-local directory.

Databases that contain migration IDs unknown to the running application are
treated as newer unsupported schemas. Production startup, production migration,
and server database restore fail fast instead of serving or downgrading those
files.

## Backup Boundaries

Server backups are operational disaster-recovery artifacts. They are not
customer-portable exports. Customer portable backups continue to be created from
the application UI/API as encrypted `.signguy-backup` files and continue to
exclude active sessions, cookies, CSRF state, and runtime secrets.

For the strongest consistency guarantee, stop or drain application traffic
before a full backup. Online full backups are verified after copying and reject
sets where the database snapshot references missing, size-mismatched, or
checksum-mismatched active attachment bytes, but concurrent attachment changes
can still force a retry.
