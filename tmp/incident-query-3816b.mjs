import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const cfg = {
  server: process.env.DB_SERVER || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const pool = await sql.connect(cfg);

async function q(label, queryText) {
  const r = await pool.request().query(queryText);
  console.log(`\n=== ${label} (${r.recordset.length} rows) ===`);
  console.log(JSON.stringify(r.recordset, null, 2));
}

await q('MOHAMED MAMDOUH search', `
  SELECT b.BookingID, b.BookingCode, b.BranchID, br.BranchCode, b.AssignedEmpID, e.EmpName,
         b.BookingDate, b.PublicWorkDate, b.PublicDayOffset, b.StartTime, b.EndTime,
         b.AbsoluteStartUtc, b.AbsoluteEndUtc, b.Status, b.Source, b.CreatedAt, c.Name, c.Phone
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
  LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
  WHERE b.BookingDate = '2026-08-28'
    AND (
      c.Name LIKE N'%Mamdouh%' OR c.Name LIKE N'%ممدوح%'
      OR c.Name LIKE N'%Mohamed Mamdouh%' OR c.Name LIKE N'%محمد ممدوح%'
    )
  ORDER BY b.CreatedAt DESC
`);

await q('ALL GLEEM online bookings 2026-08-28', `
  SELECT b.BookingID, b.BookingCode, b.AssignedEmpID, e.EmpName,
         b.StartTime, b.EndTime, b.AbsoluteStartUtc, b.Status, b.CreatedAt, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
  WHERE b.BranchID = 1 AND b.BookingDate = '2026-08-28' AND b.Source = 'online'
  ORDER BY b.AbsoluteStartUtc
`);

await q('SLOT CLAIMS 3816', `
  SELECT * FROM dbo.TblBookingSlotClaim WHERE BookingID = 3816
`);

await q('IDEMPOTENCY 3816', `
  SELECT TOP 3 Id, IdempotencyKey, Status, BookingID, BranchID, CreatedAt, CompletedAt, ResponseJson
  FROM dbo.TblPublicBookingCreateRequest
  WHERE BookingID = 3816 OR Id = 10678
`);

await q('FLOW BOARD SQL - bookings for GLEEM 2026-08-28 emp 7', `
  SELECT b.BookingID, b.AssignedEmpID, c.Name, b.StartTime, b.EndTime, b.Status, b.Source
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON b.ClientID = c.ClientID
  WHERE b.BookingDate = '2026-08-28'
    AND b.BranchID = 1
    AND b.AssignedEmpID = 7
    AND b.AssignedEmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE isActive = 1 AND Job = N'حلاق')
    AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
`);

await q('EMP 7 day status inputs', `
  SELECT e.EmpID, e.EmpName, e.isActive, e.Job
  FROM dbo.TblEmp e WHERE e.EmpID = 7
`);

await q('EMP 7 branch assignment GLEEM', `
  SELECT * FROM dbo.TblEmpBranchAssignment
  WHERE EmpID = 7 AND BranchID = 1 AND IsActive = 1
`);

await q('EMP 7 attendance 2026-08-28', `
  SELECT TOP 5 * FROM dbo.TblEmpAttendance
  WHERE EmpID = 7 AND CAST(Date AS DATE) = '2026-08-28'
`);

await q('EMP 7 schedule 2026-08-28', `
  SELECT TOP 5 * FROM dbo.TblEmpBranchWorkSchedule
  WHERE EmpID = 7 AND BranchID = 1
`);

await q('RECENT working GLEEM public booking comparison', `
  SELECT TOP 3 b.BookingID, b.BookingCode, b.BranchID, b.AssignedEmpID, b.BookingDate,
         b.PublicWorkDate, b.PublicDayOffset, b.StartTime, b.EndTime, b.AbsoluteStartUtc,
         b.Status, b.Source, b.CreatedAt, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  WHERE b.BranchID = 1 AND b.Source = 'online' AND b.BookingID < 3816
  ORDER BY b.CreatedAt DESC
`);

await pool.close();
