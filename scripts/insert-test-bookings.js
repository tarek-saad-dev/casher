/**
 * Test script: inserts two test bookings for due-announcements testing.
 * Run: node scripts/insert-test-bookings.js
 */
const sql = require('mssql');

const config = {
  server: 'newserverr.database.windows.net',
  database: 'last132',
  user: 'CloudSA942448b3',
  password: 'SAad@1976',
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

async function run() {
  const pool = await sql.connect(config);
  console.log('Connected to Azure SQL!');

  // Get valid ClientID
  const clients = await pool.request().query(
    'SELECT TOP 1 ClientID, Name FROM dbo.TblClient ORDER BY ClientID ASC'
  );
  const client = clients.recordset[0];

  // Get valid active barber EmpID
  const emps = await pool.request().query(
    "SELECT TOP 1 EmpID, EmpName FROM dbo.TblEmp WHERE isActive=1 ORDER BY EmpID ASC"
  );
  const emp = emps.recordset[0];

  console.log('Using ClientID:', client?.ClientID, '|', client?.Name);
  console.log('Using EmpID:', emp?.EmpID, '|', emp?.EmpName);

  if (!client || !emp) {
    console.error('No client or employee found — aborting');
    process.exit(1);
  }

  // Clean up old test bookings first
  await pool.request().query(
    "DELETE FROM dbo.Bookings WHERE BookingCode IN ('TEST-PAST', 'TEST-FUTURE')"
  );
  console.log('Cleaned up old test bookings');

  // Insert TEST-PAST: StartTime = 2 minutes ago => should appear in due-announcements
  const r1 = await pool.request()
    .input('cid', sql.Int, client.ClientID)
    .input('eid', sql.Int, emp.EmpID)
    .query(`
      INSERT INTO dbo.Bookings
        (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
         Status, Source, BookingCode, CreatedByUserID)
      OUTPUT INSERTED.BookingID, INSERTED.StartTime, INSERTED.BookingDate
      VALUES
        (@cid, @eid,
         CAST(GETDATE() AS date),
         FORMAT(DATEADD(MINUTE,-2, GETDATE()), 'HH:mm:ss'),
         FORMAT(DATEADD(MINUTE,28, GETDATE()), 'HH:mm:ss'),
         'confirmed', 'test', 'TEST-PAST', 0)
    `);
  const past = r1.recordset[0];
  console.log('TEST-PAST inserted  => BookingID:', past.BookingID,
    '| Date:', past.BookingDate, '| StartTime:', past.StartTime,
    '=> SHOULD appear in due-announcements');

  // Insert TEST-FUTURE: StartTime = 10 minutes from now => should NOT appear
  const r2 = await pool.request()
    .input('cid', sql.Int, client.ClientID)
    .input('eid', sql.Int, emp.EmpID)
    .query(`
      INSERT INTO dbo.Bookings
        (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
         Status, Source, BookingCode, CreatedByUserID)
      OUTPUT INSERTED.BookingID, INSERTED.StartTime, INSERTED.BookingDate
      VALUES
        (@cid, @eid,
         CAST(GETDATE() AS date),
         FORMAT(DATEADD(MINUTE,10, GETDATE()), 'HH:mm:ss'),
         FORMAT(DATEADD(MINUTE,40, GETDATE()), 'HH:mm:ss'),
         'confirmed', 'test', 'TEST-FUTURE', 0)
    `);
  const future = r2.recordset[0];
  console.log('TEST-FUTURE inserted => BookingID:', future.BookingID,
    '| Date:', future.BookingDate, '| StartTime:', future.StartTime,
    '=> should NOT appear in due-announcements');

  await pool.close();
  console.log('\nDone. Now call:');
  console.log('GET http://localhost:5500/api/operations/queue/due-announcements?date=' +
    new Date().toISOString().slice(0, 10));
}

run().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
