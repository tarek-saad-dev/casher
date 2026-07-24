/**
 * Phase 1J after fingerprint.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, database } = await connectReadOnly();
  if (database !== 'last132') throw new Error(database);

  const q = async (s) => (await pool.request().query(s)).recordset;

  const out = {
    capturedAt: new Date().toISOString(),
    database,
    branches: await q(
      `SELECT BranchID, BranchCode, IsActive FROM dbo.TblBranch ORDER BY BranchID`,
    ),
    inventoryByBranch: await q(`
      SELECT b.BranchCode, COUNT(*) AS rows, SUM(bi.QtyOnHand) AS qtySum
      FROM dbo.TblBranchInventory bi
      INNER JOIN dbo.TblBranch b ON b.BranchID = bi.BranchID
      GROUP BY b.BranchCode
    `),
    gleemBalances: await q(`
      SELECT bi.ProID, p.ProName, bi.QtyOnHand
      FROM dbo.TblBranchInventory bi
      INNER JOIN dbo.TblBranch b ON b.BranchID = bi.BranchID AND b.BranchCode = N'GLEEM'
      INNER JOIN dbo.TblPro p ON p.ProID = bi.ProID
      ORDER BY bi.ProID
    `),
    movementCount: (await q(`SELECT COUNT(*) AS c FROM dbo.TblInventoryMovement`))[0],
    purchaseNullBranch: (
      await q(`SELECT COUNT(*) AS c FROM dbo.TblinvPurchaseHead WHERE BranchID IS NULL`)
    )[0],
    purchaseCount: (await q(`SELECT COUNT(*) AS c FROM dbo.TblinvPurchaseHead`))[0],
    tblProQtyStill: (
      await q(`SELECT SUM(CAST(ISNULL(Qty,0) AS decimal(18,4))) AS totalQty FROM dbo.TblPro`)
    )[0],
  };

  const outPath = path.join(__dirname, '_phase1j-inventory-after.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
