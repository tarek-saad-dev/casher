import sqlMain from 'mssql';
import sqlNative from 'mssql/msnodesqlv8.js';
import os from 'os';
import fs from 'fs';

const server = `${os.hostname()}\\SQLEXPRESS`;
const cs = `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`;

const pool = await new sqlNative.ConnectionPool({
  connectionString: cs,
  connectionTimeout: 10000,
  requestTimeout: 10000,
}).connect();

const req = pool.request();
req.input('id', sqlMain.Int, 12);
const r = await req.query('SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID=@id');
fs.writeFileSync('tmp/trusted-mixed-sql.json', JSON.stringify(r.recordset, null, 2));
console.log(r.recordset);
await pool.close();
