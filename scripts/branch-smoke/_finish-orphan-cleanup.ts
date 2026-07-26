import dotenv from 'dotenv';
import sql from 'mssql';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER!,
    database: process.env.CLOUD_DB_NAME!,
    user: process.env.CLOUD_DB_USER!,
    password: process.env.CLOUD_DB_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true },
  });
  const b = await pool.request().query(`
    SELECT BookingID, BookingCode, Source, Notes FROM dbo.Bookings WHERE BranchID=2
  `);
  console.log('bookings', b.recordset);
  const q = await pool.request().query(`
    SELECT QueueTicketID, TicketCode, Source FROM dbo.QueueTickets WHERE BranchID=2
  `);
  console.log('queue', q.recordset);

  await pool.request().query(`
    DELETE FROM dbo.QueueTickets WHERE BranchID=2 AND Source LIKE N'%smoke%'
  `);
  await pool.request().query(`
    DELETE FROM dbo.Bookings WHERE BranchID=2 AND (Source LIKE N'%smoke%' OR Notes LIKE N'%SMOKE%')
  `);

  // also delete day 4460 if still present
  await pool.request().query(`
    DELETE FROM dbo.TblShiftMove WHERE BranchID=2 AND BusinessDayID=4460;
    DELETE FROM dbo.TblNewDay WHERE BranchID=2 AND ID=4460;
  `);

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID=2) AS Bookings,
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID=2) AS Queue,
      (SELECT COUNT(*) FROM dbo.TblNewDay WHERE BranchID=2) AS Days
  `);
  console.log('after', counts.recordset[0]);
  await pool.close();
}
main();
