#!/usr/bin/env npx tsx
/**
 * Verify (and optionally heal) attendance + payroll + ledger for specific dates.
 *
 * Usage:
 *   npx tsx scripts/verify-and-heal-payroll-days.ts 2026-08-28 2026-08-30
 *   npx tsx scripts/verify-and-heal-payroll-days.ts 2026-08-28 2026-08-30 --fix
 *
 * --fix  → nightly close (D fill + payroll + targets + ledger heal), no WhatsApp
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

type AuditResult = {
  attIncomplete: unknown[];
  attNoPay: unknown[];
  payMissingLedger: unknown[];
  tgtMissingLedger: unknown[];
  summary: unknown[];
};

async function auditDate(
  db: Awaited<ReturnType<typeof import('@/lib/db')['getPool']>>,
  date: string,
): Promise<AuditResult> {
  const attIncomplete = (
    await db.request().input('d', date).query(`
      SELECT b.BranchName, e.EmpName, a.Status,
        CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut
      FROM dbo.TblEmpAttendance a
      JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE a.WorkDate = @d
        AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
        AND (a.CheckInTime IS NULL OR a.CheckOutTime IS NULL)
      ORDER BY b.BranchName, e.EmpName
    `)
  ).recordset;

  const attNoPay = (
    await db.request().input('d', date).query(`
      SELECT b.BranchName, e.EmpName, a.Status,
        CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut
      FROM dbo.TblEmpAttendance a
      JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE a.WorkDate = @d
        AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
        AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpDailyPayroll p
          WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
            AND p.Status = N'Generated'
        )
      ORDER BY b.BranchName, e.EmpName
    `)
  ).recordset;

  const payMissingLedger = (
    await db.request().input('d', date).query(`
      SELECT b.BranchName, e.EmpName, p.DailyWage, p.Status AS PayrollStatus
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.WorkDate = @d
        AND p.Status = N'Generated' AND p.DailyWage > 0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
        )
      ORDER BY b.BranchName, e.EmpName
    `)
  ).recordset;

  const tgtMissingLedger = (
    await db.request().input('d', date).query(`
      SELECT b.BranchName, e.EmpName, t.TargetAmount
      FROM dbo.TblEmpDailyTarget t
      JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = t.BranchID
      WHERE t.WorkDate = @d AND t.TargetAmount > 0 AND t.Status <> N'voided'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget')
            AND l.RefID = t.ID AND l.EntryReason = N'target' AND l.IsVoided = 0
        )
      ORDER BY b.BranchName, e.EmpName
    `)
  ).recordset;

  const summary = (
    await db.request().input('d', date).query(`
      SELECT
        b.BranchName,
        (SELECT COUNT(*) FROM dbo.TblEmpAttendance a
         WHERE a.BranchID = b.BranchID AND a.WorkDate = @d
           AND a.Status IN (N'Present', N'Late', N'EarlyLeave')) AS PresentLike,
        (SELECT COUNT(*) FROM dbo.TblEmpAttendance a
         WHERE a.BranchID = b.BranchID AND a.WorkDate = @d
           AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
           AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL) AS AttComplete,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
         WHERE p.BranchID = b.BranchID AND p.WorkDate = @d AND p.Status = N'Generated') AS PayrollGen,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
         WHERE p.BranchID = b.BranchID AND p.WorkDate = @d AND p.Status = N'Generated'
           AND p.DailyWage > 0
           AND EXISTS (
             SELECT 1 FROM dbo.TblEmpLedgerEntry l
             WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
               AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
           )) AS PayrollLedger,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget t
         WHERE t.BranchID = b.BranchID AND t.WorkDate = @d AND t.TargetAmount > 0
           AND t.Status <> N'voided') AS TargetRows,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget t
         WHERE t.BranchID = b.BranchID AND t.WorkDate = @d AND t.TargetAmount > 0
           AND t.Status <> N'voided'
           AND EXISTS (
             SELECT 1 FROM dbo.TblEmpLedgerEntry l
             WHERE l.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget')
               AND l.RefID = t.ID AND l.EntryReason = N'target' AND l.IsVoided = 0
           )) AS TargetLedger
      FROM dbo.TblBranch b
      WHERE b.IsActive = 1
      ORDER BY b.BranchID
    `)
  ).recordset;

  return { attIncomplete, attNoPay, payMissingLedger, tgtMissingLedger, summary };
}

function printAudit(date: string, audit: AuditResult): boolean {
  console.log('\n' + '='.repeat(72));
  console.log(`DATE: ${date}`);
  console.log('='.repeat(72));

  const issues =
    audit.attIncomplete.length +
    audit.attNoPay.length +
    audit.payMissingLedger.length +
    audit.tgtMissingLedger.length;

  console.log('\n--- Per-branch summary ---');
  console.table(audit.summary);

  if (audit.attIncomplete.length) {
    console.log('\n❌ Attendance incomplete (Present/Late missing times):');
    console.table(audit.attIncomplete);
  }
  if (audit.attNoPay.length) {
    console.log('\n❌ Complete attendance but no Generated payroll:');
    console.table(audit.attNoPay);
  }
  if (audit.payMissingLedger.length) {
    console.log('\n❌ Payroll Generated but missing hourly_wage ledger:');
    console.table(audit.payMissingLedger);
  }
  if (audit.tgtMissingLedger.length) {
    console.log('\n❌ Target > 0 but missing target ledger:');
    console.table(audit.tgtMissingLedger);
  }

  if (issues === 0) {
    console.log('\n✅ OK — attendance complete, payroll + ledger aligned for this day.');
  } else {
    console.log(`\n⚠️  ${issues} issue row(s) need attention.`);
  }

  return issues === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const dateArgs = args.filter((a) => DATE_RE.test(a));
  const from = dateArgs[0] ?? '2026-08-28';
  const to = dateArgs[1] ?? dateArgs[0] ?? '2026-08-30';
  const dates = eachDateInclusive(from, to);

  const { getPool, closePool } = await import('@/lib/db');
  const db = await getPool();

  console.log(`Audit ${from} → ${to} (${dates.length} days)${fix ? ' [FIX MODE]' : ''}`);

  let allOk = true;
  for (const date of dates) {
    const audit = await auditDate(db, date);
    const ok = printAudit(date, audit);
    if (!ok) allOk = false;
  }

  if (!fix) {
    if (!allOk) {
      console.log('\nRun with --fix to apply D-fill + payroll + targets + ledger heal.');
      await closePool();
      process.exit(1);
    }
    await closePool();
    return;
  }

  console.log('\n' + '#'.repeat(72));
  console.log('FIX: nightly close (skip WhatsApp) for each day');
  console.log('#'.repeat(72));

  const { runNightlyClose } = await import('@/lib/hr/nightly-close.service');
  for (const date of dates) {
    console.log(`\n>>> nightly-close ${date}`);
    const result = await runNightlyClose({
      workDate: date,
      dryRun: false,
      skipWhatsApp: true,
    });
    console.log(
      `attendance filled=${result.steps.attendanceClose?.filled?.length ?? 0} payroll=${result.steps.payroll?.status} targets gen=${result.steps.targets?.generated ?? 0}`,
    );
    if (result.errors.length) {
      console.log('errors:', result.errors);
      allOk = false;
    }
  }

  const month = from.slice(0, 7);
  console.log('\n>>> payroll ledger historical sync', month);
  const { runEmployeeLedgerHistoricalSync } = await import(
    '@/lib/services/employeeLedgerSyncService'
  );
  const sync = await runEmployeeLedgerHistoricalSync({
    month,
    empId: null,
    dryRun: false,
    syncPayrollCredits: true,
    syncAdvanceDebits: false,
    createdByUserId: 10,
  });
  console.log('ledger sync counts:', sync.counts);

  console.log('\n>>> target ledger reconcile', month);
  const { reconcileEmployeeDailyTargetLedger } = await import(
    '@/lib/payroll/employee-target/employee-daily-target-ledger-query.service'
  );
  const tgtReconcile = await reconcileEmployeeDailyTargetLedger(
    { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)), dryRun: false },
    10,
  );
  console.log('target reconcile:', tgtReconcile.totals, tgtReconcile.repair);

  console.log('\n' + '#'.repeat(72));
  console.log('RE-AUDIT');
  console.log('#'.repeat(72));

  allOk = true;
  for (const date of dates) {
    const audit = await auditDate(db, date);
    const ok = printAudit(date, audit);
    if (!ok) allOk = false;
  }

  await closePool();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { closePool } = await import('@/lib/db');
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
