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
before accepting requests.

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
`PRAGMA quick_check`. Attachment backup writes a checksum manifest and verifies
each copied file. Full backups also compare active database attachment rows
against the copied attachment manifest so a completed backup set cannot silently
omit referenced private attachment bytes.

Server backup sets contain hosted infrastructure data for every tenant in that
deployment. The raw database can include user password hashes, session hashes,
audit records, private customer data, financial records, and all tenant
business data. Store backup sets on encrypted, access-controlled storage and do
not distribute them as customer-portable exports.

## Retention

`SIGNGUY_SLIM_SERVER_BACKUP_RETAIN_LAST` controls how many completed backup sets
remain under `SIGNGUY_SLIM_SERVER_BACKUP_ROOT`. Retention deletes only completed
backup-set directories inside that root with valid SignGuy Slim server-backup
metadata. Partial backup directories, missing-metadata directories, malformed
metadata, symlinks, and otherwise questionable data are ignored rather than
silently deleted. Set retention to `0` to disable cleanup. Values above `10000`
are rejected as configuration errors.

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
Stale target WAL/SHM sidecars are removed so the restored database is not mixed
with pages from the pre-restore database.

For a staging drill, pass `--target-db C:\path\to\fresh\signguy.sqlite` to
restore into a non-production database path.

## Restore Attachments

Stop the application before restoring. Then run:

```powershell
npm run backend:restore:attachments -- --input C:\path\to\backup-set --confirm RESTORE_ATTACHMENTS
```

The restore command validates `attachments-manifest.json`, copies files into a
temporary target, verifies checksums, preserves any current attachment root as a
`.pre-restore-*` emergency directory, and publishes the restored tree.

For a staging drill, pass `--target-attachments C:\path\to\fresh\attachments`
to restore into a non-production attachment root.

## Restore Full Server Backup

Use the combined command as the normal recovery path after validating that the
backup set is the intended recovery point:

```powershell
npm run backend:restore:server -- --input C:\path\to\backup-set --confirm RESTORE_SERVER_BACKUP
```

The combined restore accepts the same optional `--target-db` and
`--target-attachments` arguments. It validates the database, attachment
manifest, attachment checksums, and database-to-attachment coherence before
publishing either restored target. If validation fails, the live database and
attachment root are left unchanged. If publishing fails after the database is
replaced, the command attempts to restore the pre-restore database emergency
copy before returning the error.

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
then runs migrations. Use `-- --no-backup` only after an operator has already
created and verified a current backup set.

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
