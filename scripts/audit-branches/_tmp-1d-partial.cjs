const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  try {
    const cols = await pool.request().query(`
      SELECT t.name AS table_name, c.name AS column_name, c.is_nullable
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      WHERE t.name IN (N'TblinvServHead', N'TblCashMove', N'TblTreasuryCloseRecon')
        AND c.name IN (N'BranchID', N'BusinessDayID')
      ORDER BY t.name, c.name
    `);
    const fks = await pool.request().query(`
      SELECT name FROM sys.foreign_keys
      WHERE name LIKE N'FK_TblinvServHead_%' OR name LIKE N'FK_TblCashMove_%' OR name LIKE N'FK_TblTreasuryCloseRecon_%'
    `);
    const trig = await pool.request().query(`
      SELECT name, is_disabled FROM sys.triggers WHERE name = N'InsCashMoveSales'
    `);
    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE BranchID IS NULL) AS inv_null_branch,
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE COL_LENGTH('dbo.TblinvServHead','BranchID') IS NOT NULL AND BranchID IS NOT NULL) AS inv_with_branch,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE COL_LENGTH('dbo.TblCashMove','BranchID') IS NOT NULL AND BranchID IS NULL) AS cash_null_branch
    `);
    console.log(JSON.stringify({ cols: cols.recordset, fks: fks.recordset, trig: trig.recordset, counts: counts.recordset[0] }, null, 2));
  } finally {
    await pool.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
