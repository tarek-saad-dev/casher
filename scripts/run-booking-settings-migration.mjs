import sql from 'mssql';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
});

console.log(`Connected to: ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);

const migrationSql = readFileSync(
  join(__dirname, '..', 'db', 'migrations', 'add-booking-settings-columns.sql'),
  'utf8'
);

const batches = migrationSql.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
for (const batch of batches) {
  await pool.request().query(batch).catch(err => {
    console.error('Batch error:', err.message);
    console.error('Batch was:', batch.slice(0, 120));
  });
}

// Verify
const cols = await pool.request().query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='QueueBookingSettings' ORDER BY ORDINAL_POSITION`
);
console.log('\nQueueBookingSettings columns:', cols.recordset.map(r => r.COLUMN_NAME).join(', '));

const row = await pool.request().query(`SELECT TOP 1 * FROM dbo.QueueBookingSettings`);
console.log('QueueBookingSettings row:', JSON.stringify(row.recordset[0]));

const proCols = await pool.request().query(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TblPro' ORDER BY ORDINAL_POSITION`
);
console.log('\nTblPro columns:', proCols.recordset.map(r => r.COLUMN_NAME).join(', '));

const pro = await pool.request().query(`SELECT ProID, ProName, SPrice1, DurationMinutes FROM dbo.TblPro WHERE ProID=1049`);
console.log('ProID 1049:', JSON.stringify(pro.recordset[0] ?? null));

await pool.close();
console.log('\n✅ Migration complete.');
