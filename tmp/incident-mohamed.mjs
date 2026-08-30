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

await q('Mohamed Mamdouh client 13388 bookings Aug 28', `
  SELECT b.*, br.BranchCode, e.EmpName, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
  LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
  WHERE b.ClientID = 13388 AND b.BookingDate >= '2026-08-27' AND b.BookingDate <= '2026-08-29'
  ORDER BY b.CreatedAt DESC
`);

await q('Mohamed Mamdouh client 13388 all recent bookings', `
  SELECT TOP 10 b.BookingID, b.BookingCode, b.BookingDate, b.StartTime, b.AbsoluteStartUtc,
         b.Status, b.Source, b.CreatedAt, br.BranchCode, e.EmpName
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
  LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
  WHERE b.ClientID = 13388
  ORDER BY b.CreatedAt DESC
`);

await q('Idempotency with Mohamed phone digest', `
  SELECT TOP 10 RequestID, IdempotencyKey, Status, BookingID, BookingCode, CreatedAt, LEFT(ResponseJson, 300) AS ResponsePreview
  FROM dbo.TblPublicBookingCreateRequest
  WHERE CreatedAt >= '2026-08-28' AND CreatedAt < '2026-08-29'
  ORDER BY CreatedAt DESC
`);

await q('Public create requests Aug 28 afternoon', `
  SELECT RequestID, Status, BookingID, BookingCode, CreatedAt
  FROM dbo.TblPublicBookingCreateRequest
  WHERE CreatedAt >= '2026-08-28T11:00:00' AND CreatedAt < '2026-08-28T15:00:00'
  ORDER BY CreatedAt
`);

await pool.close();
