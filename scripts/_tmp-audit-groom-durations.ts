/**
 * Audit + apply Home Visit durations and package duration report.
 * Usage:
 *   npx tsx scripts/_tmp-audit-groom-durations.ts --dry-run
 *   npx tsx scripts/_tmp-audit-groom-durations.ts --apply
 */
import { readFileSync } from 'fs';
import path from 'path';
import Module from 'module';

const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const ROOT = process.cwd();
for (const envPath of ['.env.local', '.env']) {
  try {
    const envText = readFileSync(path.join(ROOT, envPath), 'utf8');
    for (const line of envText.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* ok */
  }
}

const APPLY = process.argv.includes('--apply');

const HOME_VISIT_DURATIONS: Record<number, number> = {
  1085: 60,
  1086: 90,
  1087: 120,
};

async function main() {
  const { getPool, setDbTarget, closePool, sql } = await import('../src/lib/db');
  const dbTarget = process.argv.includes('--cloud') ? 'cloud' : 'local';
  await setDbTarget(dbTarget);
  const db = await getPool();
  console.log(`DB target=${dbTarget}`);

  console.log(`\n=== HOME VISIT DURATIONS (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  for (const [proId, mins] of Object.entries(HOME_VISIT_DURATIONS)) {
    const id = Number(proId);
    const before = (
      await db
        .request()
        .input('id', sql.Int, id)
        .query(
          `SELECT ProID, ProName, SPrice1, DurationMinutes, ISNULL(isDeleted,0) isDeleted FROM dbo.TblPro WHERE ProID=@id`,
        )
    ).recordset[0] as any;
    console.log(
      `ProID ${id} "${before?.ProName}" price=${before?.SPrice1} duration before=${before?.DurationMinutes ?? 'null'} → after=${mins}`,
    );
    if (APPLY) {
      await db
        .request()
        .input('id', sql.Int, id)
        .input('mins', sql.Int, mins)
        .query(`UPDATE dbo.TblPro SET DurationMinutes=@mins WHERE ProID=@id`);
    }
  }

  console.log('\n=== PACKAGE DURATION AUDIT ===');
  const pkgs = (
    await db.request().query(`
      SELECT PackageID, NameEn, PackagePrice, DurationMinutes, IsPopular
      FROM dbo.TblServicePackage
      WHERE PackageKind=N'groom' AND isDeleted=0
      ORDER BY SortOrder, PackageID
    `)
  ).recordset as any[];

  for (const pkg of pkgs) {
    const items = (
      await db
        .request()
        .input('id', sql.Int, pkg.PackageID)
        .query(`
          SELECT i.ProID, i.IsOptional, i.SortOrder, p.ProName, p.SPrice1, p.DurationMinutes
          FROM dbo.TblServicePackageItem i
          JOIN dbo.TblPro p ON p.ProID=i.ProID
          WHERE i.PackageID=@id
          ORDER BY i.SortOrder, i.PackageItemID
        `)
    ).recordset as any[];

    const required = items.filter((i) => Number(i.IsOptional) !== 1);
    const optional = items.filter((i) => Number(i.IsOptional) === 1);
    let sum = 0;
    let nullCount = 0;
    console.log(`\n--- PackageID ${pkg.PackageID} ${pkg.NameEn} stored DurationMinutes=${pkg.DurationMinutes} price=${pkg.PackagePrice} ---`);
    console.log('Required:');
    for (const r of required) {
      const d = r.DurationMinutes == null ? null : Number(r.DurationMinutes);
      if (d == null || d <= 0) nullCount++;
      else sum += d;
      console.log(`  ProID ${r.ProID} ${r.ProName} price=${r.SPrice1} duration=${d ?? 'null'}`);
    }
    console.log(`Required duration sum (defined only)=${sum}; null/missing=${nullCount}`);
    console.log(`Stored package DurationMinutes=${pkg.DurationMinutes}`);
    console.log(
      `Delta (stored - sum)=${
        pkg.DurationMinutes == null ? 'n/a' : Number(pkg.DurationMinutes) - sum
      }`,
    );
    console.log('Optional:');
    for (const o of optional) {
      console.log(
        `  ProID ${o.ProID} ${o.ProName} price=${o.SPrice1} duration=${o.DurationMinutes ?? 'null'}`,
      );
    }

    // Propose update only if missing/stale and sum > 0
    const stored = pkg.DurationMinutes == null ? null : Number(pkg.DurationMinutes);
    const needsUpdate =
      sum > 0 && (stored == null || stored <= 0 || (nullCount === 0 && Math.abs(stored - sum) > 30));
    if (needsUpdate) {
      console.log(`PROPOSE update PackageID ${pkg.PackageID} DurationMinutes ${stored} → ${sum}`);
      if (APPLY) {
        await db
          .request()
          .input('id', sql.Int, pkg.PackageID)
          .input('mins', sql.Int, sum)
          .query(`UPDATE dbo.TblServicePackage SET DurationMinutes=@mins WHERE PackageID=@id`);
        console.log(`APPLIED PackageID ${pkg.PackageID} DurationMinutes=${sum}`);
      }
    } else {
      console.log(`KEEP PackageID ${pkg.PackageID} DurationMinutes=${stored}`);
    }
  }

  if (APPLY) {
    console.log('\n=== AFTER VERIFY HOME VISITS ===');
    const after = await db.request().query(`
      SELECT ProID, ProName, SPrice1, DurationMinutes
      FROM dbo.TblPro WHERE ProID IN (1085,1086,1087) ORDER BY ProID
    `);
    console.table(after.recordset);
  }

  if (typeof closePool === 'function') await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
