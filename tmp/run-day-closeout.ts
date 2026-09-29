#!/usr/bin/env npx tsx
/**
 * Close out 2026-09-17: attendance defaults → daily payroll → targets → ledger.
 * No WhatsApp. No force CLOSED state (close lock disabled).
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const WORK_DATE = process.argv[2] || '2026-09-17';

async function main() {
  const { runNightlyClose } = await import('../src/lib/hr/nightly-close.service');
  const { syncHourlyWageLedgerForWorkDate } = await import(
    '../src/lib/services/employeeLedgerDualWrite'
  );
  const { listActiveBranches } = await import('../src/lib/branch');
  const { getPool, sql } = await import('../src/lib/db');

  console.log(JSON.stringify({ action: 'day-closeout', workDate: WORK_DATE, skipWhatsApp: true }, null, 2));

  const result = await runNightlyClose({
    workDate: WORK_DATE,
    dryRun: false,
    skipWhatsApp: true,
  });

  const db = await getPool();
  const branches = await listActiveBranches();
  const heal: Array<Record<string, unknown>> = [];
  for (const b of branches) {
    try {
      const h = await syncHourlyWageLedgerForWorkDate(db, WORK_DATE, undefined, b.branchId);
      heal.push({ branch: b.branchCode, branchId: b.branchId, ...h });
    } catch (e: unknown) {
      heal.push({
        branch: b.branchCode,
        branchId: b.branchId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const gap = await db
    .request()
    .input('d', sql.Date, WORK_DATE)
    .query(`
      SELECT
        b.BranchCode AS branchCode,
        e.EmpName AS empName,
        e.EmpID AS empId,
        CAST(p.DailyWage AS float) AS dailyWage,
        p.ID AS payrollId
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.WorkDate = @d
        AND p.Status = N'Generated'
        AND p.DailyWage > 0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll'
            AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage'
            AND ISNULL(l.IsVoided, 0) = 0
        )
      ORDER BY b.BranchCode, e.EmpName
    `);

  const paySummary = await db
    .request()
    .input('d', sql.Date, WORK_DATE)
    .query(`
      SELECT b.BranchCode AS branchCode,
        COUNT(*) AS payrollRows,
        SUM(CASE WHEN p.DailyWage > 0 THEN 1 ELSE 0 END) AS withWage,
        SUM(CAST(p.DailyWage AS float)) AS totalWage
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.WorkDate = @d AND p.Status = N'Generated'
      GROUP BY b.BranchCode
      ORDER BY b.BranchCode
    `);

  const report = {
    workDate: WORK_DATE,
    ok: result.ok,
    errors: result.errors,
    attendanceFilled: result.steps.attendanceClose?.filled?.length ?? 0,
    attendanceSkippedNoDefault: result.steps.attendanceClose?.skippedNoDefault?.length ?? 0,
    remainingMissing: result.steps.attendanceClose?.remainingMissing ?? [],
    payroll: result.steps.payroll,
    targets: result.steps.targets,
    heal,
    payrollByBranch: paySummary.recordset,
    missingLedgerAfter: gap.recordset,
    missingLedgerCount: gap.recordset.length,
  };

  const out = path.join(__dirname, `day-closeout-${WORK_DATE}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
