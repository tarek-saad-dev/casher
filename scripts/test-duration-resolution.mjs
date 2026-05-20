import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/user/Desktop/pos-system/.env.local' });

const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_DATABASE,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
});

// Set TblPro.DurationMinutes=30 for service 1049
await pool.request().query(`UPDATE dbo.TblPro SET DurationMinutes=30 WHERE ProID=1049`);
console.log('Set TblPro.DurationMinutes=30 for ProID=1049');

// Ensure EmpID=25 has NO active override for ProID=1049
await pool.request().query(`UPDATE dbo.TblEmpServiceSettings SET IsActive=0 WHERE EmpID=25 AND ProID=1049`);
console.log('Deactivated any override for EmpID=25, ProID=1049');

// Verify
const r = await pool.request().query(`SELECT ProID, DurationMinutes FROM dbo.TblPro WHERE ProID=1049`);
console.log('TblPro 1049:', JSON.stringify(r.recordset[0]));

const e25 = await pool.request().query(`SELECT EmpID, DurationMinutes, IsActive FROM dbo.TblEmpServiceSettings WHERE EmpID=25 AND ProID=1049`);
console.log('EmpID=25 override:', JSON.stringify(e25.recordset[0] ?? 'none'));

// Check empId=25 is a valid employee
const emp25 = await pool.request().query(`SELECT EmpID, EmpName, Job, isActive FROM dbo.TblEmp WHERE EmpID=25`);
console.log('EmpID=25:', JSON.stringify(emp25.recordset[0] ?? 'not found'));

await pool.close();
console.log('\n✅ Setup complete.');
