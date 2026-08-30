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
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(r.recordset, null, 2));
}

await q('BOOKING 3816', `
  SELECT b.*, c.Name AS ClientName, c.Phone, br.BranchCode, e.EmpName
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
  LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
  WHERE b.BookingID = 3816
`);

await q('BOOKING SERVICES 3816', `
  SELECT bs.*, p.ProName
  FROM dbo.BookingServices bs
  LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
  WHERE bs.BookingID = 3816
`);

await q('SLOT CLAIMS 3816', `
  SELECT *
  FROM dbo.BookingSlotClaims
  WHERE BookingID = 3816 OR BookingID = '3816'
`);

await q('QUEUE TICKETS for client/booking', `
  SELECT qt.*
  FROM dbo.QueueTickets qt
  INNER JOIN dbo.Bookings b ON b.ClientID = qt.ClientID AND b.AssignedEmpID = qt.EmpID
  WHERE b.BookingID = 3816
`);

await q('IDEMPOTENCY REQUEST', `
  SELECT TOP 5 *
  FROM dbo.TblPublicBookingCreateRequest
  WHERE BookingID = 3816 OR ResponseJson LIKE '%BK-JC3GG5%'
  ORDER BY CreatedAt DESC
`);

await q('GLEEM 15:00 bookings 2026-08-28', `
  SELECT b.BookingID, b.BookingCode, b.BranchID, br.BranchCode, b.AssignedEmpID, e.EmpName,
         b.BookingDate, b.PublicWorkDate, b.PublicDayOffset, b.StartTime, b.EndTime, b.Status,
         b.Source, b.CreatedAt, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
  LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
  WHERE br.BranchCode = N'GLEEM' AND b.BookingDate = '2026-08-28' AND b.StartTime = '15:00'
  ORDER BY b.CreatedAt DESC
`);

await q('MOHAMED bookings today', `
  SELECT b.BookingID, b.BookingCode, b.BranchID, br.BranchCode, b.AssignedEmpID,
         b.BookingDate, b.PublicWorkDate, b.StartTime, b.EndTime, b.Status, b.CreatedAt, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
  WHERE b.BookingDate = '2026-08-28'
    AND (c.Name LIKE N'%Mohamed%' OR c.Name LIKE N'%ممدوح%' OR c.Name LIKE N'%محمد%')
  ORDER BY b.CreatedAt DESC
`);

await q('RECENT GLEEM PUBLIC online bookings', `
  SELECT TOP 5 b.BookingID, b.BookingCode, b.BranchID, b.AssignedEmpID, b.BookingDate,
         b.PublicWorkDate, b.PublicDayOffset, b.StartTime, b.Status, b.Source, b.CreatedAt, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  WHERE b.BranchID = 1 AND b.Source = 'online' AND b.BookingDate >= '2026-08-25'
  ORDER BY b.CreatedAt DESC
`);

await pool.close();
