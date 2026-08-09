#!/usr/bin/env npx tsx
/**
 * Regenerate daily payroll for a date range (all active branches).
 * Skips days that are PostedToCashMove; skips branches with incomplete attendance.
 *
 * Usage:
 *   npx tsx scripts/regen-daily-payroll-range.ts [fromYYYY-MM-DD] [toYYYY-MM-DD] [--force]
 *   npx tsx scripts/regen-daily-payroll-range.ts 2026-08-01 2026-08-08
 *   --force  skip attendance completeness gate (still skips Posted days)
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayLocalYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function monthStartYmd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const day = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dateArgs = args.filter((a) => DATE_RE.test(a));
  const from = dateArgs[0] ?? monthStartYmd();
  const to = dateArgs[1] ?? todayLocalYmd();

  const { getPool, sql } = await import('@/lib/db');
  const { listActiveBranches } = await import('@/lib/branch');
  const {
    countPostedDailyPayroll,
    validateDailyPayrollAttendance,
  } = await import('@/lib/payroll/dailyPayrollGenerateCore');
  const { runDailyPayrollGenerateWithOptionalLedger } =
    await import('@/lib/services/employeeLedgerDualWrite');

  const db = await getPool();
  const branches = await listActiveBranches();
  const dates = eachDateInclusive(from, to);

  console.log(
    `Regenerating daily payroll ${from} → ${to} (${dates.length} days, ${branches.length} branches)${force ? ' [force]' : ''}`,
  );

  const omarBefore = await db
    .request()
    .input('from', sql.Date, from)
    .input('to', sql.Date, to)
    .query(`
      SELECT
        e.EmpID, e.EmpName,
        p.WorkDate, p.BranchID, p.HourlyRateSnapshot, p.DailyWage, p.ActualHours, p.Status
      FROM dbo.TblEmp e
      INNER JOIN dbo.TblEmpDailyPayroll p ON p.EmpID = e.EmpID
      WHERE (e.EmpName LIKE N'%عمر%' OR e.EmpName LIKE N'%Omar%')
        AND p.WorkDate >= @from AND p.WorkDate <= @to
      ORDER BY e.EmpID, p.WorkDate, p.BranchID
    `);
  console.log('Omar BEFORE:', JSON.stringify(omarBefore.recordset, null, 2));

  const plans = await db.request().query(`
    SELECT e.EmpID, e.EmpName, bp.BranchID, bp.PayType, bp.HourlyRate, bp.DailyRate,
           bp.EffectiveFrom, bp.EffectiveTo, bp.IsActive, bp.PlanID
    FROM dbo.TblEmpBranchPayrollPlan bp
    JOIN dbo.TblEmp e ON e.EmpID = bp.EmpID
    WHERE e.EmpName LIKE N'%عمر%' OR e.EmpName LIKE N'%Omar%'
    ORDER BY e.EmpID, bp.BranchID, bp.EffectiveFrom DESC
  `);
  console.log('Omar plans:', JSON.stringify(plans.recordset, null, 2));

  for (const workDate of dates) {
    for (const branch of branches) {
      const postedCount = await countPostedDailyPayroll(db, workDate, branch.branchId);
      if (postedCount > 0) {
        console.log(`SKIP posted ${workDate} ${branch.branchCode} (#${branch.branchId}) postedRows=${postedCount}`);
        continue;
      }

      if (!force) {
        const { missing } = await validateDailyPayrollAttendance(db, workDate, {
          branchId: branch.branchId,
        });
        if (missing.length > 0) {
          console.log(
            `SKIP incomplete ${workDate} ${branch.branchCode}: ${missing.map((m) => `${m.empName}:${m.reason}`).join(', ')}`,
          );
          continue;
        }
      }

      try {
        const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
          notesPrefix: `[RegenRange][${branch.branchCode}] `,
          branchId: branch.branchId,
        });
        console.log(
          `OK ${workDate} ${branch.branchCode}: generated=${result.generatedCount} hours=${result.totalHours} wage=${result.totalWage} ledger=${JSON.stringify(ledgerSync ?? null)}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`FAIL ${workDate} ${branch.branchCode}: ${msg}`);
      }
    }
  }

  const omarAfter = await db
    .request()
    .input('from', sql.Date, from)
    .input('to', sql.Date, to)
    .query(`
      SELECT
        e.EmpID, e.EmpName,
        p.WorkDate, p.BranchID, p.HourlyRateSnapshot, p.DailyWage, p.ActualHours, p.Status, p.Notes
      FROM dbo.TblEmp e
      INNER JOIN dbo.TblEmpDailyPayroll p ON p.EmpID = e.EmpID
      WHERE (e.EmpName LIKE N'%عمر%' OR e.EmpName LIKE N'%Omar%')
        AND p.WorkDate >= @from AND p.WorkDate <= @to
      ORDER BY e.EmpID, p.WorkDate, p.BranchID
    `);
  console.log('Omar AFTER:', JSON.stringify(omarAfter.recordset, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
