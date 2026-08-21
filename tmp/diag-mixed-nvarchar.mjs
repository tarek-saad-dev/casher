import sqlMain from 'mssql';
import sqlNative from 'mssql/msnodesqlv8.js';
import os from 'os';

const server = `${os.hostname()}\\SQLEXPRESS`;
const cs = `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`;
const pool = await new sqlNative.ConnectionPool({ connectionString: cs }).connect();
const req = pool.request();
req.input('branchCode', sqlMain.NVarChar(30), 'GLEEM');
const g = await req.query(`SELECT BranchID, BranchCode FROM dbo.TblBranch WHERE BranchCode = @branchCode`);
console.log('mixed NVarChar lookup', g.recordset);
await pool.close();
