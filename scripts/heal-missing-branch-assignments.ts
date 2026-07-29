/**
 * Heal employees missing branch assignment + payroll plan (e.g. يوسف محمد).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();

  const gleem = await db.request().query(`
    SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
  `);
  const branchId = Number(gleem.recordset[0]?.BranchID);
  if (!branchId) throw new Error('GLEEM not found');

  const missing = await db.request().query(`
    SELECT e.EmpID, e.EmpName, e.PayrollMethod, e.HourlyRate, e.ManualHourlyRate,
           e.DailyRate, e.BaseSalary, e.Salary, e.SalaryType
    FROM dbo.TblEmp e
    WHERE ISNULL(e.isActive, 1) = 1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpBranchAssignment a
        WHERE a.EmpID = e.EmpID AND a.IsActive = 1
          AND a.EffectiveFrom <= CAST(GETDATE() AS date)
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(GETDATE() AS date))
      )
  `);

  console.log(
    'missing',
    missing.recordset.map((r: { EmpID: number; EmpName: string }) => `${r.EmpID}:${r.EmpName}`),
  );

  const from = new Date().toISOString().slice(0, 10);

  for (const row of missing.recordset as Array<Record<string, unknown>>) {
    const empId = Number(row.EmpID);

    const existingAsg = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('day', sql.Date, from)
      .query(`
        SELECT TOP 1 ID FROM dbo.TblEmpBranchAssignment
        WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
          AND EffectiveFrom <= @day
          AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      `);

    if (!existingAsg.recordset[0]) {
      const ins = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .input('from', sql.Date, from)
        .query(`
          INSERT INTO dbo.TblEmpBranchAssignment (
            EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom, EffectiveTo, Notes
          )
          OUTPUT INSERTED.ID
          VALUES (@empId, @branchId, 1, 0, 1, @from, NULL, N'heal missing assignment')
        `);
      console.log('assignment created', empId, ins.recordset[0].ID);
    } else {
      console.log('assignment exists', empId, existingAsg.recordset[0].ID);
    }

    const existingPlan = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('day', sql.Date, from)
      .query(`
        SELECT TOP 1 PlanID FROM dbo.TblEmpBranchPayrollPlan
        WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
          AND EffectiveFrom <= @day
          AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      `);
    if (existingPlan.recordset[0]) {
      console.log('payroll exists', empId, existingPlan.recordset[0].PlanID);
      continue;
    }

    const hourly =
      row.HourlyRate != null && Number(row.HourlyRate) > 0
        ? Number(row.HourlyRate)
        : row.ManualHourlyRate != null && Number(row.ManualHourlyRate) > 0
          ? Number(row.ManualHourlyRate)
          : null;
    const daily =
      row.DailyRate != null && Number(row.DailyRate) > 0
        ? Number(row.DailyRate)
        : String(row.SalaryType ?? '') === 'Daily' && row.Salary != null && Number(row.Salary) > 0
          ? Number(row.Salary)
          : null;
    const monthly =
      row.BaseSalary != null && Number(row.BaseSalary) > 0
        ? Number(row.BaseSalary)
        : String(row.SalaryType ?? '') !== 'Daily' && row.Salary != null && Number(row.Salary) > 0
          ? Number(row.Salary)
          : null;

    const method = String(row.PayrollMethod ?? '').toLowerCase();
    let payType: 'hourly' | 'daily' | 'monthly' = 'hourly';
    if (method === 'daily' || (!hourly && daily)) payType = 'daily';
    else if (method === 'monthly' || (!hourly && !daily && monthly)) payType = 'monthly';
    if (payType === 'hourly' && !(hourly && hourly > 0)) {
      if (daily) payType = 'daily';
      else if (monthly) payType = 'monthly';
      else {
        console.log('skip payroll — no rates', empId);
        continue;
      }
    }

    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('payType', sql.NVarChar(20), payType)
      .input('hourly', sql.Decimal(18, 4), hourly)
      .input('daily', sql.Decimal(18, 4), daily)
      .input('monthly', sql.Decimal(18, 4), monthly)
      .input('from', sql.Date, from)
      .query(`
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
          EffectiveFrom, EffectiveTo, IsActive, SourceNotes
        )
        VALUES (
          @empId, @branchId, @payType, @hourly, @daily, @monthly,
          @from, NULL, 1, N'heal missing assignment — from TblEmp'
        )
      `);
    console.log('payroll created', empId, payType, { hourly, daily, monthly });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
