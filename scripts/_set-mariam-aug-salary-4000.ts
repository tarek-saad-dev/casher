#!/usr/bin/env npx tsx
/**
 * Set Mariam (EmpID 1032) August 2026 monthly_salary ledger to 4000 (Gleem).
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const EMP_ID = 1032;
const BRANCH_ID = 1;
const MONTH = '2026-08';
const TARGET = 4000;

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { postMonthlySalaryEntitlements } = await import(
    '@/lib/services/employeeLedgerMonthlySalaryService'
  );

  const db = await getPool();

  // Align emp BaseSalary with plan (plan already 4000).
  await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('salary', sql.Decimal(12, 2), TARGET)
    .query(`
      UPDATE dbo.TblEmp
      SET BaseSalary = @salary
      WHERE EmpID = @empId AND ISNULL(BaseSalary, -1) <> @salary
    `);

  await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .input('salary', sql.Decimal(12, 2), TARGET)
    .query(`
      UPDATE dbo.TblEmpBranchPayrollPlan
      SET MonthlySalary = @salary
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND PayType = N'monthly'
        AND ISNULL(MonthlySalary, -1) <> @salary
    `);

  const before = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .query(`
      SELECT ID, Amount, CONVERT(varchar(10), EntryDate, 23) AS EntryDate, Notes, PayrollMonth
      FROM dbo.TblEmpLedgerEntry
      WHERE EmpID = @empId AND BranchID = @branchId
        AND EntryReason = N'monthly_salary'
        AND RefType = N'MonthlySalary:2026-08'
        AND IsVoided = 0
    `);
  console.log('BEFORE:', JSON.stringify(before.recordset, null, 2));

  const dry = await postMonthlySalaryEntitlements({
    month: MONTH,
    branchId: BRANCH_ID,
    empId: EMP_ID,
    dryRun: true,
  });
  console.log('DRY:', JSON.stringify(dry, null, 2));

  const result = await postMonthlySalaryEntitlements({
    month: MONTH,
    branchId: BRANCH_ID,
    empId: EMP_ID,
    dryRun: false,
  });
  console.log('POST:', JSON.stringify(result, null, 2));

  const after = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .query(`
      SELECT ID, Amount, CONVERT(varchar(10), EntryDate, 23) AS EntryDate, Notes, PayrollMonth, RefType
      FROM dbo.TblEmpLedgerEntry
      WHERE EmpID = @empId AND BranchID = @branchId
        AND EntryReason = N'monthly_salary'
        AND RefType = N'MonthlySalary:2026-08'
        AND IsVoided = 0
    `);
  console.log('AFTER:', JSON.stringify(after.recordset, null, 2));

  const amount = Number(after.recordset[0]?.Amount);
  if (amount !== TARGET) {
    throw new Error(`Expected ${TARGET}, got ${amount}`);
  }
  console.log(`OK Mariam Aug monthly_salary = ${amount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
