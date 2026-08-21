#!/usr/bin/env npx tsx
/** Cancel leftover probe booking 2723 on VPS only. */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
if (/\.database\.windows\.net$/i.test(String(process.env.DB_SERVER))) {
  throw new Error('REFUSE Azure');
}
const password = String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, '');
const pool = await new sql.ConnectionPool({
  server: process.env.DB_SERVER!,
  database: process.env.DB_DATABASE!,
  user: process.env.DB_USER!,
  password,
  port: 1433,
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
const r = await pool
  .request()
  .input('id', sql.Int, 2723)
  .query(`
    UPDATE dbo.Bookings
    SET Status='cancelled', CancelReason='VPS_TEST_PROBE_CLEANUP', CancelledAt=GETDATE(), UpdatedAt=GETDATE()
    WHERE BookingID=@id AND Notes LIKE N'VPS_TEST%'
  `);
console.log('rowsAffected', r.rowsAffected);
await pool.close();
