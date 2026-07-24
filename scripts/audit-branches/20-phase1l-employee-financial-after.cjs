/**
 * Phase 1L — employee financial after fingerprint (read-only).
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
  const gleem = branches.find((b) => b.BranchCode === 'GLEEM');
  const ph1 = branches.find((b) => b.BranchCode === 'PH1GTEST');
  if (!gleem) throw new Error('GLEEM missing');

  const nullPayroll = (
    await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpDailyPayroll WHERE BranchID IS NULL`)
  )[0].c;
  const nullLedger = (
    await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry WHERE BranchID IS NULL`)
  )[0].c;
  const nullTarget = (
    await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpDailyTarget WHERE BranchID IS NULL`)
  )[0].c;
  const nullRecalc = (
    await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpTargetRecalcRequest WHERE BranchID IS NULL`)
  )[0].c;
  const nullPlan = (
    await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpTargetPlan WHERE BranchID IS NULL`)
  )[0].c;

  const payroll = (await q(`
    SELECT COUNT(*) AS rows,
           ISNULL(SUM(CAST(DailyWage AS DECIMAL(18,4))),0) AS wageSum,
           ISNULL(SUM(CAST(ActualHours AS DECIMAL(18,4))),0) AS hoursSum
    FROM dbo.TblEmpDailyPayroll
  `))[0];

  const payrollByBranch = await q(`
    SELECT b.BranchCode, COUNT(*) AS c, ISNULL(SUM(CAST(p.DailyWage AS DECIMAL(18,4))),0) AS wageSum
    FROM dbo.TblEmpDailyPayroll p
    INNER JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    GROUP BY b.BranchCode
  `);

  const ph1Payroll = (
    await q(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpDailyPayroll WHERE BranchID = ${Number(ph1?.BranchID) || -1}
    `)
  )[0].c;

  const ledger = (await q(`
    SELECT COUNT(*) AS rows,
           ISNULL(SUM(CASE WHEN EntryDirection = N'credit' AND IsVoided = 0 THEN CAST(Amount AS DECIMAL(18,4)) ELSE 0 END),0) AS credits,
           ISNULL(SUM(CASE WHEN EntryDirection = N'debit' AND IsVoided = 0 THEN CAST(Amount AS DECIMAL(18,4)) ELSE 0 END),0) AS debits,
           ISNULL(SUM(CASE WHEN IsVoided = 0 AND EntryDirection = N'credit' THEN CAST(Amount AS DECIMAL(18,4))
                           WHEN IsVoided = 0 AND EntryDirection = N'debit' THEN -CAST(Amount AS DECIMAL(18,4))
                           ELSE 0 END),0) AS balance
    FROM dbo.TblEmpLedgerEntry
  `))[0];

  const cashMismatch = (
    await q(`
      SELECT COUNT(*) AS c
      FROM dbo.TblEmpLedgerEntry le
      INNER JOIN dbo.TblCashMove cm ON cm.ID = le.CashMoveID
      WHERE le.CashMoveID IS NOT NULL AND le.BranchID <> cm.BranchID
    `)
  )[0].c;

  const ph1Ledger = (
    await q(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry WHERE BranchID = ${Number(ph1?.BranchID) || -1}
    `)
  )[0].c;

  const targets = (await q(`
    SELECT COUNT(*) AS rows,
           ISNULL(SUM(CAST(TargetAmount AS DECIMAL(18,4))),0) AS targetSum
    FROM dbo.TblEmpDailyTarget
  `))[0];

  const ph1Targets = (
    await q(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpDailyTarget WHERE BranchID = ${Number(ph1?.BranchID) || -1}
    `)
  )[0].c;

  const branchBal = (await q(`
    SELECT ISNULL(SUM(Balance),0) AS sumBalance FROM dbo.vw_EmpLedgerBranchBalance
  `))[0];
  const globalBal = (await q(`
    SELECT ISNULL(SUM(Balance),0) AS sumBalance FROM dbo.vw_EmpLedgerGlobalBalance
  `))[0];

  const plans = (await q(`
    SELECT COUNT(*) AS rows FROM dbo.TblEmpBranchPayrollPlan
  `))[0];
  const ph1Plans = (
    await q(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpBranchPayrollPlan WHERE BranchID = ${Number(ph1?.BranchID) || -1}
    `)
  )[0].c;

  const indexes = await q(`
    SELECT i.name
    FROM sys.indexes i
    WHERE i.object_id IN (
      OBJECT_ID(N'dbo.TblEmpDailyPayroll'),
      OBJECT_ID(N'dbo.TblEmpDailyTarget'),
      OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest')
    )
      AND i.name IN (
        N'UX_TblEmpDailyPayroll_Emp_Branch_WorkDate',
        N'UQ_TblEmpDailyTarget_Emp_Branch_WorkDate',
        N'UX_TblEmpTargetRecalcRequest_Emp_Branch_WorkDate'
      )
  `);

  const out = {
    capturedAt: new Date().toISOString(),
    database,
    branches,
    nulls: {
      payroll: nullPayroll,
      ledger: nullLedger,
      target: nullTarget,
      recalc: nullRecalc,
      plan: nullPlan,
    },
    payroll,
    payrollByBranch,
    ph1Payroll,
    ledger,
    cashMismatch,
    ph1Ledger,
    targets,
    ph1Targets,
    branchBalanceSum: Number(branchBal.sumBalance),
    globalBalanceSum: Number(globalBal.sumBalance),
    branchPayrollPlans: plans.rows,
    ph1PayrollPlans: ph1Plans,
    requiredIndexes: indexes.map((r) => r.name),
  };

  const outPath = path.join(__dirname, '_phase1l-employee-financial-after.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ ...out, outPath }, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
