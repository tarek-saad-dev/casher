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

console.log(`Connected: ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);

const migSql = readFileSync(
  join(__dirname, '..', 'db', 'migrations', 'add-emp-service-settings.sql'),
  'utf8'
);

const batches = migSql.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
for (const batch of batches) {
  await pool.request().query(batch).catch(err => {
    console.error('Batch error:', err.message.slice(0, 120));
  });
}

// Verify
const rows = await pool.request().query(
  `SELECT ID, EmpID, ProID, DurationMinutes, IsActive, Notes FROM dbo.TblEmpServiceSettings ORDER BY EmpID, ProID`
);
console.log('\nTblEmpServiceSettings rows:', JSON.stringify(rows.recordset, null, 2));

await pool.close();
console.log('\n✅ Migration complete.');
