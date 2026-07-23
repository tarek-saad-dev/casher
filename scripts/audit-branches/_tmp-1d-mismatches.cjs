const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  try {
    const r = await pool.request().query(`
      SELECT TOP 20
        cm.ID AS CashID, cm.invID, cm.invType, cm.BusinessDayID AS CashDay,
        h.BusinessDayID AS InvDay, cm.ShiftMoveID AS CashShift, h.ShiftMoveID AS InvShift,
        cm.invDate AS CashDate, h.invDate AS InvDate
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblinvServHead h ON h.invID = cm.invID AND h.invType = cm.invType
      WHERE cm.invType = N'مبيعات'
        AND cm.BusinessDayID IS NOT NULL AND h.BusinessDayID IS NOT NULL
        AND cm.BusinessDayID <> h.BusinessDayID
      ORDER BY cm.ID
    `);
    console.log(JSON.stringify(r.recordset, null, 2));

    const unresolved = await pool.request().query(`
      SELECT cm.ID, cm.invID, cm.invType, cm.invDate, cm.ShiftMoveID, cm.GrandTolal
      FROM dbo.TblCashMove cm
      WHERE cm.BusinessDayID IS NULL
      ORDER BY cm.ID
    `);
    console.log('unresolved', unresolved.recordset.length);
    console.log(JSON.stringify(unresolved.recordset.slice(-5), null, 2));
  } finally {
    await pool.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
