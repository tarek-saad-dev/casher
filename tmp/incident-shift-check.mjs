import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const pool = await sql.connect({
  server: process.env.DB_SERVER || '127.0.0.1',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
});

function sqlTimeToHhmm(v) {
  if (!v) return '00:00';
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2,'0')}:${String(v.getUTCMinutes()).padStart(2,'0')}`;
  return String(v).slice(0,5);
}

const b = await pool.request().query(`SELECT * FROM dbo.Bookings WHERE BookingID=3816`);
const row = b.recordset[0];
const startH = sqlTimeToHhmm(row.StartTime);
const endH = sqlTimeToHhmm(row.EndTime);
console.log('BOOKING 3816 StartTime parsed:', startH, 'End:', endH, 'AbsoluteStartUtc:', row.AbsoluteStartUtc);

await pool.request().query(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TblEmpAttendance' ORDER BY ORDINAL_POSITION
`).then(r => console.log('ATTENDANCE COLS:', r.recordset.map(x=>x.COLUMN_NAME).join(', ')));

const att = await pool.request().query(`SELECT TOP 5 * FROM dbo.TblEmpAttendance WHERE EmpID=7 ORDER BY 1 DESC`);
console.log('EMP7 ATTENDANCE:', JSON.stringify(att.recordset, null, 2));

const sched = await pool.request().query(`
  SELECT * FROM dbo.TblEmpBranchWorkSchedule WHERE EmpID=7 AND BranchID=1
`);
console.log('EMP7 SCHEDULE:', JSON.stringify(sched.recordset, null, 2));

const overrides = await pool.request().query(`
  SELECT TOP 10 * FROM dbo.TblEmpScheduleOverride WHERE EmpID=7 AND OverrideDate BETWEEN '2026-08-27' AND '2026-08-29'
`);
console.log('EMP7 OVERRIDES:', JSON.stringify(overrides.recordset, null, 2));

// Compare booking 3811 (earlier same day, same barber) 
const cmp = await pool.request().query(`
  SELECT BookingID, StartTime, EndTime, AbsoluteStartUtc, AbsoluteEndUtc, CreatedAt
  FROM dbo.Bookings WHERE BookingID IN (3811,3813,3816)
`);
console.log('COMPARE TIMES:', JSON.stringify(cmp.recordset, null, 2));

await pool.close();
