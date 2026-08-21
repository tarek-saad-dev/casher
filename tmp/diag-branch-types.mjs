import sql from 'mssql/msnodesqlv8.js';
import os from 'os';

const server = `${os.hostname()}\\SQLEXPRESS`;
const cs = `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=HawaiBookingV2Isolated;Trusted_Connection=Yes;TrustServerCertificate=Yes;`;
const pool = await new sql.ConnectionPool({ connectionString: cs }).connect();
const r = await pool.request().query(`
  SELECT BranchID, BranchCode, BranchName, IsActive, LifecycleStatus, PublicBookingEnabled
  FROM dbo.TblBranch
`);
for (const row of r.recordset) {
  const v = row.BranchCode;
  console.log({
    BranchID: row.BranchID,
    BranchCode: v,
    type: typeof v,
    ctor: v?.constructor?.name,
    json: JSON.stringify(v),
    IsActive: row.IsActive,
    isActiveType: typeof row.IsActive,
    life: row.LifecycleStatus,
  });
}
const g = await pool.request().input('branchCode', sql.NVarChar(30), 'GLEEM').query(`
  SELECT BranchID, BranchCode FROM dbo.TblBranch WHERE BranchCode = @branchCode
`);
console.log('lookup GLEEM', g.recordset);
await pool.close();
