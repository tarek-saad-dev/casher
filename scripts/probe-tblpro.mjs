import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/user/Desktop/pos-system/.env.local' });

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

const pro = await pool.request().query(`SELECT ProID, ProName, SPrice1, DurationMinutes FROM dbo.TblPro WHERE ProID=1049`);
console.log('ProID 1049:', JSON.stringify(pro.recordset[0] ?? null));

const emp12 = await pool.request().query(`SELECT EmpID, EmpName, Job, isActive FROM dbo.TblEmp WHERE EmpID=12`);
console.log('Emp 12:', JSON.stringify(emp12.recordset[0] ?? null));

const sched12 = await pool.request().query(`SELECT DayOfWeek, IsWorkingDay, StartTime, EndTime FROM dbo.TblEmpWorkSchedule WHERE EmpID=12 ORDER BY DayOfWeek`);
console.log('Emp 12 schedule:', JSON.stringify(sched12.recordset));

await pool.close();
