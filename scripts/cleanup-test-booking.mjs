import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/user/Desktop/pos-system/.env.local' });

const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
});

const r = await pool.request().query(`DELETE FROM dbo.Bookings WHERE BookingCode = 'BK-E9Z4E5'`);
console.log('Deleted test booking rows:', r.rowsAffected[0]);
await pool.close();
