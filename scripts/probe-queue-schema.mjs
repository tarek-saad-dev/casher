import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/user/Desktop/pos-system/.env.local' });

const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
});

for (const table of ['QueueTickets', 'QueueTicketServices', 'QueueTicketHistory', 'TblEmp']) {
  const r = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION
  `).catch(() => ({ recordset: [] }));
  console.log(`\n${table} columns:`);
  r.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} : ${c.DATA_TYPE}`));
}

// Check UpdatedByUserID on Bookings
const r2 = await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Bookings' AND COLUMN_NAME IN ('UpdatedByUserID','UpdatedAt')
`);
console.log('\nBookings UpdatedByUserID/UpdatedAt:', r2.recordset.map(x => x.COLUMN_NAME));

await pool.close();
