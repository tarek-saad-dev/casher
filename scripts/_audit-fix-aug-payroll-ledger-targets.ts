/**
 * Audit + fix August 2026 (days 1–27):
 * 1) Payroll ↔ ledger sync for all employees
 * 2) Recalculate daily targets + ledger credits
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const MONTH = '2026-08';
const FROM = '2026-08-01';
const TO = '2026-08-27';

function listDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function auditPayrollLedger(db: Awaited<ReturnType<typeof import('@/lib/db')['getPool']>>) {
  const missingLedger = await db.request().query(`
    SELECT e.EmpName, CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.DailyWage, b.BranchName, p.Status
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE p.WorkDate >= '${FROM}' AND p.WorkDate <= '${TO}'
      AND p.Status = N'Generated' AND p.DailyWage > 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
          AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
      )
    ORDER BY e.EmpName, p.WorkDate
  `);

  const attNoPay = await db.request().query(`
    SELECT e.EmpName, CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      b.BranchName, a.Status
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.WorkDate >= '${FROM}' AND a.WorkDate <= '${TO}'
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
      AND a.CheckInTime IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpDailyPayroll p
        WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
          AND p.Status = N'Generated'
      )
    ORDER BY e.EmpName, a.WorkDate
  `);

  const byEmp = await db.request().query(`
    SELECT e.EmpName,
      COUNT(DISTINCT p.WorkDate) AS PayrollDays,
      SUM(p.DailyWage) AS TotalWage,
      SUM(CASE WHEN l.ID IS NULL AND p.DailyWage > 0 THEN 1 ELSE 0 END) AS MissingLedger
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
      AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
    WHERE p.WorkDate >= '${FROM}' AND p.WorkDate <= '${TO}'
      AND p.Status = N'Generated'
    GROUP BY e.EmpName
    ORDER BY e.EmpName
  `);

  return {
    missingLedger: missingLedger.recordset,
    attNoPay: attNoPay.recordset,
    byEmp: byEmp.recordset,
  };
}

async function auditTargetLedger(db: Awaited<ReturnType<typeof import('@/lib/db')['getPool']>>) {
  const missing = await db.request().query(`
    SELECT e.EmpName, CONVERT(varchar(10), t.WorkDate, 23) AS WorkDate,
      t.TargetAmount, b.BranchName
    FROM dbo.TblEmpDailyTarget t
    JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = t.BranchID
    WHERE t.WorkDate >= '${FROM}' AND t.WorkDate <= '${TO}'
      AND t.TargetAmount > 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget')
          AND l.RefID = t.ID AND l.EntryReason = N'target' AND l.IsVoided = 0
      )
    ORDER BY e.EmpName, t.WorkDate
  `);

  const byEmp = await db.request().query(`
    SELECT e.EmpName,
      COUNT(*) AS TargetDays,
      SUM(t.TargetAmount) AS TotalTarget,
      SUM(CASE WHEN t.TargetAmount > 0 AND l.ID IS NULL THEN 1 ELSE 0 END) AS MissingLedger
    FROM dbo.TblEmpDailyTarget t
    JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget')
      AND l.RefID = t.ID AND l.EntryReason = N'target' AND l.IsVoided = 0
    WHERE t.WorkDate >= '${FROM}' AND t.WorkDate <= '${TO}'
    GROUP BY e.EmpName
    HAVING SUM(t.TargetAmount) > 0 OR SUM(CASE WHEN t.TargetAmount > 0 AND l.ID IS NULL THEN 1 ELSE 0 END) > 0
    ORDER BY e.EmpName
  `);

  return { missing: missing.recordset, byEmp: byEmp.recordset };
}

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { runEmployeeLedgerHistoricalSync } = await import(
    '@/lib/services/employeeLedgerSyncService'
  );
  const { generateEmployeeDailyTargets } = await import(
    '@/lib/payroll/employee-target/employee-daily-target-generation.service'
  );
  const { reconcileEmployeeDailyTargetLedger } = await import(
    '@/lib/payroll/employee-target/employee-daily-target-ledger-query.service'
  );

  const db = await getPool();
  const dates = listDates(FROM, TO);

  console.log('=== BEFORE ===');
  const beforePay = await auditPayrollLedger(db);
  const beforeTgt = await auditTargetLedger(db);
  console.log('Payroll missing ledger:', beforePay.missingLedger.length);
  console.log('Attendance without payroll:', beforePay.attNoPay.length);
  console.table(beforePay.byEmp);
  console.log('Target missing ledger:', beforeTgt.missing.length);
  console.table(beforeTgt.byEmp);

  console.log('\n=== SYNC PAYROLL LEDGER (Aug all employees) ===');
  const paySync = await runEmployeeLedgerHistoricalSync({
    month: MONTH,
    empId: null,
    dryRun: false,
    syncPayrollCredits: true,
    syncAdvanceDebits: false,
    createdByUserId: 10,
  });
  console.log('Payroll ledger sync:', paySync.counts);

  console.log('\n=== RECALC TARGETS 1→27 ===');
  const branchRows = await db.request().input('through', sql.Date, TO).input('from', sql.Date, FROM).query(`
    SELECT DISTINCT BranchID FROM dbo.TblEmpTargetPlan
    WHERE IsEnabled = 1
      AND EffectiveFrom <= @through
      AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
    ORDER BY BranchID
  `);
  const branchIds = branchRows.recordset.map((r: { BranchID: number }) => Number(r.BranchID));
  console.log('Target branches:', branchIds);

  let tgtFailures = 0;
  for (const workDate of dates) {
    for (const branchId of branchIds) {
      try {
        const r = await generateEmployeeDailyTargets({
          workDate,
          branchId,
          generatedByUserId: null,
          empIds: null,
        });
        if (r.totals.generated + r.totals.recalculated > 0) {
          console.log(
            `${workDate} b${branchId}: gen=${r.totals.generated} recalc=${r.totals.recalculated}`
            + ` ledger +${r.totals.ledgerInserted}/~${r.totals.ledgerUpdated}`,
          );
        }
      } catch (err) {
        tgtFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('مقفول') && !msg.includes('CLOSED')) {
          console.error(`TARGET FAIL ${workDate} b${branchId}: ${msg}`);
        }
      }
    }
  }

  console.log('\n=== TARGET LEDGER RECONCILE (repair) ===');
  const tgtReconcile = await reconcileEmployeeDailyTargetLedger(
    { year: 2026, month: 8, dryRun: false },
    10,
  );
  console.log('Target reconcile totals:', tgtReconcile.totals);
  console.log('Target reconcile repair:', tgtReconcile.repair);

  console.log('\n=== AFTER ===');
  const afterPay = await auditPayrollLedger(db);
  const afterTgt = await auditTargetLedger(db);
  console.log('Payroll missing ledger:', afterPay.missingLedger.length);
  if (afterPay.missingLedger.length) console.table(afterPay.missingLedger);
  console.log('Attendance without payroll:', afterPay.attNoPay.length);
  if (afterPay.attNoPay.length) console.table(afterPay.attNoPay.slice(0, 50));
  console.table(afterPay.byEmp);
  console.log('Target missing ledger:', afterTgt.missing.length);
  if (afterTgt.missing.length) console.table(afterTgt.missing);
  console.table(afterTgt.byEmp);

  const ok =
    afterPay.missingLedger.length === 0 &&
    afterTgt.missing.length === 0 &&
    tgtFailures === 0;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
