import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/user/Desktop/pos-system/.env.local' });

const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
});

// 1. Raw booking row for id=49 (or latest booking)
const bRes = await pool.request().query(`
  SELECT TOP 1 BookingID, BookingDate, StartTime, EndTime, AssignedEmpID, Status
  FROM dbo.Bookings ORDER BY BookingID DESC
`);
const row = bRes.recordset[0];
console.log('\n=== Latest Booking ===');
console.log(JSON.stringify(row, null, 2));
console.log('typeof BookingDate:', typeof row?.BookingDate, '| value:', row?.BookingDate);
console.log('typeof StartTime:  ', typeof row?.StartTime,   '| value:', row?.StartTime);
console.log('typeof EndTime:    ', typeof row?.EndTime,     '| value:', row?.EndTime);
if (row?.StartTime instanceof Date) {
  console.log('StartTime is Date — UTC:', row.StartTime.toISOString());
  console.log('StartTime UTCHours:', row.StartTime.getUTCHours(), 'UTCMinutes:', row.StartTime.getUTCMinutes());
}

// 2. Column types in QueueTickets
const colRes = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'QueueTickets'
    AND COLUMN_NAME IN ('EstimatedStartTime','EstimatedEndTime','EstimatedWaitMinutes','WaitingCountAtCreation','CreatedTime')
  ORDER BY COLUMN_NAME
`);
console.log('\n=== QueueTickets column types ===');
console.log(JSON.stringify(colRes.recordset, null, 2));

// 3. Column types in Bookings for StartTime / BookingDate
const bColRes = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Bookings'
    AND COLUMN_NAME IN ('BookingDate','StartTime','EndTime')
`);
console.log('\n=== Bookings column types ===');
console.log(JSON.stringify(bColRes.recordset, null, 2));

// 4. Simulate what the route does: new Date(`${today}T${StartTime}`)
const today = new Date().toISOString().slice(0, 10);
const st = row?.StartTime;
let simulatedStart;
if (st instanceof Date) {
  simulatedStart = new Date(`${today}T${st.toISOString()}`);
  console.log('\n=== Simulation: new Date(today + T + StartTime.toISOString()) ===');
  console.log('result:', simulatedStart, '| isNaN:', isNaN(simulatedStart.getTime()));
} else {
  simulatedStart = new Date(`${today}T${st}`);
  console.log('\n=== Simulation: new Date(today + T + StartTime string) ===');
  console.log('result:', simulatedStart, '| isNaN:', isNaN(simulatedStart.getTime()));
}

await pool.close();
