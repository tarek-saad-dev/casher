import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = (r: string, ...a: unknown[]) => (r === 'server-only' ? {} : orig.call(m, r, ...a));

const EMP_ID = 1026;
const GLEEM = 1;
const FROM = '2026-08-01';

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const db = await getPool();

  const emp = await db.request().input('e', EMP_ID).query(`
    SELECT EmpID, EmpName, PayrollMethod, HourlyRate, ManualHourlyRate, DailyRate, BaseSalary, Salary, SalaryType
    FROM dbo.TblEmp WHERE EmpID=@e`);
  const row = emp.recordset[0];
  if (!row) throw new Error('employee not found');
  console.log('EMP', row);

  const asg = await db.request().input('e', EMP_ID).input('b', GLEEM).input('from', FROM).query(`
    SELECT TOP 1 ID FROM dbo.TblEmpBranchAssignment
    WHERE EmpID=@e AND BranchID=@b AND IsActive=1
      AND EffectiveFrom <= @from AND (EffectiveTo IS NULL OR EffectiveTo >= @from)`);
  if (!asg.recordset[0]) {
    const ins = await db.request().input('e', EMP_ID).input('b', GLEEM).input('from', FROM).query(`
      INSERT INTO dbo.TblEmpBranchAssignment (EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom, EffectiveTo, Notes)
      OUTPUT INSERTED.ID VALUES (@e, @b, 1, 0, 1, @from, NULL, N'تعيين جليم — يوسف محمد أغسطس')`);
    console.log('ASSIGNMENT CREATED', ins.recordset[0].ID);
  } else {
    console.log('ASSIGNMENT EXISTS', asg.recordset[0].ID);
  }

  const plan = await db.request().input('e', EMP_ID).input('b', GLEEM).input('from', FROM).query(`
    SELECT TOP 1 PlanID FROM dbo.TblEmpBranchPayrollPlan
    WHERE EmpID=@e AND BranchID=@b AND IsActive=1
      AND EffectiveFrom <= @from AND (EffectiveTo IS NULL OR EffectiveTo >= @from)`);
  if (!plan.recordset[0]) {
    const hourly = Number(row.HourlyRate) > 0 ? Number(row.HourlyRate) : Number(row.ManualHourlyRate) > 0 ? Number(row.ManualHourlyRate) : 20;
    await db.request().input('e', EMP_ID).input('b', GLEEM).input('h', sql.Decimal(18, 4), hourly).input('from', FROM).query(`
      INSERT INTO dbo.TblEmpBranchPayrollPlan (EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary, EffectiveFrom, EffectiveTo, IsActive, SourceNotes)
      VALUES (@e, @b, N'hourly', @h, NULL, NULL, @from, NULL, 1, N'خطة جليم — يوسف محمد')`);
    console.log('PLAN CREATED hourly', hourly);
  } else {
    console.log('PLAN EXISTS', plan.recordset[0].PlanID);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
