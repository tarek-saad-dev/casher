import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/user/Desktop/pos-system/.env.local' });

const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
});

const r = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Bookings' ORDER BY ORDINAL_POSITION
`);
console.log('Bookings columns:');
r.recordset.forEach(c => console.log(' ', c.COLUMN_NAME, ':', c.DATA_TYPE));

// Check BookingServices columns
const r2 = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'BookingServices' ORDER BY ORDINAL_POSITION
`);
console.log('\nBookingServices columns:');
r2.recordset.forEach(c => console.log(' ', c.COLUMN_NAME, ':', c.DATA_TYPE));

await pool.close();
