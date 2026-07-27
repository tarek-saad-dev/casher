/**
 * Read-only live probe for Booking Phase 2 service catalog.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool } = await import('../../src/lib/db');
  const pool = await getPool();

  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN (N'TblPro', N'TblCat')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const counts = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblPro) AS TotalRows,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0) AS ActiveRows,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0 AND (ISNULL(SPrice1,0)>0 OR ISNULL(PPrice,0)>0)) AS ActivePriced,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0 AND ISNULL(DurationMinutes,0)>0) AS ActiveTimed,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,1)=1) AS SoftDeleted,
      (SELECT COUNT(*) FROM dbo.TblPro p LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
        WHERE ISNULL(p.isDeleted,0)=0
          AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)
          AND ISNULL(p.DurationMinutes,0)>0
          AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro', N'product')
          AND LOWER(ISNULL(c.CatType,N'')) <> N'pro'
          AND ISNULL(c.CatName,N'') NOT LIKE N'%منتج%'
          AND (p.ProName IS NULL OR (p.ProName NOT LIKE N'%[[]TEST]%' AND p.ProName NOT LIKE N'%[[]SMOKE%'))
      ) AS LegitimateBookable,
      (SELECT COUNT(*) FROM dbo.TblPro p LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
        WHERE ISNULL(p.isDeleted,0)=0
          AND (LOWER(ISNULL(p.ProType,N'')) IN (N'pro', N'product') OR LOWER(ISNULL(c.CatType,N''))=N'pro'
               OR ISNULL(c.CatName,N'') LIKE N'%منتج%')) AS RetailProducts,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0 AND ISNULL(DurationMinutes,0)=0) AS InvalidDuration,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0 AND ISNULL(SPrice1,0)<0) AS InvalidPriceNeg,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0 AND CatID IS NULL) AS Uncategorized
  `);

  const deleted = await pool.request().query(`
    SELECT TOP 40 p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes, p.ProType,
           c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
    WHERE ISNULL(p.isDeleted,1)=1
    ORDER BY p.ProID
  `);

  const cats = await pool.request().query(`
    SELECT CatID, CatName, CatType
    FROM dbo.TblCat
    ORDER BY CatName
  `);

  const out = {
    columns: cols.recordset,
    counts: counts.recordset[0],
    deletedSample: deleted.recordset,
    categories: cats.recordset,
  };
  const outPath = path.join(__dirname, '_booking-phase2-service-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ counts: out.counts, catCount: cats.recordset.length, deleted: deleted.recordset.length }, null, 2));
  console.log('wrote', outPath);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
