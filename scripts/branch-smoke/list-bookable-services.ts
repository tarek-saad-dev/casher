import path from 'path';
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
  const r = await pool.request().query(`
    SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes, p.ProType,
           c.CatID, c.CatName, c.CatType, c.SortOrder, p.ImageUrl
    FROM dbo.TblPro p LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
    WHERE ISNULL(p.isDeleted,0)=0
      AND ISNULL(p.SPrice1,0)>0
      AND ISNULL(p.DurationMinutes,0)>0
      AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro', N'product')
      AND LOWER(ISNULL(c.CatType,N'')) <> N'pro'
      AND ISNULL(c.CatName,N'') NOT LIKE N'%منتج%'
      AND (p.ProName IS NULL OR (p.ProName NOT LIKE N'%[[]TEST]%' AND p.ProName NOT LIKE N'%[[]SMOKE%'))
    ORDER BY ISNULL(c.SortOrder,999), c.CatName, p.ProName
  `);
  console.log('count', r.recordset.length);
  for (const row of r.recordset) {
    console.log(
      row.ProID,
      row.CatName,
      row.SortOrder,
      row.ProName,
      row.SPrice1,
      row.DurationMinutes,
      row.ProType,
    );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
