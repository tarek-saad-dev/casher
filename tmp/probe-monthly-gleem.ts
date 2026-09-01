import dotenv from 'dotenv';
import path from 'path';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function main() {
  const password = String(process.env.LOCAL_DB_PASSWORD || '').replace(/^"|"$/g, '');
  const pool = await sql.connect({
    server: '127.0.0.1',
    port: parseInt(process.env.LOCAL_DB_PORT || '1433', 10),
    database: process.env.LOCAL_DB_NAME,
    user: process.env.LOCAL_DB_USER,
    password,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const plans = await pool.request().query(`
    SELECT e.EmpID, e.EmpName, p.PayType, p.MonthlySalary, p.HourlyRate, p.DailyRate,
      (SELECT TOP 1 l.Amount FROM dbo.TblEmpLedgerEntry l
       WHERE l.EmpID = e.EmpID AND l.BranchID = 1 AND l.EntryReason = N'monthly_salary'
         AND l.PayrollMonth = '2026-08' AND l.IsVoided = 0) AS LedgerAug
    FROM dbo.TblEmp e
    JOIN dbo.TblEmpBranchPayrollPlan p ON p.EmpID = e.EmpID AND p.BranchID = 1
    WHERE p.PayType = N'monthly' AND p.IsActive = 1
    ORDER BY e.EmpName
  `);
  console.table(plans.recordset);
  await pool.close();
}

main();
