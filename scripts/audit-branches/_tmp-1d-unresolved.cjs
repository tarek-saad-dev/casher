const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  try {
    const r = await pool.request().query(`
      DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
      SELECT cm.ID, cm.invID, cm.invType, cm.invDate, cm.ShiftMoveID, cm.GrandTolal, cm.inOut
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
      LEFT JOIN dbo.TblNewDay d ON d.BranchID = @g AND d.NewDay = CAST(cm.invDate AS date)
      WHERE sm.BusinessDayID IS NULL AND d.ID IS NULL
      ORDER BY cm.ID
    `);
    console.log(JSON.stringify({ unresolvedCount: r.recordset.length, rows: r.recordset }, null, 2));
  } finally {
    await pool.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
