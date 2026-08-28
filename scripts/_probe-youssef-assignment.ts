import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = (r: string, ...a: unknown[]) => (r === 'server-only' ? {} : orig.call(m, r, ...a));

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const db = await getPool();
  const empId = 1026;
  const asg = await db.request().input('e', empId).query(`
    SELECT a.ID, a.BranchID, b.BranchName, a.EffectiveFrom, a.EffectiveTo, a.IsActive
    FROM dbo.TblEmpBranchAssignment a JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
    WHERE a.EmpID=@e ORDER BY a.EffectiveFrom DESC`);
  console.log('ASSIGNMENTS', JSON.stringify(asg.recordset, null, 2));
  const plans = await db.request().input('e', empId).query(`
    SELECT PlanID, BranchID, PayrollMethod, HourlyRate, DailyRate, EffectiveFrom, EffectiveTo, IsActive
    FROM dbo.TblEmpBranchPayrollPlan WHERE EmpID=@e ORDER BY EffectiveFrom DESC`);
  console.log('PLANS', JSON.stringify(plans.recordset, null, 2));
  const pay = await db.request().input('e', empId).query(`
    SELECT CONVERT(varchar(10),WorkDate,23) d, BranchID, DailyWage, Status, LEFT(Notes,80) Notes
    FROM dbo.TblEmpDailyPayroll WHERE EmpID=@e AND WorkDate>='2026-08-01' AND WorkDate<='2026-08-27' ORDER BY WorkDate`);
  console.log('PAYROLL', JSON.stringify(pay.recordset, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
