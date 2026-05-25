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

  const clients = await pool.request().query(
    'SELECT TOP 1 ClientID, Name FROM dbo.TblClient ORDER BY ClientID ASC'
  );
  const emps = await pool.request().query(
    "SELECT TOP 1 EmpID, EmpName FROM dbo.TblEmp WHERE isActive=1 ORDER BY EmpID ASC"
  );

  const client = clients.recordset[0];
  const emp = emps.recordset[0];

  await pool.request().query(
    "DELETE FROM dbo.Bookings WHERE BookingCode = 'TEST-1230'"
  );

  const r = await pool.request()
    .input('cid', sql.Int, client.ClientID)
    .input('eid', sql.Int, emp.EmpID)
    .query(`
      INSERT INTO dbo.Bookings
        (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
         Status, Source, BookingCode, CreatedByUserID)
      OUTPUT INSERTED.BookingID, INSERTED.BookingDate, INSERTED.StartTime
      VALUES
        (@cid, @eid,
         CAST(GETDATE() AS date),
         '12:30:00',
         '13:00:00',
         'confirmed', 'test', 'TEST-1230', 0)
    `);

  const row = r.recordset[0];
  console.log('Inserted BookingID:', row.BookingID);
  console.log('Date:', row.BookingDate);
  console.log('StartTime:', row.StartTime);
  console.log('Client:', client.Name, '| Emp:', emp.EmpName);
  console.log('\nWaiting for 12:30 => check due-announcements');

  await pool.close();
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
