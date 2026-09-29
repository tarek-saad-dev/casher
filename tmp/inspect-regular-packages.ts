/**
 * Read-only inspection: services + regular packages for CUT Salon seed planning.
 * Usage: npx tsx tmp/inspect-regular-packages.ts [--local|--cloud]
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
      const envText = readFileSync(path.join(ROOT, envPath), 'utf8');
      for (const line of envText.split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* optional */
    }
  }
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[\u0640]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TARGET_NAMES = [
  'Haircut',
  'Beard',
  'Fresh Skin Care',
  'Classic Skin Care',
  'Deep Skin Care',
  'Hair Mask',
  'Hair Styling',
  'Hair Oil Treatment',
  'Face Wax',
];

const SIMILAR_CHECK = [
  'Head Massage',
  'Extended Head Massage',
  'Advanced Hair Oil Treatment',
];

const NAME_ALIASES: Record<string, string[]> = {
  Haircut: ['Hair Cut', 'Haircut', 'Haircut & Beard'],
  Beard: ['Beard', 'Beard Styling & Fade', 'Beard Styling and Fade', 'Zero Beard Shave'],
  'Fresh Skin Care': ['Fresh Skin Care', 'Fresh Skin', 'Basic Skin Care'],
  'Classic Skin Care': ['Classic Skin Care', 'Classic SkinCare', 'Medical Skin Care'],
  'Deep Skin Care': ['Deep Skin Care', 'Deep SkinCare', 'Deep Skincare'],
  'Hair Mask': ['Hair Mask'],
  'Hair Styling': ['Hair Styling', 'Dry-Hair', 'Wavy Styling'],
  'Hair Oil Treatment': ['Hair Oil Treatment'],
  'Face Wax': ['Face Wax', 'Full Wax', 'Partial Wax'],
};

async function main(): Promise<void> {
  loadEnvLocal();
  const argv = process.argv.slice(2);
  const envTarget = String(process.env.AUDIT_DB_TARGET || '').trim().toLowerCase();
  let dbTarget: 'cloud' | 'local' = envTarget === 'local' ? 'local' : 'cloud';
  const cls = String(process.env.HAWAI_DB_CLASS || '').trim().toLowerCase();
  if (cls === 'local' || cls === 'isolated' || cls === 'test' || cls === 'dev') {
    dbTarget = 'local';
  }
  if (argv.includes('--local')) dbTarget = 'local';
  if (argv.includes('--cloud')) dbTarget = 'cloud';
  if (dbTarget === 'cloud') {
    delete process.env.HAWAI_DB_CLASS;
    delete process.env.BOOKING_V2_DB_CLASS;
    delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  }

  const { getPool, setDbTarget } = await import('../src/lib/db');
  await setDbTarget(dbTarget);
  const { isRetailProductClassification, evaluateServiceEligibility } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const { listServicePackages, getServicePackageById } = await import(
    '../src/lib/catalog/servicePackages'
  );
  const { getPublicPackagesCatalog } = await import('../src/lib/catalog/publicPackagesCatalog');
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { getPublicBookingServicesCatalog } = await import(
    '../src/lib/booking/publicBookingServices'
  );

  const db = await getPool();
  console.log(`[inspect] db=${dbTarget} READ-ONLY\n`);

  // Branches
  const branches = await db.request().query(`
    SELECT BranchID, BranchCode, BranchName
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
    ORDER BY BranchID
  `);
  console.log('=== ACTIVE CUT SALON BRANCHES ===');
  for (const b of branches.recordset) {
    console.log(`  BranchID=${b.BranchID} | ${b.BranchCode} | ${b.BranchName}`);
  }

  // Full catalog
  const svcRes = await db.request().query(`
    SELECT
      p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
      p.ProType, ISNULL(p.isDeleted, 0) AS isDeleted,
      c.CatID, c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY p.ProID
  `);

  type Row = {
    ProID: number;
    ProName: string;
    ProNameAr: string | null;
    SPrice1: number;
    DurationMinutes: number | null;
    ProType: string | null;
    isDeleted: boolean;
    CatID: number | null;
    CatName: string | null;
    CatType: string | null;
    isProduct: boolean;
  };

  const catalog: Row[] = (svcRes.recordset as Record<string, unknown>[]).map((row) => {
    const CatType = row.CatType != null ? String(row.CatType) : null;
    const CatName = row.CatName != null ? String(row.CatName) : null;
    const ProType = row.ProType != null ? String(row.ProType) : null;
    return {
      ProID: Number(row.ProID),
      ProName: String(row.ProName ?? ''),
      ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
      SPrice1: Number(row.SPrice1) || 0,
      DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
      CatID: row.CatID != null ? Number(row.CatID) : null,
      CatName,
      CatType,
      ProType,
      isDeleted: Number(row.isDeleted) === 1,
      isProduct: isRetailProductClassification({ ProType, CatType, CatName }),
    };
  });

  // Branch bookable sets
  const branchBookable = new Map<string, Set<number>>();
  for (const b of branches.recordset) {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode: String(b.BranchCode),
      purpose: 'public_booking',
    });
    const cat = await getPublicBookingServicesCatalog(ctx);
    branchBookable.set(
      String(b.BranchCode),
      new Set(cat.services.map((s) => s.serviceId)),
    );
  }

  function branchAvailability(proId: number): string {
    const parts: string[] = [];
    for (const b of branches.recordset) {
      const code = String(b.BranchCode);
      const set = branchBookable.get(code)!;
      parts.push(`${code}=${set.has(proId) ? 'bookable' : 'NOT bookable'}`);
    }
    return parts.join(', ');
  }

  function findMatches(label: string, aliases: string[]): Row[] {
    const terms = aliases.map(normalizeName);
    return catalog.filter((s) => {
      const names = [normalizeName(s.ProName), normalizeName(s.ProNameAr)];
      return terms.some((t) => names.some((n) => n === t || n.includes(t) || t.includes(n)));
    });
  }

  console.log('\n=== TARGET SERVICE MAPPING ===');
  const resolved: Record<string, Row | null> = {};
  for (const label of TARGET_NAMES) {
    const aliases = NAME_ALIASES[label] ?? [label];
    const matches = findMatches(label, aliases);
    const active = matches.filter((m) => !m.isDeleted && !m.isProduct);
    const exact = active.filter(
      (m) =>
        aliases.some((a) => normalizeName(m.ProName) === normalizeName(a)) ||
        aliases.some((a) => normalizeName(m.ProNameAr) === normalizeName(a)),
    );
    const pick = exact.length === 1 ? exact[0] : exact.length > 1 ? null : active.length === 1 ? active[0] : null;

    console.log(`\n--- ${label} ---`);
    if (matches.length === 0) {
      console.log('  NOT FOUND');
      resolved[label] = null;
      continue;
    }
    for (const m of matches) {
      const elig = evaluateServiceEligibility(m);
      console.log(
        `  ${m.ProName}${m.ProNameAr ? ` / ${m.ProNameAr}` : ''}` +
          ` -> ProID=${m.ProID} | Price=${m.SPrice1} | Duration=${m.DurationMinutes ?? 'null'} min` +
          ` | Category=${m.CatName ?? '—'} (CatID=${m.CatID ?? '—'})` +
          ` | deleted=${m.isDeleted ? 1 : 0} | product=${m.isProduct ? 1 : 0}` +
          ` | eligible=${elig.eligible ? 'yes' : elig.reason}` +
          ` | Branches: ${branchAvailability(m.ProID)}`,
      );
    }
    if (pick) {
      console.log(`  >> RESOLVED: ProID=${pick.ProID} ("${pick.ProName}")`);
      resolved[label] = pick;
    } else {
      console.log(`  >> AMBIGUOUS — manual pick required (${exact.length} exact, ${active.length} active)`);
      resolved[label] = null;
    }
  }

  console.log('\n=== SIMILAR-NAME CHECK (new services) ===');
  for (const label of SIMILAR_CHECK) {
    const norm = normalizeName(label);
    const hits = catalog.filter((s) => {
      const names = [normalizeName(s.ProName), normalizeName(s.ProNameAr)];
      return names.some((n) => n.includes(norm) || norm.includes(n));
    });
    console.log(`\n--- ${label} ---`);
    if (!hits.length) {
      console.log('  NOT FOUND (safe to create)');
      continue;
    }
    for (const m of hits) {
      console.log(
        `  ${m.ProName}${m.ProNameAr ? ` / ${m.ProNameAr}` : ''}` +
          ` -> ProID=${m.ProID} | Price=${m.SPrice1} | Duration=${m.DurationMinutes ?? 'null'} min` +
          ` | Category=${m.CatName ?? '—'} | deleted=${m.isDeleted ? 1 : 0}`,
      );
    }
  }

  // Massage / oil neighbors for duration recommendation
  console.log('\n=== DURATION NEIGHBORS (for new services) ===');
  const neighborTerms = ['massage', 'oil', 'treatment', 'towel', 'mask', 'تدليك', 'زيت', 'حمام'];
  const neighbors = catalog.filter(
    (s) =>
      !s.isDeleted &&
      !s.isProduct &&
      neighborTerms.some(
        (t) =>
          normalizeName(s.ProName).includes(t) ||
          normalizeName(s.ProNameAr).includes(normalizeName(t)),
      ),
  );
  for (const m of neighbors.sort((a, b) => a.ProID - b.ProID)) {
    console.log(
      `  ProID=${m.ProID} | ${m.ProName} | ${m.SPrice1} EGP | ${m.DurationMinutes ?? '?'} min | ${m.CatName}`,
    );
  }

  // Package table structure
  console.log('\n=== PACKAGE TABLE COLUMNS (TblServicePackage) ===');
  const pkgCols = await db.request().query(`
    SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_SCHEMA = 'dbo' AND c.TABLE_NAME = 'TblServicePackage'
    ORDER BY c.ORDINAL_POSITION
  `);
  for (const col of pkgCols.recordset) {
    console.log(
      `  ${col.COLUMN_NAME}: ${col.DATA_TYPE}` +
        (col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '') +
        ` nullable=${col.IS_NULLABLE}`,
    );
  }

  console.log('\n=== PACKAGE ITEM TABLE COLUMNS (TblServicePackageItem) ===');
  const itemCols = await db.request().query(`
    SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_SCHEMA = 'dbo' AND c.TABLE_NAME = 'TblServicePackageItem'
    ORDER BY c.ORDINAL_POSITION
  `);
  for (const col of itemCols.recordset) {
    console.log(
      `  ${col.COLUMN_NAME}: ${col.DATA_TYPE}` +
        (col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '') +
        ` nullable=${col.IS_NULLABLE}`,
    );
  }

  // Branch package table?
  const branchPkgTable = await db.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME LIKE '%Package%'
    ORDER BY TABLE_NAME
  `);
  console.log('\n=== PACKAGE-RELATED TABLES ===');
  for (const t of branchPkgTable.recordset) {
    console.log(`  dbo.${t.TABLE_NAME}`);
  }

  console.log('\n=== BRANCH AVAILABILITY MODEL ===');
  console.log(
    '  Packages: GLOBAL (TblServicePackage — no BranchID column).',
  );
  console.log(
    '  Services: GLOBAL catalog (TblPro). Branch bookability = public eligibility filter per branch context.',
  );
  console.log(
    '  Package branch availability: implicit — package visible if all required services are bookable at branch.',
  );

  // Existing regular packages
  const allPkgs = await listServicePackages(db, { activeOnly: false });
  const regular = allPkgs.filter((p) => p.PackageKind === 'regular');
  const groom = allPkgs.filter((p) => p.PackageKind === 'groom');

  console.log(`\n=== EXISTING REGULAR PACKAGES (${regular.length} total) ===`);
  if (regular.length === 0) {
    console.log('  (none)');
  } else {
    for (const p of regular) {
      console.log(
        `  PackageID=${p.PackageID} | ${p.NameEn} | price=${p.PackagePrice}` +
          ` | original=${p.OriginalPrice ?? 'null'} | popular=${p.IsPopular ? 1 : 0}` +
          ` | sort=${p.SortOrder} | deleted=${p.isDeleted ? 1 : 0} | items=${p.ItemCount ?? '?'}`,
      );
    }
  }

  const example = regular.find((p) => !p.isDeleted) ?? regular[0];
  if (example) {
    const full = await getServicePackageById(db, example.PackageID);
    console.log('\n=== EXAMPLE REGULAR PACKAGE (full) ===');
    console.log(JSON.stringify(full, null, 2));
  }

  console.log(`\n=== EXISTING GROOM PACKAGES (${groom.length} total — preserved) ===`);
  for (const p of groom.filter((x) => !x.isDeleted)) {
    console.log(`  PackageID=${p.PackageID} | ${p.NameEn} | price=${p.PackagePrice} | popular=${p.IsPopular ? 1 : 0}`);
  }

  // Public catalog check
  console.log('\n=== PUBLIC PACKAGES CATALOG ===');
  const pub = await getPublicPackagesCatalog({});
  console.log(`  regularCount=${pub.meta.regularCount} groomCount=${pub.meta.groomCount}`);
  for (const p of pub.regular) {
    console.log(
      `  [regular] id=${p.packageId} ${p.nameEn} price=${p.price} popular=${p.popular} includes=${p.includes.length}`,
    );
  }

  // Standalone totals
  console.log('\n=== PROPOSED PACKAGE STANDALONE TOTALS (current DB prices) ===');
  const packages = [
    {
      name: 'CUT Fresh',
      sell: 350,
      target: 700,
      services: [
        'Haircut',
        'Beard',
        'Fresh Skin Care',
        'Hair Mask',
        'Head Massage',
        'Hair Styling',
      ],
    },
    {
      name: 'CUT Care',
      sell: 555,
      target: 850,
      services: [
        'Haircut',
        'Beard',
        'Hair Oil Treatment',
        'Classic Skin Care',
        'Head Massage',
        'Hair Styling',
      ],
    },
    {
      name: 'CUT Premium',
      sell: 750,
      target: 1200,
      services: [
        'Haircut',
        'Beard',
        'Advanced Hair Oil Treatment',
        'Deep Skin Care',
        'Face Wax',
        'Extended Head Massage',
        'Hair Styling',
      ],
    },
  ];

  const missingNew = ['Head Massage', 'Extended Head Massage', 'Advanced Hair Oil Treatment'];

  for (const pkg of packages) {
    console.log(`\n--- ${pkg.name} (sell=${pkg.sell}, target standalone=${pkg.target}) ---`);
    let total = 0;
    let complete = true;
    for (const svc of pkg.services) {
      if (missingNew.includes(svc)) {
        console.log(`  ${svc}: MISSING (proposed new service — not in total yet)`);
        complete = false;
        continue;
      }
      const row = resolved[svc];
      if (!row) {
        console.log(`  ${svc}: UNRESOLVED`);
        complete = false;
        continue;
      }
      total += row.SPrice1;
      console.log(`  ${svc}: ProID=${row.ProID} @ ${row.SPrice1} EGP`);
    }
    if (complete) {
      const discount = ((total - pkg.sell) / total) * 100;
      console.log(`  Standalone total: ${total} EGP`);
      console.log(`  Selling price:    ${pkg.sell} EGP`);
      console.log(`  Discount:         ${discount.toFixed(1)}%`);
      console.log(`  Target delta:     ${total - pkg.target} EGP (${total === pkg.target ? 'MATCH' : 'MISMATCH'})`);
    } else {
      // Partial total with known services only
      console.log(`  Partial total (known services only): ${total} EGP`);
      console.log(`  (Incomplete — missing/unresolved services excluded)`);
    }
  }

  // Recommended field
  console.log('\n=== RECOMMENDED / MOST POPULAR FIELD ===');
  console.log('  Column: TblServicePackage.IsPopular (BIT, default 0)');
  console.log('  Public API wire: popular: boolean');
  console.log('  Groom seed also uses recommended?: true in JSON -> IsPopular=1');
  console.log('  No separate badge column — badge text is description/NotesAr only for groom.');

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
