#!/usr/bin/env bash
# Explicit production database SCHEMA deployment only; never posts any payroll.
# Requires a separately verified off-host backup, a fresh local backup, and human confirmation.
set -euo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || { echo "STOP: run as root for SQL backup access" >&2; exit 1; }

SQLCMD=/opt/mssql-tools18/bin/sqlcmd
[[ -x "$SQLCMD" ]] || { echo "STOP: SQLCMD not found" >&2; exit 1; }
APPROVED_LOCAL_BACKUP=/var/opt/mssql/backup/last132_pre_payroll_v2_20261026T085353Z.bak
[[ -s "$APPROVED_LOCAL_BACKUP" ]] || { echo "STOP: previously verified backup not found" >&2; exit 1; }

LOCAL_HASH="$(sha256sum "$APPROVED_LOCAL_BACKUP" | awk '{print $1}')"
echo "Previously verified backup SHA-256: $LOCAL_HASH"
echo "Input the SHA-256 measured ON THE OFF-HOST COPY (not this server):"
read -r OFF_HOST_SHA < /dev/tty
OFF_HOST_SHA="$(printf %s "$OFF_HOST_SHA" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
[[ "$OFF_HOST_SHA" =~ ^[a-f0-9]{64}$ && "$OFF_HOST_SHA" == "$LOCAL_HASH" ]] ||
 { echo "STOP: verified off-host copy required. Production unchanged." >&2; exit 1; }
echo "Enter production DB name to approve schema-only deployment:"
read -r DB_CONFIRM < /dev/tty
[[ "$DB_CONFIRM" == "last132" ]] ||
 { echo "STOP: explicit production confirmation required" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION="$ROOT/db/migrations/add-payroll-agreement-v2-retroactive.sql"
[[ -s "$MIGRATION" ]] || { echo "STOP: migration file missing" >&2; exit 1; }

WORK="$(mktemp -d /tmp/payroll-prod-schema-XXXXXX)"
trap 'rm -rf "$WORK"; unset SQLCMDPASSWORD' EXIT
read -r -s -p "SQL Server password (not echoed): " SQLCMDPASSWORD < /dev/tty
echo
export SQLCMDPASSWORD

NEW_BACKUP="/var/opt/mssql/backup/last132_pre_v2_apply_$(date -u +%Y%m%dT%H%M%SZ).bak"
cat > "$WORK/backup.sql" <<SQL
:ON ERROR EXIT
SET NOCOUNT ON;
IF DB_NAME() <> N'master'
  THROW 51000,'STOP: master connection required',1;
BACKUP DATABASE [last132]
TO DISK=N'$NEW_BACKUP'
WITH COPY_ONLY,CHECKSUM,INIT,STATS=10;
GO
RESTORE VERIFYONLY FROM DISK=N'$NEW_BACKUP' WITH CHECKSUM;
GO
SQL

echo "=== Create and verify fresh production backup ==="
"$SQLCMD" -S 127.0.0.1,1433 -U sa -d master -C -I -b -t 900 -i "$WORK/backup.sql"
echo "New backup: $NEW_BACKUP"
sha256sum "$NEW_BACKUP"

cat > "$WORK/apply.sql" <<SQL
:ON ERROR EXIT
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> N'last132'
   THROW 51001,'STOP: wrong database',1;
IF COL_LENGTH(N'dbo.TblEmp',N'PayrollScope') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpBranchPayrollAudit',N'U') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpBranchPayrollPlan',N'U') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpDailyPayroll',N'U') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpLedgerEntry',N'U') IS NULL
   THROW 51002,'STOP: V1 prerequisites not ready',1;
IF OBJECT_ID(N'dbo.TblEmpPayrollAgreementRevision',N'U') IS NOT NULL
 OR COL_LENGTH(N'dbo.TblEmpDailyPayroll',N'SupersededByPayrollRevisionID') IS NOT NULL
   THROW 51003,'STOP: V2 already exists or partial migration; inspect before continuing',1;
GO
BEGIN TRANSACTION;
GO
:r $MIGRATION
GO
IF COL_LENGTH(N'dbo.TblEmpDailyPayroll',N'SupersededByPayrollRevisionID') IS NULL
 OR OBJECT_ID(N'dbo.TblEmpPayrollAgreementRevision',N'U') IS NULL
 OR NOT EXISTS (SELECT 1 FROM sys.foreign_keys
     WHERE name=N'FK_TblEmpDailyPayroll_PayrollRevision')
 OR NOT EXISTS (SELECT 1 FROM sys.indexes
     WHERE object_id=OBJECT_ID(N'dbo.TblEmpDailyPayroll')
       AND name=N'IX_TblEmpDailyPayroll_ActiveAgreement')
 THROW 51004,'STOP: V2 verification failed; transaction will roll back',1;
COMMIT TRANSACTION;
PRINT 'PAYROLL V2 PRODUCTION SCHEMA READY';
GO
SQL
echo "=== Apply reviewed Payroll V2 schema ONLY ==="
"$SQLCMD" -S 127.0.0.1,1433 -U sa -d last132 -C -I -b -t 600 -i "$WORK/apply.sql"
echo "=== PRODUCTION SCHEMA APPLY SUCCESS ==="
echo "No payroll agreement, employee wage, or ledger rows were changed by this script."
