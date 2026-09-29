/**
 * Post-seed verification for regular CUT packages + public catalog.
 * Usage: npx tsx tmp/verify-regular-packages.ts --local
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

async function main(): Promise<void> {
  loadEnvLocal();
  const { getPool, setDbTarget } = await import('../src/lib/db');
  await setDbTarget('local');
  const { getServicePackageById, listServicePackages } = await import(
    '../src/lib/catalog/servicePackages'
  );
  const { getPublicPackagesCatalog } = await import('../src/lib/catalog/publicPackagesCatalog');
  const { evaluateServiceEligibility } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { getPublicBookingServicesCatalog } = await import(
    '../src/lib/booking/publicBookingServices'
  );

  const db = await getPool();
  let fail = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
    if (!ok) fail += 1;
  };

  const newNames = [
    'Head Massage',
    'Extended Head Massage',
    'Advanced Hair Oil Treatment',
  ];
  const newSvc = await db.request().query(`
    SELECT p.ProID, p.ProName, p.SPrice1, p.DurationMinutes, ISNULL(p.isDeleted,0) AS isDeleted,
           c.CatID, c.CatName, p.ProType, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE p.ProName IN (N'Head Massage', N'Extended Head Massage', N'Advanced Hair Oil Treatment')
      AND ISNULL(p.isDeleted,0)=0
    ORDER BY p.ProID
  `);
  check(newSvc.recordset.length === 3, `new services count=3 (got ${newSvc.recordset.length})`);
  const byName = new Map(newSvc.recordset.map((r: any) => [r.ProName, r]));
  for (const n of newNames) {
    const r = byName.get(n);
    check(!!r, `${n} exists`);
    if (r) {
      const elig = evaluateServiceEligibility(r);
      check(elig.eligible, `${n} bookable (${elig.reason})`);
      check(Number(r.CatID) === 18, `${n} CatID=18`);
    }
  }

  const oil22 = await db.request().query(`
    SELECT ProID, ProName, SPrice1 FROM dbo.TblPro WHERE ProID=22
  `);
  check(
    Number(oil22.recordset[0]?.SPrice1) === 120 &&
      String(oil22.recordset[0]?.ProName) === 'Hair Oil Treatment',
    'ProID 22 Hair Oil Treatment untouched @ 120',
  );

  const expected = [
    {
      key: 'REGULAR_CUT_FRESH',
      name: 'CUT Fresh',
      price: 350,
      original: 700,
      popular: false,
      duration: 30 + 20 + 20 + 5 + 10 + 5, // 90
      services: [9, 10, 11, 44, byName.get('Head Massage')?.ProID, 47],
    },
    {
      key: 'REGULAR_CUT_CARE',
      name: 'CUT Care',
      price: 555,
      original: 870,
      popular: true,
      duration: 30 + 20 + 5 + 30 + 10 + 5, // 100
      services: [9, 10, 22, 29, byName.get('Head Massage')?.ProID, 47],
    },
    {
      key: 'REGULAR_CUT_PREMIUM',
      name: 'CUT Premium',
      price: 750,
      original: 1200,
      popular: false,
      duration: 30 + 20 + 15 + 35 + 10 + 15 + 5, // 130
      services: [
        9,
        10,
        byName.get('Advanced Hair Oil Treatment')?.ProID,
        12,
        32,
        byName.get('Extended Head Massage')?.ProID,
        47,
      ],
    },
  ];

  const regular = await listServicePackages(db, { kind: 'regular', activeOnly: true });
  check(regular.length === 3, `exactly 3 active regular packages (got ${regular.length})`);

  for (const exp of expected) {
    const pkg = regular.find((p) => (p.NotesAr ?? '').includes(`[seed:${exp.key}]`));
    check(!!pkg, `${exp.name} found by seed marker`);
    if (!pkg) continue;
    const full = await getServicePackageById(db, pkg.PackageID);
    const items = (full?.items ?? []).filter((i) => !i.IsOptional);
    const optional = (full?.items ?? []).filter((i) => i.IsOptional);
    const ids = items.map((i) => i.ProID);
    const savings = Number(full!.OriginalPrice) - Number(full!.PackagePrice);
    const discount = (savings / Number(full!.OriginalPrice)) * 100;

    check(Number(full!.PackagePrice) === exp.price, `${exp.name} price=${exp.price}`);
    check(Number(full!.OriginalPrice) === exp.original, `${exp.name} original=${exp.original}`);
    check(Boolean(full!.IsPopular) === exp.popular, `${exp.name} popular=${exp.popular ? 1 : 0}`);
    check(Number(full!.DurationMinutes) === exp.duration, `${exp.name} duration=${exp.duration}`);
    check(optional.length === 0, `${exp.name} no optional items`);
    check(
      ids.length === exp.services.length &&
        exp.services.every((id, i) => Number(id) === ids[i]),
      `${exp.name} ProIDs=${ids.join(',')} (ordered)`,
    );
    console.log(
      `  ${exp.name}: PackageID=${pkg.PackageID} savings=${savings} discount=${discount.toFixed(2)}%`,
    );
  }

  const groom = await listServicePackages(db, { kind: 'groom', activeOnly: true });
  check(groom.length === 3, `groom packages still 3 (got ${groom.length})`);
  const groomOk =
    groom.some((p) => p.NameEn === 'Essential Groom' && Number(p.PackagePrice) === 1300) &&
    groom.some((p) => p.NameEn === 'Signature Groom' && Number(p.PackagePrice) === 1500) &&
    groom.some((p) => p.NameEn === 'Complete Groom' && Number(p.PackagePrice) === 3000);
  check(groomOk, 'groom package prices unchanged');

  // Branch bookability for all included ProIDs
  const allIds = [
    ...new Set(expected.flatMap((e) => e.services.filter((x) => x != null).map(Number))),
  ];
  for (const code of ['GLEEM', 'CAMP_CAESAR']) {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode: code,
      purpose: 'public_booking',
    });
    const cat = await getPublicBookingServicesCatalog(ctx);
    const set = new Set(cat.services.map((s) => s.serviceId));
    const missing = allIds.filter((id) => !set.has(id));
    check(missing.length === 0, `${code} all included services bookable${missing.length ? ` missing=${missing}` : ''}`);
  }

  // Public catalog
  const pub = await getPublicPackagesCatalog({});
  check(pub.meta.regularCount === 3, `public regularCount=3 (got ${pub.meta.regularCount})`);
  check(pub.meta.groomCount === 3, `public groomCount=3 (got ${pub.meta.groomCount})`);
  for (const exp of expected) {
    const wire = pub.regular.find((p) => p.nameEn === exp.name);
    check(!!wire, `public catalog has ${exp.name}`);
    if (!wire) continue;
    check(wire.price === exp.price, `public ${exp.name} price`);
    check(wire.originalPrice === exp.original, `public ${exp.name} originalPrice`);
    check(wire.popular === exp.popular, `public ${exp.name} popular`);
    const savings = exp.original - exp.price;
    check(wire.savings === savings, `public ${exp.name} savings=${savings}`);
    const includes = wire.includes.filter((i) => !i.optional);
    check(
      includes.length === exp.services.length,
      `public ${exp.name} includes=${includes.length}`,
    );
    check(
      includes.every((i, idx) => i.serviceId === Number(exp.services[idx])),
      `public ${exp.name} include ProIDs ordered`,
    );
  }

  const kindFilter = await getPublicPackagesCatalog({ kind: 'regular' });
  check(
    kindFilter.meta.regularCount === 3 && kindFilter.regular.length === 3,
    'public ?kind=regular returns 3',
  );

  console.log(`\nOVERALL: ${fail === 0 ? 'PASS' : 'FAIL'} (failures=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
