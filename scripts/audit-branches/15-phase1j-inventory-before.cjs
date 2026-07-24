/**
 * Phase 1J — before fingerprint (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, database } = await connectReadOnly();
  if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);

  const q = async (sqlText) => (await pool.request().query(sqlText)).recordset;

  const branches = await q(
    `SELECT BranchID, BranchCode, BranchName, IsActive FROM dbo.TblBranch ORDER BY BranchID`,
  );
  const proCols = await q(`
    SELECT c.name, ty.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable
    FROM sys.columns c
    JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.TblPro')
    ORDER BY c.column_id
  `);
  const catTypes = await q(`
    SELECT ISNULL(c.CatType, N'(null)') AS CatType, COUNT(*) AS cnt
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    GROUP BY c.CatType
  `);
  const proTypes = await q(`
    SELECT ISNULL(ProType, N'(null)') AS ProType, COUNT(*) AS cnt, SUM(ISNULL(Qty, 0)) AS qtySum
    FROM dbo.TblPro
    GROUP BY ProType
  `);
  const products = await q(`
    SELECT
      p.ProID, p.ProName, p.ProType, p.Qty, p.CatID,
      c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY p.ProID
  `);
  const qtyStats = await q(`
    SELECT
      COUNT(*) AS rows,
      SUM(CASE WHEN Qty IS NULL THEN 1 ELSE 0 END) AS nullQty,
      SUM(CASE WHEN ISNULL(Qty, 0) <> 0 THEN 1 ELSE 0 END) AS nonzero,
      SUM(CAST(ISNULL(Qty, 0) AS decimal(18,4))) AS totalQty
    FROM dbo.TblPro
  `);
  const moveCols = await q(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblProMove')
    ORDER BY c.column_id
  `);
  const moves = await q(`SELECT * FROM dbo.TblProMove`);
  const purchaseHeadCols = await q(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead')
    ORDER BY c.column_id
  `);
  const purchaseCounts = await q(`
    SELECT 'TblinvPurchaseHead' AS t, COUNT(*) AS c FROM dbo.TblinvPurchaseHead
    UNION ALL SELECT 'TblinvPurchaseDetail', COUNT(*) FROM dbo.TblinvPurchaseDetail
    UNION ALL SELECT 'TblinvRePurchase', COUNT(*) FROM dbo.TblinvRePurchase
  `);
  const repurchaseCols = await q(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblinvRePurchase')
    ORDER BY c.column_id
  `).catch(() => []);
  const triggers = await q(`
    SELECT OBJECT_SCHEMA_NAME(t.parent_id) + N'.' + OBJECT_NAME(t.parent_id) AS parentObj, t.name
    FROM sys.triggers t
    WHERE t.is_ms_shipped = 0
    ORDER BY 1, 2
  `);
  const barcode = await q(`SELECT COUNT(*) AS c FROM dbo.TblBarCode`);

  // Classification preview: CatType pro/Pro OR ProType pro (case-insensitive)
  const classified = products.map((p) => {
    const cat = String(p.CatType || '').toLowerCase();
    const pt = String(p.ProType || '').toLowerCase();
    const track =
      cat === 'pro' || pt === 'pro' || pt === 'product' || pt === 'منتج';
    return { ...p, trackStockCandidate: track };
  });

  const out = {
    capturedAt: new Date().toISOString(),
    database,
    branches,
    proCols,
    catTypes,
    proTypes,
    qtyStats: qtyStats[0],
    products: classified,
    trackStockCandidates: classified.filter((p) => p.trackStockCandidate).length,
    nonTrackCandidates: classified.filter((p) => !p.trackStockCandidate).length,
    moveCols: moveCols.map((r) => r.name),
    moveCount: moves.length,
    moves,
    purchaseHeadCols: purchaseHeadCols.map((r) => r.name),
    repurchaseCols: repurchaseCols.map((r) => r.name),
    purchaseCounts,
    triggers,
    barcodeCount: barcode[0].c,
  };

  const outPath = path.join(__dirname, '_phase1j-inventory-before.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({
    database,
    branches,
    qtyStats: out.qtyStats,
    trackStockCandidates: out.trackStockCandidates,
    nonTrackCandidates: out.nonTrackCandidates,
    moveCount: out.moveCount,
    purchaseCounts: out.purchaseCounts,
    outPath,
  }, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
