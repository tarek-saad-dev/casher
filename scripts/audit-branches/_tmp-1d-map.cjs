/**
 * Probe BusinessDayID mappability for Phase 1D (read-only).
 */
const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  try {
    const gleem = await pool.request().query(`SELECT BranchID FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'`);
    const g = gleem.recordset[0].BranchID;

    const inv = await pool.request().input('g', g).query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sm.BusinessDayID IS NOT NULL THEN 1 ELSE 0 END) AS via_shift,
        SUM(CASE WHEN sm.BusinessDayID IS NULL AND d.ID IS NOT NULL THEN 1 ELSE 0 END) AS via_date,
        SUM(CASE WHEN sm.BusinessDayID IS NULL AND d.ID IS NULL THEN 1 ELSE 0 END) AS unresolved
      FROM dbo.TblinvServHead h
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
      LEFT JOIN dbo.TblNewDay d ON d.BranchID = @g AND d.NewDay = CAST(h.invDate AS date)
    `);

    const cash = await pool.request().input('g', g).query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sm.BusinessDayID IS NOT NULL THEN 1 ELSE 0 END) AS via_shift,
        SUM(CASE WHEN sm.BusinessDayID IS NULL AND d.ID IS NOT NULL THEN 1 ELSE 0 END) AS via_date,
        SUM(CASE WHEN sm.BusinessDayID IS NULL AND d.ID IS NULL THEN 1 ELSE 0 END) AS unresolved
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
      LEFT JOIN dbo.TblNewDay d ON d.BranchID = @g AND d.NewDay = CAST(cm.invDate AS date)
    `);

    const recon = await pool.request().query(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN d.BranchID IS NULL THEN 1 ELSE 0 END) AS unresolved
      FROM dbo.TblTreasuryCloseRecon r
      LEFT JOIN dbo.TblNewDay d ON d.ID = r.NewDay
    `);

    console.log(JSON.stringify({ gleem: g, inv: inv.recordset[0], cash: cash.recordset[0], recon: recon.recordset[0] }, null, 2));
  } finally {
    await pool.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
