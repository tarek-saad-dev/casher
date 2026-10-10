# DRVO-020 — Backup / restore runbook

Scope: SQL Server database behind Casher (`last132` production, `last132_agent` staging).
Hooks live in `scripts/drvo/backupPlan.ts` (pure planner, unit-tested) and `scripts/drvo/db-backup.ts` (CLI, `npm run drvo:backup`).
The CLI is **dry-run by default** and only prints T-SQL; `--execute` is required to run anything.

## When a backup is mandatory

- Before any DRVO production migration APPLY (Production Migration Control workflow).
- Before running messaging schema migrations. Application deploy no longer runs them; they only run when the operator sets `CASHER_APPLY_MESSAGING_SCHEMA=I_HAVE_A_VERIFIED_BACKUP` for that deploy, or runs the `npm run messaging:migrate-*` scripts by hand.
- Before any manual data repair script.

## Take a backup

On the database host, with the app `.env.local` pointing at the target DB:

```bash
npm run drvo:backup -- --backup-dir=/var/opt/mssql/backup              # review the plan
npm run drvo:backup -- --backup-dir=/var/opt/mssql/backup --execute    # staging
npm run drvo:backup -- --backup-dir=/var/opt/mssql/backup --execute --allow-production   # production, operator only
```

What it runs:

```sql
BACKUP DATABASE [<db>] TO DISK = N'<dir>/<db>_<UTC timestamp>.bak' WITH COPY_ONLY, CHECKSUM, INIT, STATS = 10;
RESTORE VERIFYONLY FROM DISK = N'<file>' WITH CHECKSUM;
```

`COPY_ONLY` keeps the regular full/log backup chain intact. A backup only counts as **verified** after `RESTORE VERIFYONLY` passes **and** a restore drill (below) succeeds at least once per release train.

Copy the `.bak` off the VPS (object storage or a second host) before applying the change it protects. Record file name, size, SHA-256 and the commit SHA being deployed in the release notes.

## Restore drill (non-destructive)

Restores into a scratch database whose name must end in `_restore_check`; the hook refuses any other target, so it can never overwrite production or staging.

```bash
npm run drvo:backup -- --restore-from=/var/opt/mssql/backup/last132_<ts>.bak \
  --restore-to=last132_restore_check --data-dir=/var/opt/mssql/data --execute
```

Then point a shell at `last132_restore_check` and run `npm run drvo:verify -- --expected-database=last132_restore_check`. Spot-check row counts for `TblUser`, `TblEmp`, `TblBooking` and the latest `TblCashMove` dates against production. Drop the scratch DB when done.

## Real restore (incident)

Manual and operator-only. It is never automated by these hooks.

1. Stop writers: `systemctl stop casher messaging-worker messaging-inbox-worker messaging-ai-worker nightly-close.timer`.
2. Take a tail/`COPY_ONLY` backup of the damaged DB, so the incident state is preserved.
3. `RESTORE DATABASE [last132] FROM DISK = N'<verified .bak>' WITH CHECKSUM, REPLACE, RECOVERY;`, run as `sa` from `sqlcmd`.
4. `npm run drvo:verify -- --allow-production`, then start services and check `GET /api/health/ready` returns 200.
5. Write the incident note: backup used, data-loss window, and verification output.

## Monitoring hooks

- `GET /api/health/live` checks only that the process is up (no DB). Use it as the uptime monitor target.
- `GET /api/health/ready` returns 200 only when the DB answers `SELECT 1` and `SESSION_SECRET` is configured; otherwise 503. It never returns failure details.
- `GET /api/health/db` stays admin-only (it exposes server metadata).
