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
  const { calculateDailyTarget } = await import('../src/lib/payroll/employee-target/calculate-daily-target');
  const db = await getPool();

  const plans = await db.request().query(`
    SELECT e.EmpID, e.EmpName, p.ID AS PlanID, b.BranchCode, p.IsEnabled,
      CONVERT(varchar(10), p.EffectiveFrom,120) AS EffFrom,
      CONVERT(varchar(10), p.EffectiveTo,120) AS EffTo,
      p.InputBasis
    FROM dbo.TblEmpTargetPlan p
    JOIN dbo.TblEmp e ON e.EmpID=p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID=p.BranchID
    WHERE p.BranchID=3 AND p.IsEnabled=1
      AND p.EffectiveFrom <= '2026-09-27'
      AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= '2026-09-01')
    ORDER BY e.EmpName
  `);
  console.log('=== CC active target plans Sep ===');
  console.log(JSON.stringify(plans.recordset, null, 2));

  const pay = await db.request().query(`
    SELECT COUNT(*) AS cnt,
      CAST(SUM(DailyWage) AS float) AS totalWage,
      CAST(SUM(ActualHours) AS float) AS totalHours
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID=25 AND WorkDate>='2026-09-01' AND WorkDate<='2026-09-27' AND BranchID=3
  `);
  console.log('=== Omar payroll totals CC ===');
  console.log(pay.recordset[0]);

  const sample = await db.request().query(`
    SELECT TOP 8 CONVERT(varchar(10),WorkDate,120) AS d,
      CAST(DailyWage AS float) AS w,
      CAST(ActualHours AS float) AS h,
      CASE WHEN ActualHours>0 THEN CAST(DailyWage/ActualHours AS float) ELSE NULL END AS impliedRate
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID=25 AND WorkDate>='2026-09-01' AND BranchID=3
    ORDER BY WorkDate
  `);
  console.log('=== Implied hourly rates ===');
  console.log(JSON.stringify(sample.recordset, null, 2));

  // What target WOULD be if CC plan existed with same tiers + 21130 MTD sales
  const tiers = [
    { dailyStartAmount: 10000, ratePercent: 10, sortOrder: 1 },
    { dailyStartAmount: 20000, ratePercent: 20, sortOrder: 2 },
    { dailyStartAmount: 30000, ratePercent: 30, sortOrder: 3 },
    { dailyStartAmount: 40000, ratePercent: 40, sortOrder: 4 },
    { dailyStartAmount: 50000, ratePercent: 50, sortOrder: 5 },
    { dailyStartAmount: 60000, ratePercent: 60, sortOrder: 6 },
    { dailyStartAmount: 70000, ratePercent: 70, sortOrder: 7 },
  ];
  const mtd = calculateDailyTarget(21130, tiers);
  console.log('=== Hypothetical MTD target if CC plan with 21130 sales ===');
  console.log(JSON.stringify(mtd, null, 2));

  // Check assignment / home branch for Omar
  const assign = await db.request().query(`
    SELECT TOP 20 *
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Emp%Assign%' OR TABLE_NAME LIKE '%Emp%Branch%' OR TABLE_NAME LIKE '%Roster%'
  `);
  console.log('=== related tables ===');
  console.log(assign.recordset.map((r: { TABLE_NAME: string }) => r.TABLE_NAME));

  const home = await db.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='TblEmp' AND COLUMN_NAME LIKE '%Branch%'
  `);
  console.log('=== TblEmp branch cols ===', home.recordset);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
