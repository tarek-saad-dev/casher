# Branch audit scripts (read-only)

These scripts inspect schema metadata and data shape. They must **never** modify data.

## Prerequisites

- Node.js with project dependencies installed (`mssql` from the repo)
- Network access to the SQL Server used by the app
- Same env vars as the app (`CLOUD_DB_*` / `LOCAL_DB_*` / `DB_*`), typically via `.env` / `.env.local`

## Safety

Allowed: `SELECT`, catalog views (`sys.tables`, `sys.indexes`, `sys.key_constraints`, …), counts, duplicate detection.

Forbidden: `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`, mutating `EXEC`.

## Scripts

| Script | Purpose |
|--------|---------|
| `01-list-tables-and-rowcounts.cjs` | List user tables + approximate row counts |
| `02-list-constraints-and-indexes.cjs` | PK / unique / FK / indexes |
| `03-branch-readiness-probes.cjs` | Probe BranchID/SalonID columns; open days; duplicate-risk SELECTs |

## How to run

From repo root (`pos-system`):

```bash
node scripts/audit-branches/01-list-tables-and-rowcounts.cjs
node scripts/audit-branches/02-list-constraints-and-indexes.cjs
node scripts/audit-branches/03-branch-readiness-probes.cjs
```

Optional target (PowerShell):

```powershell
$env:AUDIT_DB_TARGET = "cloud"   # or "local"
node scripts/audit-branches/01-list-tables-and-rowcounts.cjs
```

## Interpreting results

- Compare live unique indexes to `docs/branch-architecture-audit.md` §15.
- Confirm whether `TblNewDay.NewDay` dates duplicate in live data.
- Confirm `SalonID` population on loyalty store tables.
- Do **not** treat script output as permission to migrate.
