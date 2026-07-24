const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  const detail = await pool.request().query(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseDetail')
    ORDER BY c.column_id
  `);
  const bal = await pool.request().query(`
    SELECT b.BranchCode, COUNT(*) AS rows, SUM(bi.QtyOnHand) AS qtySum
    FROM dbo.TblBranchInventory bi
    INNER JOIN dbo.TblBranch b ON b.BranchID = bi.BranchID
    GROUP BY b.BranchCode
  `);
  const mov = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.TblInventoryMovement`);
  const purchCol = await pool.request().query(`
    SELECT c.name, c.is_nullable
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND c.name IN (N'BranchID', N'PostStatus')
  `);
  console.log(JSON.stringify({
    detailCols: detail.recordset.map((r) => r.name),
    balances: bal.recordset,
    movements: mov.recordset[0],
    purchaseCols: purchCol.recordset,
  }, null, 2));
  await pool.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
