import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function main() {
  const { getPool } = await import('../src/lib/db');
  const db = await getPool();
  const miss = await db.request().query(`
    SELECT ProID, ProName, ProNameAr FROM dbo.TblPro
    WHERE ISNULL(isDeleted,0)=0 AND (ProNameAr IS NULL OR LTRIM(RTRIM(ProNameAr))=N'')
  `);
  const arabicOnly = await db.request().query(`
    SELECT ProID, ProName, ProNameAr FROM dbo.TblPro
    WHERE ISNULL(isDeleted,0)=0
      AND ProName IS NOT NULL
      AND ProName LIKE N'%[ء-ي]%'
    ORDER BY ProID
  `);
  console.log('missingAr', JSON.stringify(miss.recordset, null, 2));
  console.log('arabicInProName', JSON.stringify(arabicOnly.recordset, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
