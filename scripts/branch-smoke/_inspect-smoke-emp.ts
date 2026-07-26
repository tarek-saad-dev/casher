import dotenv from 'dotenv';
import sql from 'mssql';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER!,
    database: process.env.CLOUD_DB_NAME!,
    user: process.env.CLOUD_DB_USER!,
    password: process.env.CLOUD_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true },
  });
  const emps = await pool.request().query(`
    SELECT TOP 5 EmpID, EmpName, ISNULL(isActive,1) AS isActive
    FROM dbo.TblEmp WHERE EmpName LIKE N'%SMOKE%' ORDER BY EmpID DESC
  `);
  console.log('emps', emps.recordset);
  const asg = await pool.request().query(`
    SELECT * FROM dbo.TblEmpBranchAssignment WHERE BranchID = 2
  `);
  console.log('assignments', asg.recordset);
  const plans = await pool.request().query(`
    SELECT PlanID, EmpID, BranchID, PayType, HourlyRate, EffectiveFrom, IsActive
    FROM dbo.TblEmpBranchPayrollPlan WHERE BranchID = 2
  `);
  console.log('plans', plans.recordset);
  await pool.close();
}
main();
