#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool } = await import('../src/lib/db');
  const db = await getPool();

  const aug = await db.request().query(`
    SELECT b.BranchCode,
      COUNT(*) AS days,
      CAST(SUM(TargetAmount) AS float) AS totalTarget,
      CAST(MAX(CASE WHEN CalculationBreakdownJson LIKE '%mtdSales%' THEN 1 ELSE 0 END) AS int) AS hasMtd,
      CAST(SUM(NetSalesAfterDiscount) AS float) AS sumDaySales
    FROM dbo.TblEmpDailyTarget t
    JOIN dbo.TblBranch b ON b.BranchID=t.BranchID
    WHERE t.EmpID=25 AND t.WorkDate>='2026-08-01' AND t.WorkDate<='2026-08-31'
      AND t.Status <> 'voided'
    GROUP BY b.BranchCode
  `);
  console.log('AUG', JSON.stringify(aug.recordset, null, 2));

  const augLast = await db.request().query(`
    SELECT TOP 1 CONVERT(varchar(10), WorkDate,120) AS d,
      CAST(NetSalesAfterDiscount AS float) AS daySales,
      CAST(TargetAmount AS float) AS dayTarget,
      LEFT(CalculationBreakdownJson, 400) AS head
    FROM dbo.TblEmpDailyTarget
    WHERE EmpID=25 AND WorkDate>='2026-08-01' AND WorkDate<='2026-08-31'
      AND Status <> 'voided'
    ORDER BY WorkDate DESC
  `);
  console.log('AUG LAST', JSON.stringify(augLast.recordset, null, 2));

  const sepLedTarget = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.TblEmpLedgerEntry
    WHERE EmpID=25 AND EntryReason=N'target' AND IsVoided=0
      AND EntryDate>='2026-09-01' AND EntryDate<='2026-09-27'
  `);
  console.log('SEP target ledger count', sepLedTarget.recordset[0]);

  const augLedTarget = await db.request().query(`
    SELECT COUNT(*) AS cnt, CAST(SUM(Amount) AS float) AS total
    FROM dbo.TblEmpLedgerEntry
    WHERE EmpID=25 AND EntryReason=N'target' AND IsVoided=0
      AND EntryDate>='2026-08-01' AND EntryDate<='2026-08-31'
  `);
  console.log('AUG target ledger', augLedTarget.recordset[0]);

  // CC target plan count ever
  const ccPlans = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.TblEmpTargetPlan WHERE BranchID=3
  `);
  console.log('CC plans ever', ccPlans.recordset[0]);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
