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

await q('CLIENT search Mohamed Mamdouh', `
  SELECT TOP 20 ClientID, Name, Phone, CreatedAt
  FROM dbo.TblClient
  WHERE Name LIKE N'%Mamdouh%' OR Name LIKE N'%ممدوح%' OR Name LIKE N'%Mohamed%'
  ORDER BY CreatedAt DESC
`);

await q('IDEMPOTENCY request 10678', `
  SELECT TOP 1 * FROM dbo.TblPublicBookingCreateRequest WHERE RequestID = 10678
`);

await q('IDEMPOTENCY columns sample', `
  SELECT TOP 1 * FROM dbo.TblPublicBookingCreateRequest ORDER BY RequestID DESC
`);

await q('EMP 7 attendance Aug 28', `
  SELECT TOP 10 * FROM dbo.TblEmpAttendance
  WHERE EmpID = 7 AND [Date] >= '2026-08-28' AND [Date] < '2026-08-29'
`);

await q('EMP 7 work schedule branch 1', `
  SELECT TOP 20 * FROM dbo.TblEmpBranchWorkSchedule
  WHERE EmpID = 7 AND BranchID = 1
  ORDER BY DayOfWeek
`);

await q('EMP 7 schedule overrides Aug 28', `
  SELECT TOP 10 * FROM dbo.TblEmpScheduleOverride
  WHERE EmpID = 7 AND OverrideDate = '2026-08-28'
`);

await q('EMP 7 legacy work schedule', `
  SELECT TOP 10 * FROM dbo.TblEmpWorkSchedule WHERE EmpID = 7
`);

await q('FLOW BOARD bookings query emp7', `
  SELECT b.BookingID, c.Name, b.StartTime, b.EndTime, b.Status
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON b.ClientID = c.ClientID
  WHERE b.BookingDate = '2026-08-28' AND b.BranchID = 1 AND b.AssignedEmpID = 7
    AND b.Status IN ('confirmed','arrived','in_progress','queued','in_service')
`);

await q('BOOKING 3811 same barber - visible comparison', `
  SELECT b.BookingID, b.BookingCode, c.Name, b.StartTime, b.AbsoluteStartUtc, b.CreatedAt
  FROM dbo.Bookings b LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  WHERE b.BookingID IN (3811, 3813, 3816)
`);

await pool.close();
