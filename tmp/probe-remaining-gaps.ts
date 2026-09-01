import dotenv from 'dotenv';
import path from 'path';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function main() {
  const password = String(process.env.LOCAL_DB_PASSWORD || '').replace(/^"|"$/g, '');
  const pool = await sql.connect({
    server: process.env.LOCAL_DB_SERVER || '127.0.0.1',
    port: parseInt(process.env.LOCAL_DB_PORT || '1433', 10),
    database: process.env.LOCAL_DB_NAME,
    user: process.env.LOCAL_DB_USER,
    password,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const r = await pool.request().query(`
    SELECT e.EmpID, e.EmpName, CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      a.BranchID, b.BranchName, a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      CONVERT(varchar(5), e.DefaultCheckInTime, 108) AS DefIn,
      CONVERT(varchar(5), e.DefaultCheckOutTime, 108) AS DefOut,
      p.ID AS PayId, p.Status AS PayStatus, p.DailyWage,
      (SELECT COUNT(*) FROM dbo.TblEmpBranchPayrollPlan bp
       WHERE bp.EmpID = e.EmpID AND bp.BranchID = a.BranchID AND bp.IsActive = 1) AS Plans
    FROM dbo.TblEmp e
    JOIN dbo.TblEmpAttendance a ON a.EmpID = e.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
    WHERE a.WorkDate IN ('2026-08-28', '2026-08-29', '2026-08-30')
      AND e.EmpName IN (N'طارق', N'مريم')
    ORDER BY a.WorkDate, e.EmpName, a.BranchID
  `);
  console.table(r.recordset);

  const gaps = await pool.request().query(`
    SELECT e.EmpName, CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      b.BranchName, a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.WorkDate BETWEEN '2026-08-28' AND '2026-08-30'
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
      AND (
        a.CheckInTime IS NULL OR a.CheckOutTime IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpDailyPayroll p
          WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
            AND p.Status = N'Generated'
        )
      )
    ORDER BY a.WorkDate, b.BranchName, e.EmpName
  `);
  console.log('Remaining gaps:', gaps.recordset.length);
  console.table(gaps.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
