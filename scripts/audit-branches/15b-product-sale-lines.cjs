const path = require('path');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool } = await connectReadOnly();
  const r = await pool.request().query(`
    SELECT COUNT(*) AS lines, ISNULL(SUM(d.Qty),0) AS qty
    FROM dbo.TblinvServDetail d
    INNER JOIN dbo.TblPro p ON p.ProID = d.ProID
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE LOWER(ISNULL(c.CatType, N'')) = N'pro'
       OR LOWER(ISNULL(p.ProType, N'')) = N'pro'
  `);
  const recent = await pool.request().query(`
    SELECT TOP 8 h.invID, h.invDate, d.ProID, p.ProName, d.Qty, h.BranchID
    FROM dbo.TblinvServDetail d
    INNER JOIN dbo.TblinvServHead h ON h.invID = d.invID AND h.invType = d.invType
    INNER JOIN dbo.TblPro p ON p.ProID = d.ProID
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE LOWER(ISNULL(c.CatType, N'')) = N'pro'
       OR LOWER(ISNULL(p.ProType, N'')) = N'pro'
    ORDER BY h.invDate DESC, h.invID DESC
  `);
  console.log(JSON.stringify({ productLines: r.recordset[0], recent: recent.recordset }, null, 2));
  await pool.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
