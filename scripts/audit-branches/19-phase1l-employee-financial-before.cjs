/**
 * Phase 1L — employee financial before fingerprint (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, database } = await connectReadOnly();
  if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);
  const q = async (t) => (await pool.request().query(t)).recordset;

  const branches = await q(
    `SELECT BranchID, BranchCode, IsActive FROM dbo.TblBranch ORDER BY BranchID`,
  );

  const payroll = (await q(`
    SELECT COUNT(*) AS rows,
           COUNT(DISTINCT EmpID) AS employees,
           ISNULL(SUM(CAST(DailyWage AS DECIMAL(18,4))),0) AS wageSum,
           ISNULL(SUM(CAST(ActualHours AS DECIMAL(18,4))),0) AS hoursSum,
           MIN(WorkDate) AS minDate,
           MAX(WorkDate) AS maxDate
    FROM dbo.TblEmpDailyPayroll
  `))[0];

  const payrollByStatus = await q(`
    SELECT Status, COUNT(*) AS c, ISNULL(SUM(CAST(DailyWage AS DECIMAL(18,4))),0) AS wageSum
    FROM dbo.TblEmpDailyPayroll GROUP BY Status
  `);

  const payrollDup = await q(`
    SELECT EmpID, WorkDate, COUNT(*) AS c
    FROM dbo.TblEmpDailyPayroll GROUP BY EmpID, WorkDate HAVING COUNT(*) > 1
  `);

  const hasPayBranch = (
    await q(`
      SELECT COUNT(*) AS c FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll') AND name = N'BranchID'
    `)
  )[0].c;

  const ledger = (await q(`
    SELECT COUNT(*) AS rows,
           COUNT(DISTINCT EmpID) AS employees,
           ISNULL(SUM(CASE WHEN EntryDirection = N'credit' AND IsVoided = 0 THEN CAST(Amount AS DECIMAL(18,4)) ELSE 0 END),0) AS credits,
           ISNULL(SUM(CASE WHEN EntryDirection = N'debit' AND IsVoided = 0 THEN CAST(Amount AS DECIMAL(18,4)) ELSE 0 END),0) AS debits,
           ISNULL(SUM(CASE WHEN IsVoided = 0 AND EntryDirection = N'credit' THEN CAST(Amount AS DECIMAL(18,4))
                           WHEN IsVoided = 0 AND EntryDirection = N'debit' THEN -CAST(Amount AS DECIMAL(18,4))
                           ELSE 0 END),0) AS balance
    FROM dbo.TblEmpLedgerEntry
  `))[0];

  const ledgerByReason = await q(`
    SELECT EntryReason, EntryDirection, COUNT(*) AS c,
           ISNULL(SUM(CAST(Amount AS DECIMAL(18,4))),0) AS amountSum
    FROM dbo.TblEmpLedgerEntry
    WHERE IsVoided = 0
    GROUP BY EntryReason, EntryDirection
    ORDER BY c DESC
  `);

  const ledgerCashLinked = (await q(`
    SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry WHERE CashMoveID IS NOT NULL
  `))[0];

  const ledgerCashMismatchPreview = await q(`
    SELECT TOP 5 le.ID, le.CashMoveID, cm.BranchID AS CashBranchID
    FROM dbo.TblEmpLedgerEntry le
    INNER JOIN dbo.TblCashMove cm ON cm.ID = le.CashMoveID
    WHERE le.CashMoveID IS NOT NULL
  `).catch(() => []);

  const hasLedBranch = (
    await q(`
      SELECT COUNT(*) AS c FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry') AND name = N'BranchID'
    `)
  )[0].c;

  const targets = (await q(`
    SELECT COUNT(*) AS rows,
           ISNULL(SUM(CAST(TargetAmount AS DECIMAL(18,4))),0) AS targetSum,
           ISNULL(SUM(CAST(NetSalesAfterDiscount AS DECIMAL(18,4))),0) AS salesSum
    FROM dbo.TblEmpDailyTarget
  `))[0];

  const targetDup = await q(`
    SELECT EmpID, WorkDate, COUNT(*) AS c
    FROM dbo.TblEmpDailyTarget GROUP BY EmpID, WorkDate HAVING COUNT(*) > 1
  `);

  const recalc = (await q(`SELECT COUNT(*) AS rows FROM dbo.TblEmpTargetRecalcRequest`))[0];
  const plans = (await q(`SELECT COUNT(*) AS rows FROM dbo.TblEmpTargetPlan`))[0];
  const salaryHist = (await q(`
    SELECT COUNT(*) AS rows,
           SUM(CASE WHEN IsActive = 1 AND EffectiveTo IS NULL THEN 1 ELSE 0 END) AS activeOpen
    FROM dbo.TblEmpSalaryHistory
  `))[0];

  const out = {
    capturedAt: new Date().toISOString(),
    database,
    branches,
    hasPayBranch: !!hasPayBranch,
    hasLedBranch: !!hasLedBranch,
    payroll,
    payrollByStatus,
    payrollDupEmpDate: payrollDup.length,
    ledger,
    ledgerByReason,
    ledgerCashLinked,
    ledgerCashMismatchPreview,
    targets,
    targetDupEmpDate: targetDup.length,
    recalc,
    plans,
    salaryHist,
  };

  const outPath = path.join(__dirname, '_phase1l-employee-financial-before.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ ...out, outPath }, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
