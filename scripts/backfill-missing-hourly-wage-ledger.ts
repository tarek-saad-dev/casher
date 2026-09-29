#!/usr/bin/env npx tsx
/**
 * Idempotent backfill: hourly_wage ledger rows for Generated daily payroll
 * that are missing ledger entries (Sep month-to-today by default).
 *
 * Uses syncHourlyWageLedgerForWorkDate only — no payroll formula changes.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { syncHourlyWageLedgerForWorkDate } =
    await import('../src/lib/services/employeeLedgerDualWrite');
  const { isEmployeeLedgerDualWriteEnabled } = await import('../src/lib/employeeLedgerConfig');
  const { isEmpBranchWorkDayCloseEnforced } = await import('../src/lib/hr/empBranchWorkDayClose.flags');

  const fromDate = '2026-09-01';
  const today = getCairoBusinessDate();
  const toDate = today < '2026-09-30' ? today : '2026-09-30';

  console.log(
    JSON.stringify(
      {
        fromDate,
        toDate,
        dualWriteEnabled: isEmployeeLedgerDualWriteEnabled(),
        closeEnforced: isEmpBranchWorkDayCloseEnforced(),
      },
      null,
      2,
    ),
  );

  const db = await getPool();

  const missingBefore = await db
    .request()
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT
        CONVERT(varchar(10), p.WorkDate, 120) AS workDate,
        p.EmpID AS empId,
        e.EmpName AS empName,
        p.BranchID AS branchId,
        b.BranchCode AS branchCode,
        p.ID AS payrollId,
        CAST(p.DailyWage AS float) AS dailyWage
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.WorkDate >= @fromDate AND p.WorkDate <= @toDate
        AND p.Status = N'Generated'
        AND p.DailyWage > 0
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll'
            AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage'
            AND ISNULL(l.IsVoided, 0) = 0
        )
      ORDER BY p.WorkDate, p.BranchID, p.EmpID
    `);

  const missingRows = missingBefore.recordset as Array<{
    workDate: string;
    empId: number;
    empName: string;
    branchId: number;
    branchCode: string;
    payrollId: number;
    dailyWage: number;
  }>;

  console.log(`missingBefore=${missingRows.length}`);

  const dayBranchKeys = [
    ...new Map(
      missingRows.map((r) => [`${r.workDate}|${r.branchId}`, { workDate: r.workDate, branchId: r.branchId, branchCode: r.branchCode }]),
    ).values(),
  ].sort((a, b) =>
    a.workDate === b.workDate ? a.branchId - b.branchId : a.workDate.localeCompare(b.workDate),
  );

  const syncTotals = { inserted: 0, updated: 0, voided: 0, skipped: 0 };
  const dayResults: Array<Record<string, unknown>> = [];

  for (const key of dayBranchKeys) {
    try {
      const sync = await syncHourlyWageLedgerForWorkDate(
        db,
        key.workDate,
        undefined,
        key.branchId,
      );
      syncTotals.inserted += sync.inserted;
      syncTotals.updated += sync.updated;
      syncTotals.voided += sync.voided;
      syncTotals.skipped += sync.skipped;
      dayResults.push({ ...key, ok: true, ...sync });
      console.log(
        `[backfill] ${key.workDate} ${key.branchCode} inserted=${sync.inserted} updated=${sync.updated} skipped=${sync.skipped}`,
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      dayResults.push({ ...key, ok: false, error: reason });
      console.error(`[backfill] FAIL ${key.workDate} ${key.branchCode}: ${reason}`);
    }
  }

  const missingAfter = await db
    .request()
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate >= @fromDate AND p.WorkDate <= @toDate
        AND p.Status = N'Generated'
        AND p.DailyWage > 0
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll'
            AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage'
            AND ISNULL(l.IsVoided, 0) = 0
        )
    `);

  const stillMissing = Number((missingAfter.recordset[0] as { Cnt: number }).Cnt ?? 0);
  const emp1192After = await db
    .request()
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      SELECT
        CONVERT(varchar(10), p.WorkDate, 120) AS workDate,
        CAST(p.DailyWage AS float) AS dailyWage,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage' AND ISNULL(l.IsVoided,0)=0
        ) THEN 1 ELSE 0 END AS hasLedger
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.EmpID = 1192
        AND p.WorkDate >= @fromDate AND p.WorkDate <= @toDate
        AND p.Status = N'Generated' AND p.DailyWage > 0
      ORDER BY p.WorkDate
    `);

  const report = {
    fromDate,
    toDate,
    missingBefore: missingRows.length,
    affectedEmployees: [...new Set(missingRows.map((r) => r.empId))].sort((a, b) => a - b),
    dayBranchKeysProcessed: dayBranchKeys.length,
    syncTotals,
    stillMissing,
    safelyBackfilledEstimate: Math.max(0, missingRows.length - stillMissing),
    emp1192After: emp1192After.recordset,
    dayResults,
    missingSampleBefore: missingRows.slice(0, 20),
  };

  const out = path.join(__dirname, '..', 'tmp', `ledger-backfill-${fromDate}_${toDate}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(JSON.stringify({
    missingBefore: report.missingBefore,
    syncTotals: report.syncTotals,
    stillMissing: report.stillMissing,
    safelyBackfilledEstimate: report.safelyBackfilledEstimate,
    affectedEmployees: report.affectedEmployees,
  }, null, 2));
  console.log(`wrote ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
