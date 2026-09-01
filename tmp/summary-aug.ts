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

  const summary = await pool.request().query(`
    SELECT CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate, b.BranchName,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance a
       WHERE a.BranchID = b.BranchID AND a.WorkDate = d.WorkDate
         AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
         AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL) AS AttOk,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
       WHERE p.BranchID = b.BranchID AND p.WorkDate = d.WorkDate AND p.Status = N'Generated') AS PayrollRows,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
       WHERE p.BranchID = b.BranchID AND p.WorkDate = d.WorkDate AND p.Status = N'Generated'
         AND p.DailyWage > 0) AS PayrollWithWage,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll p
       WHERE p.BranchID = b.BranchID AND p.WorkDate = d.WorkDate AND p.Status = N'Generated'
         AND p.DailyWage > 0
         AND EXISTS (SELECT 1 FROM dbo.TblEmpLedgerEntry l
           WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
             AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0)) AS LedgerWage,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget t
       WHERE t.BranchID = b.BranchID AND t.WorkDate = d.WorkDate AND t.TargetAmount > 0
         AND t.Status <> N'voided') AS TargetRows,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget t
       WHERE t.BranchID = b.BranchID AND t.WorkDate = d.WorkDate AND t.TargetAmount > 0
         AND t.Status <> N'voided'
         AND EXISTS (SELECT 1 FROM dbo.TblEmpLedgerEntry l
           WHERE l.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget') AND l.RefID = t.ID
             AND l.EntryReason = N'target' AND l.IsVoided = 0)) AS LedgerTarget
    FROM (
      SELECT CAST('2026-08-28' AS date) AS WorkDate
      UNION ALL SELECT CAST('2026-08-29' AS date)
      UNION ALL SELECT CAST('2026-08-30' AS date)
    ) d
    CROSS JOIN dbo.TblBranch b
    WHERE b.IsActive = 1
    ORDER BY d.WorkDate, b.BranchID
  `);
  console.table(summary.recordset);
  await pool.close();
}

main();
