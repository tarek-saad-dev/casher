/**
 * Focused read-only inspection — exact ProIDs for regular package seed.
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
function loadEnvLocal(): void {
  for (const envPath of ['.env.local', '.env']) {
    try {
      readFileSync(path.join(ROOT, envPath), 'utf8')
        .split('\n')
        .forEach((line) => {
          const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
          if (m && !process.env[m[1]]) {
            process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
          }
        });
    } catch {
      /* ok */
    }
  }
}

const EXACT_PROIDS = [9, 10, 11, 12, 29, 22, 44, 47, 31, 32];

async function main(): Promise<void> {
  loadEnvLocal();
  const { getPool, setDbTarget } = await import('../src/lib/db');
  await setDbTarget('local');
  const { evaluateServiceEligibility } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { getPublicBookingServicesCatalog } = await import(
    '../src/lib/booking/publicBookingServices'
  );
  const { getServicePackageById } = await import('../src/lib/catalog/servicePackages');

  const db = await getPool();

  const exact = await db.request().query(`
    SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
           ISNULL(p.isDeleted,0) AS isDeleted, c.CatID, c.CatName
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE p.ProID IN (${EXACT_PROIDS.join(',')})
    ORDER BY p.ProID
  `);

  const branches = ['GLEEM', 'CAMP_CAESAR'];
  const bookable = new Map<string, Set<number>>();
  for (const code of branches) {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode: code,
      purpose: 'public_booking',
    });
    const cat = await getPublicBookingServicesCatalog(ctx);
    bookable.set(code, new Set(cat.services.map((s) => s.serviceId)));
  }

  console.log('=== CONFIRMED SERVICE ProIDs ===');
  for (const r of exact.recordset) {
    const elig = evaluateServiceEligibility(r);
    const branchStr = branches
      .map((b) => `${b}=${bookable.get(b)!.has(r.ProID) ? 'bookable' : 'NOT'}`)
      .join(', ');
    console.log(
      `${r.ProName} -> ProID=${r.ProID} | ${r.SPrice1} EGP | ${r.DurationMinutes ?? 'null'} min | ${r.CatName} | deleted=${r.isDeleted} | eligible=${elig.eligible ? 'yes' : elig.reason} | ${branchStr}`,
    );
    if (r.ProNameAr) console.log(`  AR: ${r.ProNameAr}`);
  }

  const skinAll = await db.request().query(`
    SELECT ProID, ProName, ProNameAr, SPrice1, DurationMinutes, ISNULL(isDeleted,0) AS isDeleted
    FROM dbo.TblPro
    WHERE ProName LIKE N'%Skin%' AND ISNULL(isDeleted,0)=0
    ORDER BY ProID
  `);
  console.log('\n=== ALL ACTIVE SKIN SERVICES ===');
  for (const r of skinAll.recordset) {
    console.log(`  ProID=${r.ProID} | ${r.ProName} / ${r.ProNameAr ?? '—'} | ${r.SPrice1} EGP | ${r.DurationMinutes} min`);
  }

  const waxAll = await db.request().query(`
    SELECT ProID, ProName, ProNameAr, SPrice1, DurationMinutes, ISNULL(isDeleted,0) AS isDeleted
    FROM dbo.TblPro
    WHERE ProName LIKE N'%Wax%' AND ISNULL(isDeleted,0)=0
    ORDER BY ProID
  `);
  console.log('\n=== ALL ACTIVE WAX SERVICES ===');
  for (const r of waxAll.recordset) {
    console.log(`  ProID=${r.ProID} | ${r.ProName} / ${r.ProNameAr ?? '—'} | ${r.SPrice1} EGP | ${r.DurationMinutes} min`);
  }

  const massage = await db.request().query(`
    SELECT ProID, ProName, ProNameAr, SPrice1, DurationMinutes, ISNULL(isDeleted,0) AS isDeleted
    FROM dbo.TblPro
    WHERE (ProName LIKE N'%Massage%' OR ProNameAr LIKE N'%تدليك%')
      AND ISNULL(isDeleted,0)=0
    ORDER BY ProID
  `);
  console.log('\n=== ACTIVE MASSAGE-LIKE SERVICES ===');
  if (!massage.recordset.length) console.log('  (none)');
  for (const r of massage.recordset) {
    console.log(`  ProID=${r.ProID} | ${r.ProName} / ${r.ProNameAr ?? '—'} | ${r.SPrice1} EGP | ${r.DurationMinutes} min`);
  }

  const oil = await db.request().query(`
    SELECT ProID, ProName, ProNameAr, SPrice1, DurationMinutes, ISNULL(isDeleted,0) AS isDeleted, c.CatName
    FROM dbo.TblPro p LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
    WHERE (ProName LIKE N'%Oil%' OR ProName LIKE N'%زيت%') AND ISNULL(p.isDeleted,0)=0
    ORDER BY ProID
  `);
  console.log('\n=== ACTIVE OIL TREATMENT SERVICES ===');
  for (const r of oil.recordset) {
    console.log(`  ProID=${r.ProID} | ${r.ProName} / ${r.ProNameAr ?? '—'} | ${r.SPrice1} EGP | ${r.DurationMinutes} min | ${r.CatName}`);
  }

  // Groom example for structure reference
  const groom = await getServicePackageById(db, 2);
  console.log('\n=== GROOM PACKAGE EXAMPLE (Signature Groom — structure reference) ===');
  console.log(`PackageID=${groom?.PackageID} kind=${groom?.PackageKind} price=${groom?.PackagePrice} original=${groom?.OriginalPrice} popular=${groom?.IsPopular}`);
  console.log('Items:');
  for (const i of groom?.items ?? []) {
    console.log(`  ProID=${i.ProID} ${i.ProName} qty=${i.Qty} sort=${i.SortOrder} optional=${i.IsOptional} price=${i.SPrice1}`);
  }

  // Totals with manual resolution
  const map = {
    Haircut: 9,
    Beard: 10,
    'Fresh Skin Care': 11,
    'Classic Skin Care': 12, // verify from skin list
    'Deep Skin Care': 29, // verify - might be 12
    'Hair Mask': 44,
    'Hair Styling': 47,
    'Hair Oil Treatment': 22,
    'Face Wax': 31, // verify from wax list
  };

  const byId = new Map<number, (typeof exact.recordset)[0]>();
  for (const r of exact.recordset) byId.set(r.ProID, r);
  for (const r of skinAll.recordset) byId.set(r.ProID, r);
  for (const r of waxAll.recordset) byId.set(r.ProID, r);

  console.log('\n=== PACKAGE TOTALS (manual ProID picks) ===');
  const plans = [
    { name: 'CUT Fresh', sell: 350, target: 700, ids: [9, 10, 11, 44, 'NEW_HEAD_MASSAGE_100', 47] },
    { name: 'CUT Care', sell: 555, target: 850, ids: [9, 10, 22, 12, 'NEW_HEAD_MASSAGE_100', 47] },
    { name: 'CUT Premium', sell: 750, target: 1200, ids: [9, 10, 'NEW_ADV_OIL_200', 29, 31, 'NEW_EXT_HEAD_150', 47] },
  ];

  for (const plan of plans) {
    console.log(`\n${plan.name} (sell ${plan.sell}, target ${plan.target}):`);
    let total = 0;
    for (const id of plan.ids) {
      if (typeof id === 'string') {
        const price = id.includes('100') ? 100 : id.includes('150') ? 150 : 200;
        console.log(`  [NEW] ${id} @ ${price} EGP (proposed)`);
        total += price;
        continue;
      }
      const r = byId.get(id);
      if (!r) {
        console.log(`  ProID=${id} NOT FOUND`);
        continue;
      }
      console.log(`  ${r.ProName} ProID=${id} @ ${r.SPrice1} EGP`);
      total += Number(r.SPrice1);
    }
    const disc = ((total - plan.sell) / total) * 100;
    console.log(`  Standalone total: ${total} EGP | delta vs target: ${total - plan.target} | discount: ${disc.toFixed(1)}%`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
