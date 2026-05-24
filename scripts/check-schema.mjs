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

try {
  const pool = await sql.connect(config);

  console.log('========================================');
  console.log('1. TblEmpWorkSchedule Columns (Detailed)');
  console.log('========================================');
  const cols1 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmpWorkSchedule'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(cols1.recordset);

  console.log('\\n========================================');
  console.log('2. Sample Data (Top 20 rows)');
  console.log('========================================');
  const sample = await pool.request().query(`
    SELECT TOP 20 *
    FROM dbo.TblEmpWorkSchedule
    ORDER BY EmpID, DayOfWeek
  `);
  console.table(sample.recordset);

  console.log('\\n========================================');
  console.log('3. TblEmp Columns');
  console.log('========================================');
  const empCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblEmp'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(empCols.recordset);

  console.log('\\n========================================');
  console.log('4. Sunday/Monday/Saturday Data');
  console.log('========================================');
  const weekend = await pool.request().query(`
    SELECT *
    FROM dbo.TblEmpWorkSchedule
    WHERE DayOfWeek IN (0, 1, 6)
    ORDER BY EmpID, DayOfWeek
  `);
  console.table(weekend.recordset);

  console.log('\\n========================================');
  console.log('5. Summary Statistics');
  console.log('========================================');
  const summary = await pool.request().query(`
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT EmpID) as unique_employees,
      MIN(DayOfWeek) as min_dow,
      MAX(DayOfWeek) as max_dow
    FROM dbo.TblEmpWorkSchedule
  `);
  console.table(summary.recordset);
  
  // Check Bookings columns
  const cols2 = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'Bookings'
  `);
  console.log('Bookings columns:', cols2.recordset.map(r => r.COLUMN_NAME).join(', '));
  
  // Check QueueTickets columns
  const cols3 = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'QueueTickets'
  `);
  console.log('QueueTickets columns:', cols3.recordset.map(r => r.COLUMN_NAME).join(', '));
  
  // Check if TblEmpDayOff exists
  const dayOffExists = await pool.request().query(`
    SELECT OBJECT_ID('dbo.TblEmpDayOff') as oid
  `);
  console.log('TblEmpDayOff exists:', dayOffExists.recordset[0].oid !== null);
  
  await pool.close();
} catch (err) {
  console.error('Error:', err.message);
}
