import sql from 'mssql';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

console.log('Connecting to DB...');
const pool = await sql.connect(config);
console.log('Connected!');

console.log('\n=== TblEmpWorkSchedule Columns ===');
const cols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'TblEmpWorkSchedule'
  ORDER BY ORDINAL_POSITION
`);

for (const row of cols.recordset) {
  console.log(`  ${row.COLUMN_NAME.padEnd(20)} | ${row.DATA_TYPE.padEnd(15)} | ${row.IS_NULLABLE}`);
}

console.log('\n=== TblEmp Columns ===');
const empCols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'TblEmp'
  ORDER BY ORDINAL_POSITION
`);

for (const row of empCols.recordset) {
  console.log(`  ${row.COLUMN_NAME.padEnd(20)} | ${row.DATA_TYPE.padEnd(15)} | ${row.IS_NULLABLE}`);
}

await pool.close();
console.log('\nDone!');
