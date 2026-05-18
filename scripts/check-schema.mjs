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
  
  // Check TblEmpWorkSchedule columns
  const cols1 = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmpWorkSchedule'
  `);
  console.log('TblEmpWorkSchedule columns:', cols1.recordset.map(r => r.COLUMN_NAME).join(', '));
  
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
