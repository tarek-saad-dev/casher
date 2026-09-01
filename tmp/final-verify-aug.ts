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

  await pool
    .request()
    .input('d', sql.Date, '2026-08-28')
    .input('emp', sql.Int, 22)
    .input('b', sql.Int, 1)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET CheckInTime = CAST('19:30' AS time),
          CheckOutTime = CAST('01:00' AS time),
          Status = N'Present',
          Notes = ISNULL(Notes, N'') + N' [HealAug28-30]'
      WHERE EmpID = @emp AND WorkDate = @d AND BranchID = @b
    `);

  const r = await pool
    .request()
    .input('d', sql.Date, '2026-08-28')
    .input('emp', sql.Int, 22)
    .input('b', sql.Int, 1)
    .query(`
      SELECT Status, CONVERT(varchar(5), CheckInTime, 108) AS ci,
        CONVERT(varchar(5), CheckOutTime, 108) AS co
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @emp AND WorkDate = @d AND BranchID = @b
    `);
  console.log('طارق 28:', r.recordset[0]);

  const final = await pool.request().query(`
    SELECT CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate, b.BranchName, e.EmpName,
      a.Status, CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      bp.PayType,
      CASE WHEN p.ID IS NOT NULL AND p.Status = N'Generated' THEN N'yes' ELSE N'no' END AS HasPayroll,
      CASE WHEN p.DailyWage > 0 AND EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
          AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
      ) THEN N'yes' WHEN p.DailyWage > 0 THEN N'missing' ELSE N'n/a' END AS LedgerOk
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    LEFT JOIN dbo.TblEmpBranchPayrollPlan bp
      ON bp.EmpID = a.EmpID AND bp.BranchID = a.BranchID AND bp.IsActive = 1
      AND bp.EffectiveFrom <= a.WorkDate AND (bp.EffectiveTo IS NULL OR bp.EffectiveTo >= a.WorkDate)
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
    WHERE a.WorkDate BETWEEN '2026-08-28' AND '2026-08-30'
      AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
      AND (
        a.CheckInTime IS NULL OR a.CheckOutTime IS NULL
        OR (bp.PayType IN (N'hourly', N'daily') AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpDailyPayroll px
          WHERE px.EmpID = a.EmpID AND px.BranchID = a.BranchID AND px.WorkDate = a.WorkDate
            AND px.Status = N'Generated'
        ))
        OR (p.DailyWage > 0 AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
            AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
        ))
      )
    ORDER BY a.WorkDate, b.BranchName, e.EmpName
  `);

  console.log('\nReal gaps (hourly/daily only):', final.recordset.length);
  if (final.recordset.length) console.table(final.recordset);
  else console.log('✅ ALL CLEAR');

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
