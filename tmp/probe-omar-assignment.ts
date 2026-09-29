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

  const cols = await db.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN ('TblEmpBranchAssignment','TblEmpBranchPayrollPlan','TblEmpTemporaryBranchTransfer')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  console.log('COLS', JSON.stringify(cols.recordset, null, 2));

  const assign = await db.request().query(`
    SELECT a.*, b.BranchCode
    FROM dbo.TblEmpBranchAssignment a
    JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
    WHERE a.EmpID=25
  `);
  console.log('ASSIGN', JSON.stringify(assign.recordset, null, 2));

  const payrollPlan = await db.request().query(`
    SELECT p.*, b.BranchCode
    FROM dbo.TblEmpBranchPayrollPlan p
    JOIN dbo.TblBranch b ON b.BranchID=p.BranchID
    WHERE p.EmpID=25
  `);
  console.log('PAYROLL PLAN', JSON.stringify(payrollPlan.recordset, null, 2));

  const xfer = await db.request().query(`
    SELECT t.*, b.BranchCode
    FROM dbo.TblEmpTemporaryBranchTransfer t
    JOIN dbo.TblBranch b ON b.BranchID=t.BranchID
    WHERE t.EmpID=25
    ORDER BY t.ID DESC
  `);
  console.log('TRANSFERS', JSON.stringify(xfer.recordset, null, 2));

  // Any target plans ever on CC for anyone?
  const any = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.TblEmpTargetPlan WHERE BranchID=3
  `);
  console.log('CC target plan rows ever:', any.recordset[0]);

  // Omar Aug target vs Sep for comparison
  const aug = await db.request().query(`
    SELECT b.BranchCode,
      COUNT(*) AS days,
      CAST(SUM(TargetAmount) AS float) AS totalTarget,
      CAST(SUM(NetSalesAfterDiscount) AS float) AS totalSales
    FROM dbo.TblEmpDailyTarget t
    JOIN dbo.TblBranch b ON b.BranchID=t.BranchID
    WHERE t.EmpID=25 AND t.WorkDate>='2026-08-01' AND t.WorkDate<='2026-08-31'
      AND t.Status <> 'voided'
    GROUP BY b.BranchCode
  `);
  console.log('AUG targets:', JSON.stringify(aug.recordset, null, 2));

  const sep = await db.request().query(`
    SELECT b.BranchCode,
      COUNT(*) AS days,
      CAST(SUM(TargetAmount) AS float) AS totalTarget,
      CAST(SUM(NetSalesAfterDiscount) AS float) AS totalSales
    FROM dbo.TblEmpDailyTarget t
    JOIN dbo.TblBranch b ON b.BranchID=t.BranchID
    WHERE t.EmpID=25 AND t.WorkDate>='2026-09-01' AND t.WorkDate<='2026-09-27'
      AND t.Status <> 'voided'
    GROUP BY b.BranchCode
  `);
  console.log('SEP targets:', JSON.stringify(sep.recordset, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
