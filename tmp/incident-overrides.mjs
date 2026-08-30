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

await q('Schedule overrides emp7 Aug28', `
  SELECT * FROM dbo.TblEmpScheduleOverrides
  WHERE EmpID = 7 AND OverrideDate = '2026-08-28' AND IsActive = 1
`);

await q('All schedule overrides emp7 recent', `
  SELECT TOP 10 * FROM dbo.TblEmpScheduleOverrides
  WHERE EmpID = 7 AND OverrideDate >= '2026-08-25'
  ORDER BY OverrideDate DESC
`);

await q('Working GLEEM online booking before regression - 3788', `
  SELECT b.BookingID, b.BookingCode, b.BranchID, b.AssignedEmpID, b.BookingDate,
         b.PublicWorkDate, b.StartTime, b.EndTime, b.AbsoluteStartUtc, b.Status, b.Source, b.CreatedAt, c.Name
  FROM dbo.Bookings b
  LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
  WHERE b.BookingID = 3788
`);

await pool.close();
