#!/usr/bin/env bash
# Safe replay of Ziad's payroll change on a new, isolated production snapshot.
set -euo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo "STOP: root required for local SQLCMD and backup" >&2; exit 1; }
[[ "$PAYROLL_E2E_ALLOW_WRITE" == "isolated-clone" ]] || { echo "STOP: explicit clone-write opt-in required" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
[[ -x "$SQLCMD" ]] || { echo "STOP: sqlcmd 18 missing" >&2; exit 1; }
[[ -d /var/opt/mssql/data && -d /var/opt/mssql/backup ]] || { echo "STOP: SQL Server storage not found" >&2; exit 1; }
AVAILABLE_KB="$(df -Pk /var/opt/mssql | awk 'NR==2 {print $4}')"
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ && "$AVAILABLE_KB" -ge 1048576 ]] || { echo "STOP: less than 1 GB free" >&2; exit 1; }

umask 077
WORK="$(mktemp -d /tmp/payroll-ziad-clone-XXXXXX)"
trap 'rm -rf "$WORK"; unset SQLCMDPASSWORD' EXIT
CLONE=last132_payroll_rehearsal
BACKUP="/var/opt/mssql/backup/ziad_production_copy_$(date -u +%Y%m%dT%H%M%SZ).bak"
read -rs -p "SQL Server sa password: " SQLCMDPASSWORD
echo
export SQLCMDPASSWORD

cat > "$WORK/restore.sql" <<SQL
:ON ERROR EXIT
SET NOCOUNT ON;
IF DB_NAME() <> N'master'
    THROW 51000,'STOP: master required',1;
IF DB_ID(N'$CLONE') IS NOT NULL
    THROW 51001,'STOP: rehearsal clone already exists; never overwrite',1;
IF DB_ID(N'last132') IS NULL
    THROW 51002,'STOP: production database unavailable',1;
GO
BACKUP DATABASE [last132]
TO DISK=N'$BACKUP'
WITH COPY_ONLY,CHECKSUM,INIT,STATS=10;
GO
RESTORE VERIFYONLY FROM DISK=N'$BACKUP' WITH CHECKSUM;
GO
RESTORE DATABASE [$CLONE] FROM DISK=N'$BACKUP'
WITH MOVE N'last132' TO N'/var/opt/mssql/data/$CLONE.mdf',
     MOVE N'last132_log' TO N'/var/opt/mssql/data/$CLONE-log.ldf',
     RECOVERY,STATS=10;
GO
IF DB_ID(N'$CLONE') IS NULL
    THROW 51003,'STOP: restore failed',1;
PRINT 'ISOLATED REHEARSAL CLONE: READY';
GO
SQL

echo "=== Clone current production into NEW isolated database ==="
"$SQLCMD" -S 127.0.0.1,1433 -U sa -d master -C -I -b -t 900 -i "$WORK/restore.sql"

cat > "$WORK/preflight.sql" <<'SQL'
:ON ERROR EXIT
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_payroll_rehearsal'
    THROW 51010,'STOP: NOT THE REHEARSAL DATABASE',1;
IF COL_LENGTH(N'dbo.TblEmp',N'PayrollScope') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpBranchPayrollAudit',N'U') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpBranchPayrollPlan',N'U') IS NULL
    THROW 51011,'STOP: VIP V1 schema missing in production snapshot',1;
PRINT 'VIP V1 CLONE: READY';
GO
SQL
"$SQLCMD" -S 127.0.0.1,1433 -U sa -d "$CLONE" -C -I -b -t 120 -i "$WORK/preflight.sql"

python3 - "$ROOT/db/migrations/add-payroll-agreement-v2-retroactive.sql" "$WORK/v2.sql" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text()
old="IF DB_NAME() NOT IN (N'last132', N'last132_agent')"
if src.count(old)!=1:
    raise SystemExit("STOP: unexpected V2 migration guard")
Path(sys.argv[2]).write_text(src.replace(old,"IF DB_NAME() <> N'last132_payroll_rehearsal'"))
PY

{
  cat <<'SQL'
:ON ERROR EXIT
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> N'last132_payroll_rehearsal'
    THROW 51012,'STOP: wrong V2 schema target',1;
GO
SQL
  cat "$WORK/v2.sql"
} > "$WORK/run-v2.sql"

echo "=== Apply V2 migration only on the cloned database ==="
"$SQLCMD" -S 127.0.0.1,1433 -U sa -d "$CLONE" -C -I -b -t 300 -i "$WORK/run-v2.sql"

# Only the isolated worktree receives this node_modules symlink.
[[ -e "$ROOT/node_modules" ]] || ln -s /home/casher/app/node_modules "$ROOT/node_modules"
cd "$ROOT"
echo "=== App-level preview, apply, ledger/cash reconciliation and idempotent retry ==="
PAYROLL_E2E_ENV_DIR=/home/casher/app \
PAYROLL_E2E_ALLOW_WRITE=isolated-clone \
NODE_OPTIONS="--conditions=react-server" \
./node_modules/.bin/tsx --tsconfig "$ROOT/tsconfig.json" scripts/payroll/qa-ziad-retroactive-clone.ts

echo "PAYROLL REHEARSAL PASSED; last132 and last132_agent were not modified."
echo "Retained backup: $BACKUP"
