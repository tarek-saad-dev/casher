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

await q('MAMDOUH clients', `
  SELECT TOP 20 ClientID, Name, Mobile FROM dbo.TblClient
  WHERE Name LIKE N'%ممدوح%' OR Name LIKE N'%Mamdouh%' OR Name LIKE N'%محمد ممدوح%'
  ORDER BY ClientID DESC
`);

await q('Schedule control overrides emp7 Aug28', `
  SELECT TOP 20 * FROM dbo.TblEmpScheduleControlOverride
  WHERE EmpID = 7 AND WorkDate = '2026-08-28'
`);

await q('Day off emp7 Aug28', `
  SELECT TOP 10 * FROM dbo.TblEmpDayOff
  WHERE EmpID = 7 AND DayOffDate = '2026-08-28'
`);

await q('Compare bookings 3811 vs 3816 visibility SQL', `
  SELECT BookingID, AssignedEmpID, BranchID, BookingDate, StartTime, EndTime, Status, Source
  FROM dbo.Bookings
  WHERE BookingID IN (3811, 3813, 3816)
`);

await q('Production deploy commit', `
  SELECT 1 AS ok
`);

await pool.close();
