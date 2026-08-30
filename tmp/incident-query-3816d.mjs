import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const pool = await sql.connect({
  server: process.env.DB_SERVER || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

async function q(label, queryText) {
  const r = await pool.request().query(queryText);
  console.log(`\n=== ${label} (${r.recordset.length}) ===`);
  console.log(JSON.stringify(r.recordset, null, 2));
}

await q('IDEMPOTENCY 10678', `SELECT TOP 1 * FROM dbo.TblPublicBookingCreateRequest WHERE RequestID = 10678`);

await q('CLIENT 13450', `SELECT * FROM dbo.TblClient WHERE ClientID = 13450`);

await q('EMP 7 attendance', `
  SELECT TOP 10 * FROM dbo.TblEmpAttendance
  WHERE EmpID = 7 AND CAST([Date] AS DATE) = '2026-08-28'
`);

await q('EMP 7 branch work schedule', `
  SELECT * FROM dbo.TblEmpBranchWorkSchedule WHERE EmpID = 7 AND BranchID = 1 ORDER BY DayOfWeek
`);

await q('Schedule override emp7', `
  SELECT * FROM dbo.TblEmpScheduleOverride WHERE EmpID = 7 AND OverrideDate = '2026-08-28'
`);

await q('Leave override emp7', `
  SELECT * FROM dbo.TblEmpLeaveOverride WHERE EmpID = 7 AND LeaveDate = '2026-08-28'
`);

await q('Temporary transfer emp7', `
  SELECT * FROM dbo.TblEmpTemporaryTransfer
  WHERE EmpID = 7 AND TransferDate = '2026-08-28'
`);

await q('Business day GLEEM Aug 28', `
  SELECT TOP 5 * FROM dbo.TblBusinessDay
  WHERE BranchID = 1 AND NewDay = '2026-08-28'
  ORDER BY BusinessDayID DESC
`);

await pool.close();
