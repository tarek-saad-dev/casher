#!/usr/bin/env npx tsx
/**
 * SELECT-only verification for Phase 4 daily-target ↔ ledger linkage.
 *
 * Usage:
 *   npx tsx scripts/verify-employee-daily-target-ledger.ts --date=2026-07-15
 *   npx tsx scripts/verify-employee-daily-target-ledger.ts --month=2026-07 --empId=12
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const workDate = arg('date');
  const month = arg('month');
  const empIdRaw = arg('empId');
  const empId = empIdRaw ? Number(empIdRaw) : null;

  if (!workDate && !month) {
    console.error('Provide --date=YYYY-MM-DD or --month=YYYY-MM');
    process.exit(2);
  }

  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  });

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget) AS dailyTarget,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry) AS ledger,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE RefType=N'TblEmpDailyTarget' AND EntryReason=N'target') AS targetLedger,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS cashMove,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll) AS dailyPayroll,
      (SELECT COUNT(*) FROM dbo.TblEmpTargetPlan WHERE IsEnabled=1) AS enabledPlans
  `);
  console.log('counts', counts.recordset[0]);

  const request = pool.request();
  const filters: string[] = [];
  if (workDate) {
    request.input('workDate', sql.Date, workDate);
    filters.push('t.WorkDate = @workDate');
  }
  if (month) {
    request.input('month', sql.NVarChar(7), month);
    filters.push('CONVERT(char(7), t.WorkDate, 126) = @month');
  }
  if (empId != null && Number.isFinite(empId)) {
    request.input('empId', sql.Int, empId);
    filters.push('t.EmpID = @empId');
  }

  const result = await request.query(`
    SELECT
      t.ID AS DailyTargetID,
      t.EmpID,
      e.EmpName,
      CONVERT(char(10), t.WorkDate, 23) AS WorkDate,
      t.TargetAmount,
      l.ID AS LedgerEntryID,
      l.EmpID AS LedgerEmpID,
      CONVERT(char(10), l.EntryDate, 23) AS LedgerEntryDate,
      l.EntryDirection,
      l.EntryReason,
      l.Amount AS LedgerAmount,
      l.RefType,
      l.RefID,
      l.PayrollMonth,
      l.CashMoveID,
      CASE
        WHEN t.TargetAmount = 0 AND l.ID IS NULL THEN N'PASS'
        WHEN t.TargetAmount > 0
          AND l.ID IS NOT NULL
          AND l.EntryDirection = N'credit'
          AND l.EntryReason = N'target'
          AND l.RefType = N'TblEmpDailyTarget'
          AND l.RefID = t.ID
          AND l.EmpID = t.EmpID
          AND CONVERT(char(10), l.EntryDate, 23) = CONVERT(char(10), t.WorkDate, 23)
          AND l.Amount = t.TargetAmount
          AND l.CashMoveID IS NULL
          AND l.IsVoided = 0
        THEN N'PASS'
        ELSE N'FAIL'
      END AS Status,
      CASE WHEN l.ID IS NULL THEN NULL ELSE (l.Amount - t.TargetAmount) END AS Difference
    FROM dbo.TblEmpDailyTarget t
    INNER JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyTarget'
     AND l.RefID = t.ID
     AND l.EntryReason = N'target'
     AND l.IsVoided = 0
    WHERE ${filters.join(' AND ')}
    ORDER BY t.EmpID, t.WorkDate, t.ID
  `);

  console.table(result.recordset);

  const fail = result.recordset.filter((r: { Status: string }) => r.Status === 'FAIL').length;
  const pass = result.recordset.filter((r: { Status: string }) => r.Status === 'PASS').length;
  console.log({ rows: result.recordset.length, pass, fail });

  if (Number(counts.recordset[0].enabledPlans) === 0 && result.recordset.length === 0) {
    console.log('VERIFICATION_BLOCKED: no enabled plans / no daily targets in scope — do not claim E2E PASS');
  }

  await pool.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
