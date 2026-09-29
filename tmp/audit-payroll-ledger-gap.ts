#!/usr/bin/env npx tsx
/**
 * Audit daily payroll vs ledger for Sep 2026 (employee 1192 + all missing).
 * Read-only — no mutations.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { isEmployeeLedgerDualWriteEnabled } = await import('../src/lib/employeeLedgerConfig');
  const { isEmpBranchWorkDayCloseEnforced } = await import('../src/lib/hr/empBranchWorkDayClose.flags');

  const empId = Number(process.argv[2] || 1192);
  const fromDate = '2026-09-01';
  const today = getCairoBusinessDate();
  const toDate = today < '2026-09-30' ? today : '2026-09-30';

  console.log(
    JSON.stringify(
      {
        empId,
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

  const rows = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('fromDate', sql.Date, fromDate)
    .input('toDate', sql.Date, toDate)
    .query(`
      ;WITH Days AS (
        SELECT CAST(@fromDate AS date) AS WorkDate
        UNION ALL
        SELECT DATEADD(day, 1, WorkDate) FROM Days WHERE WorkDate < @toDate
      ),
      Pay AS (
        SELECT
          p.ID AS PayrollID,
          p.EmpID,
          p.BranchID,
          CONVERT(varchar(10), p.WorkDate, 120) AS WorkDate,
          p.Status,
          p.DailyWage,
          p.ActualHours,
          b.BranchCode
        FROM dbo.TblEmpDailyPayroll p
        JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
        WHERE p.EmpID = @empId
          AND p.WorkDate >= @fromDate AND p.WorkDate <= @toDate
      ),
      Tgt AS (
        SELECT
          t.ID AS TargetID,
          t.EmpID,
          t.BranchID,
          CONVERT(varchar(10), t.WorkDate, 120) AS WorkDate,
          t.Status,
          t.TargetAmount,
          b.BranchCode
        FROM dbo.TblEmpDailyTarget t
        JOIN dbo.TblBranch b ON b.BranchID = t.BranchID
        WHERE t.EmpID = @empId
          AND t.WorkDate >= @fromDate AND t.WorkDate <= @toDate
          AND ISNULL(t.Status, N'') <> N'voided'
      ),
      LedWage AS (
        SELECT
          l.ID AS LedgerID,
          l.EmpID,
          l.BranchID,
          CONVERT(varchar(10), l.EntryDate, 120) AS WorkDate,
          l.Amount,
          l.RefID,
          l.IsVoided,
          b.BranchCode
        FROM dbo.TblEmpLedgerEntry l
        JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
        WHERE l.EmpID = @empId
          AND l.EntryDate >= @fromDate AND l.EntryDate <= @toDate
          AND l.EntryReason = N'hourly_wage'
      ),
      LedTarget AS (
        SELECT
          l.ID AS LedgerID,
          l.EmpID,
          l.BranchID,
          CONVERT(varchar(10), l.EntryDate, 120) AS WorkDate,
          l.Amount,
          l.RefID,
          l.IsVoided,
          b.BranchCode
        FROM dbo.TblEmpLedgerEntry l
        JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
        WHERE l.EmpID = @empId
          AND l.EntryDate >= @fromDate AND l.EntryDate <= @toDate
          AND l.EntryReason = N'target'
      ),
      CloseState AS (
        SELECT
          c.BranchID,
          CONVERT(varchar(10), c.WorkDate, 120) AS WorkDate,
          c.State
        FROM dbo.TblEmpBranchWorkDayClose c
        WHERE c.WorkDate >= @fromDate AND c.WorkDate <= @toDate
      )
      SELECT
        CONVERT(varchar(10), d.WorkDate, 120) AS workDate,
        p.BranchID AS payBranchId,
        p.BranchCode AS payBranch,
        p.PayrollID,
        p.Status AS payStatus,
        p.DailyWage,
        p.ActualHours,
        t.TargetID,
        t.BranchCode AS tgtBranch,
        t.TargetAmount,
        t.Status AS tgtStatus,
        lw.LedgerID AS wageLedgerId,
        lw.Amount AS wageLedgerAmount,
        lw.IsVoided AS wageLedgerVoided,
        lt.LedgerID AS targetLedgerId,
        lt.Amount AS targetLedgerAmount,
        cs.State AS closeState
      FROM Days d
      LEFT JOIN Pay p ON p.WorkDate = CONVERT(varchar(10), d.WorkDate, 120)
      LEFT JOIN Tgt t
        ON t.WorkDate = CONVERT(varchar(10), d.WorkDate, 120)
       AND (p.BranchID IS NULL OR t.BranchID = p.BranchID)
      LEFT JOIN LedWage lw
        ON lw.WorkDate = CONVERT(varchar(10), d.WorkDate, 120)
       AND (p.BranchID IS NULL OR lw.BranchID = p.BranchID)
       AND (p.PayrollID IS NULL OR lw.RefID = p.PayrollID OR lw.RefID IS NULL)
      LEFT JOIN LedTarget lt
        ON lt.WorkDate = CONVERT(varchar(10), d.WorkDate, 120)
       AND (t.BranchID IS NULL OR lt.BranchID = t.BranchID)
       AND (t.TargetID IS NULL OR lt.RefID = t.TargetID OR lt.RefID IS NULL)
      LEFT JOIN CloseState cs
        ON p.BranchID IS NOT NULL
       AND cs.BranchID = p.BranchID
       AND cs.WorkDate = CONVERT(varchar(10), d.WorkDate, 120)
      ORDER BY d.WorkDate
      OPTION (MAXRECURSION 40)
    `);

  const comparison = (rows.recordset as Array<Record<string, unknown>>).map((r) => {
    const dailyWage = r.DailyWage != null ? Number(r.DailyWage) : 0;
    const dailyPayrollExists = r.PayrollID != null;
    const targetExists = r.TargetID != null;
    const payStatus = r.payStatus != null ? String(r.payStatus) : null;
    const ledgerExpected =
      dailyPayrollExists &&
      payStatus === 'Generated' &&
      dailyWage > 0;
    const ledgerExists =
      r.wageLedgerId != null && !(r.wageLedgerVoided === true || r.wageLedgerVoided === 1);

    let missingReason: string | null = null;
    if (!dailyPayrollExists) missingReason = 'no_daily_payroll';
    else if (payStatus !== 'Generated') missingReason = `payroll_status_${payStatus}`;
    else if (!(dailyWage > 0)) missingReason = 'zero_or_null_wage';
    else if (ledgerExpected && !ledgerExists) {
      missingReason =
        r.closeState === 'CLOSED'
          ? 'missing_ledger_while_day_was_closed'
          : 'missing_ledger_expected_hourly_wage';
    }

    return {
      date: String(r.workDate),
      branch: r.payBranch ?? r.tgtBranch ?? null,
      dailyPayrollExists,
      targetExists,
      ledgerExpected,
      ledgerExists,
      missingReason,
      dailyWage,
      payStatus,
      targetAmount: r.TargetAmount != null ? Number(r.TargetAmount) : null,
      closeState: r.closeState ?? null,
      wageLedgerId: r.wageLedgerId ?? null,
      targetLedgerExists: r.targetLedgerId != null,
    };
  });

  console.log('\n=== EMP DAY COMPARISON ===');
  console.log(
    'date | branch | dailyPayrollExists | targetExists | ledgerExpected | ledgerExists | missingReason',
  );
  for (const row of comparison) {
    console.log(
      [
        row.date,
        row.branch ?? '—',
        row.dailyPayrollExists,
        row.targetExists,
        row.ledgerExpected,
        row.ledgerExists,
        row.missingReason ?? 'ok',
      ].join(' | '),
    );
  }

  // All employees: Generated payroll missing hourly_wage ledger in range
  const missingAll = await db
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
        p.DailyWage AS dailyWage,
        p.Status AS payStatus,
        c.State AS closeState
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      LEFT JOIN dbo.TblEmpBranchWorkDayClose c
        ON c.BranchID = p.BranchID AND c.WorkDate = p.WorkDate
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
      ORDER BY p.WorkDate, b.BranchCode, e.EmpName
    `);

  console.log(`\n=== ALL MISSING hourly_wage LEDGER (Generated wage>0) count=${missingAll.recordset.length}`);
  const byEmp = new Map<number, number>();
  for (const r of missingAll.recordset as Array<{ empId: number }>) {
    byEmp.set(r.empId, (byEmp.get(r.empId) ?? 0) + 1);
  }
  console.log(
    'byEmp',
    [...byEmp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([id, n]) => ({ empId: id, missing: n })),
  );

  const fs = await import('fs');
  const out = path.join(__dirname, '..', 'tmp', `ledger-gap-audit-${fromDate}_${toDate}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        empId,
        fromDate,
        toDate,
        dualWriteEnabled: isEmployeeLedgerDualWriteEnabled(),
        closeEnforced: isEmpBranchWorkDayCloseEnforced(),
        comparison,
        missingAll: missingAll.recordset,
        missingAllCount: missingAll.recordset.length,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nwrote ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
