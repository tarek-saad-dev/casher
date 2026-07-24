/** Deactivate assignments on inactive PH1GTEST branch. */
const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
const sql = require('mssql');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  // Need write — use cloud config directly
  const config = {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
  };
  if (config.database !== 'last132') throw new Error(`Expected last132, got ${config.database}`);
  const pool = await sql.connect(config);
  try {
    const r = await pool.request().query(`
      UPDATE ea
      SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      WHERE b.BranchCode = N'PH1GTEST' AND ea.IsActive = 1;
      SELECT @@ROWCOUNT AS deactivated;
    `);
    console.log(JSON.stringify(r.recordset[0]));
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
