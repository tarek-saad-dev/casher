/**
 * Ensure groom optional add-on + home-visit services exist, and link them
 * as IsOptional package items on Essential / Signature / Complete.
 *
 * Idempotent: REUSE / RESTORE / CREATE / UPDATE — no duplicates.
 *
 * Usage:
 *   npm run ensure:groom-addons
 *   npm run ensure:groom-addons:apply
 *   npx tsx scripts/ensure-groom-addons.ts --dry-run [--local|--cloud]
 *   npx tsx scripts/ensure-groom-addons.ts --apply [--local|--cloud]
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

type Action = 'REUSE' | 'RESTORE' | 'CREATE' | 'UPDATE' | 'AMBIGUOUS';
type AddonGroup = 'groom_addons' | 'home_visit';

interface RequestedService {
  key: string;
  group: AddonGroup;
  nameEn: string;
  nameAr: string;
  price: number;
  /** When set, reuse this ProID directly (no fuzzy create). */
  fixedProId?: number;
  /** Prefer these existing categories; group category is ensured separately when needed. */
  categoryPreferences: string[];
  /** Force membership in the group category (new SKUs). Fixed reuses keep their catalog category. */
  useGroupCategory: boolean;
  aliases: string[];
  /** Allow UPDATE of name/price when this is our owned SKU. */
  ownedSku: boolean;
}

interface CatalogRow {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  CatID: number | null;
  CatName: string | null;
  CatType: string | null;
  ProType: string | null;
  isDeleted: boolean;
  isProduct: boolean;
}

interface CategoryRow {
  CatID: number;
  CatName: string;
  CatType: string | null;
}

interface ServicePlan {
  requested: RequestedService;
  action: Action;
  matched?: CatalogRow;
  category?: CategoryRow;
  reason: string;
  finalProID?: number;
  needsPriceUpdate?: boolean;
}

interface PackageOptionalPlan {
  packageId: number;
  packageName: string;
  packageKey: string;
  /** ProIDs that should be IsOptional=1 on this package after sync */
  optionalProIds: number[];
  /** ProIDs skipped because already included as required */
  skippedAlreadyIncluded: number[];
}

const GROUP_CATEGORY: Record<AddonGroup, string> = {
  groom_addons: 'Groom Add-ons',
  home_visit: 'Groom Home Visit',
};

const REQUESTED: RequestedService[] = [
  {
    key: 'HAIR_DETAIL_COLOR',
    group: 'groom_addons',
    nameEn: 'Hair Detail Color',
    nameAr: 'تفاصيل لون للشعر',
    price: 150,
    categoryPreferences: ['Groom Add-ons', 'Hair Color & Highlights', 'خدمات اضافيه للشعر'],
    useGroupCategory: true,
    ownedSku: true,
    aliases: ['Hair Detail Colour', 'Detail Color', 'تفاصيل لون', 'تفاصيل لون للشعر'],
  },
  {
    key: 'RELAX_SESSION',
    group: 'groom_addons',
    nameEn: 'Relax Session',
    nameAr: 'جلسة استرخاء',
    price: 200,
    categoryPreferences: ['Groom Add-ons', 'Skincare', 'العناية بالبشرة'],
    useGroupCategory: true,
    ownedSku: true,
    aliases: ['Relax', 'Relaxing Session', 'جلسة استرخاء'],
  },
  {
    key: 'FOOT_PEDICURE',
    group: 'groom_addons',
    nameEn: 'Foot pedicure',
    nameAr: 'باديكير رجل',
    price: 400,
    fixedProId: 14,
    categoryPreferences: ['Skincare'],
    useGroupCategory: false,
    ownedSku: false,
    aliases: ['Pedicure', 'Foot Pedicure'],
  },
  {
    key: 'MEDIUM_HAIR_PROTEIN',
    group: 'groom_addons',
    nameEn: 'Medium Hair Protein',
    nameAr: 'بروتين شعر وسط',
    price: 1000,
    fixedProId: 1077,
    categoryPreferences: ['Hair Treatments & Care', 'معالجات شعر'],
    useGroupCategory: false,
    ownedSku: false,
    aliases: ['Medium Protein', 'Hair Protein Medium'],
  },
  {
    key: 'HOME_VISIT_NEAR',
    group: 'home_visit',
    nameEn: 'Groom Home Visit — Near the Salon',
    nameAr: 'زيارة تجهيز العريس — قريب من الفرع',
    price: 300,
    categoryPreferences: ['Groom Home Visit'],
    useGroupCategory: true,
    ownedSku: true,
    aliases: [
      'Groom Home Visit Near the Salon',
      'Home Visit Near',
      'زيارة تجهيز العريس قريب من الفرع',
    ],
  },
  {
    key: 'HOME_VISIT_CITY',
    group: 'home_visit',
    nameEn: 'Groom Home Visit — Within the City',
    nameAr: 'زيارة تجهيز العريس — داخل المدينة',
    price: 500,
    categoryPreferences: ['Groom Home Visit'],
    useGroupCategory: true,
    ownedSku: true,
    aliases: [
      'Groom Home Visit Within the City',
      'Home Visit City',
      'زيارة تجهيز العريس داخل المدينة',
    ],
  },
  {
    key: 'HOME_VISIT_EXTENDED',
    group: 'home_visit',
    nameEn: 'Groom Home Visit — Extended Zone',
    nameAr: 'زيارة تجهيز العريس — نطاق ممتد',
    price: 1000,
    categoryPreferences: ['Groom Home Visit'],
    useGroupCategory: true,
    ownedSku: true,
    aliases: [
      'Groom Home Visit Extended Zone',
      'Home Visit Extended',
      'زيارة تجهيز العريس نطاق ممتد',
    ],
  },
];

/** Package keys → which optional groups attach; Complete excludes protein + pedicure. */
const PACKAGE_OPTIONAL_RULES: Array<{
  matchNameEn: string;
  seedKey: string;
  addonKeys: string[];
}> = [
  {
    matchNameEn: 'Essential Groom',
    seedKey: 'GROOM_ESSENTIAL',
    addonKeys: [
      'HAIR_DETAIL_COLOR',
      'RELAX_SESSION',
      'FOOT_PEDICURE',
      'MEDIUM_HAIR_PROTEIN',
      'HOME_VISIT_NEAR',
      'HOME_VISIT_CITY',
      'HOME_VISIT_EXTENDED',
    ],
  },
  {
    matchNameEn: 'Signature Groom',
    seedKey: 'GROOM_SIGNATURE',
    addonKeys: [
      'HAIR_DETAIL_COLOR',
      'RELAX_SESSION',
      'FOOT_PEDICURE',
      'MEDIUM_HAIR_PROTEIN',
      'HOME_VISIT_NEAR',
      'HOME_VISIT_CITY',
      'HOME_VISIT_EXTENDED',
    ],
  },
  {
    matchNameEn: 'Complete Groom',
    seedKey: 'GROOM_COMPLETE',
    // Protein + pedicure already included — do not offer as optional.
    addonKeys: [
      'HAIR_DETAIL_COLOR',
      'RELAX_SESSION',
      'HOME_VISIT_NEAR',
      'HOME_VISIT_CITY',
      'HOME_VISIT_EXTENDED',
    ],
  },
];

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

function parseArgs(argv: string[]): { apply: boolean; dbTarget: 'cloud' | 'local' } {
  const apply = argv.includes('--apply');
  const dry = argv.includes('--dry-run');
  if (apply && dry) throw new Error('Use either --apply or --dry-run, not both');
  const envTarget = String(process.env.AUDIT_DB_TARGET || '').trim().toLowerCase();
  let dbTarget: 'cloud' | 'local' = envTarget === 'local' ? 'local' : 'cloud';
  const cls = String(process.env.HAWAI_DB_CLASS || '').trim().toLowerCase();
  if (cls === 'local' || cls === 'isolated' || cls === 'test' || cls === 'dev') {
    dbTarget = 'local';
  }
  if (argv.includes('--local')) dbTarget = 'local';
  if (argv.includes('--cloud')) dbTarget = 'cloud';
  return { apply, dbTarget };
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

function scoreMatch(svc: CatalogRow, requested: RequestedService): number {
  const names = [normalizeName(svc.ProName), normalizeName(svc.ProNameAr)].filter(Boolean);
  const terms = [requested.nameEn, requested.nameAr, ...requested.aliases].map(normalizeName);
  let best = 0;
  for (const term of terms) {
    if (!term) continue;
    for (const n of names) {
      if (n === term) best = Math.max(best, 100);
      else if (n.includes(term) || term.includes(n)) {
        const shorter = n.length <= term.length ? n : term;
        const longer = n.length > term.length ? n : term;
        if (shorter.length >= 8 && longer.includes(shorter)) best = Math.max(best, 80);
      }
    }
  }
  return best;
}

function resolvePreferredCategory(
  requested: RequestedService,
  categories: CategoryRow[],
  groupCat: CategoryRow | undefined,
): CategoryRow | undefined {
  // Group-owned SKUs always use the dedicated group category (created if missing).
  if (requested.useGroupCategory) return groupCat;
  for (const pref of requested.categoryPreferences) {
    const want = normalizeName(pref);
    const hit = categories.find((c) => normalizeName(c.CatName) === want);
    if (hit) return hit;
  }
  return undefined;
}

function planService(
  requested: RequestedService,
  catalog: CatalogRow[],
  category: CategoryRow | undefined,
): ServicePlan {
  if (requested.fixedProId != null) {
    const matched = catalog.find((s) => s.ProID === requested.fixedProId);
    if (!matched) {
      return {
        requested,
        action: 'AMBIGUOUS',
        category,
        reason: `fixed ProID ${requested.fixedProId} not found`,
      };
    }
    if (matched.isProduct) {
      return {
        requested,
        action: 'AMBIGUOUS',
        matched,
        category,
        reason: `fixed ProID ${requested.fixedProId} is a product`,
      };
    }
    if (matched.isDeleted) {
      return {
        requested,
        action: 'RESTORE',
        matched,
        category,
        reason: `soft-deleted fixed ProID=${matched.ProID}`,
        finalProID: matched.ProID,
      };
    }
    return {
      requested,
      action: 'REUSE',
      matched,
      category: category ?? (matched.CatID
        ? { CatID: matched.CatID, CatName: matched.CatName ?? '', CatType: matched.CatType }
        : undefined),
      reason: `reuse confirmed ProID=${matched.ProID}`,
      finalProID: matched.ProID,
    };
  }

  const scored = catalog
    .filter((s) => !s.isProduct)
    .map((service) => ({ service, score: scoreMatch(service, requested) }))
    .filter((x) => x.score >= 80)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.service.isDeleted) - Number(b.service.isDeleted) ||
        a.service.ProID - b.service.ProID,
    );

  const exact = scored.filter((x) => x.score === 100);
  const pool = exact.length ? exact : scored;

  if (pool.length === 0) {
    if (!category) {
      return {
        requested,
        action: 'AMBIGUOUS',
        reason: 'CREATE needed but no category available',
      };
    }
    return {
      requested,
      action: 'CREATE',
      category,
      reason: 'no equivalent service found',
    };
  }

  if (pool.length > 1 && pool[0].score === pool[1].score) {
    return {
      requested,
      action: 'AMBIGUOUS',
      matched: pool[0].service,
      category,
      reason: `ambiguous matches score=${pool[0].score}`,
    };
  }

  const matched = pool[0].service;
  if (matched.isDeleted) {
    return {
      requested,
      action: 'RESTORE',
      matched,
      category,
      reason: `soft-deleted ProID=${matched.ProID}`,
      finalProID: matched.ProID,
    };
  }

  const needsUpdate =
    requested.ownedSku &&
    (normalizeName(matched.ProName) !== normalizeName(requested.nameEn) ||
      normalizeName(matched.ProNameAr) !== normalizeName(requested.nameAr) ||
      Number(matched.SPrice1) !== requested.price ||
      (category != null && matched.CatID !== category.CatID));

  if (needsUpdate) {
    return {
      requested,
      action: 'UPDATE',
      matched,
      category,
      reason: `align owned SKU ProID=${matched.ProID}`,
      finalProID: matched.ProID,
      needsPriceUpdate: Number(matched.SPrice1) !== requested.price,
    };
  }

  return {
    requested,
    action: 'REUSE',
    matched,
    category,
    reason: `active equivalent ProID=${matched.ProID}`,
    finalProID: matched.ProID,
  };
}

function printServicePlan(plan: ServicePlan): void {
  const r = plan.requested;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`Requested: ${r.nameEn}  [${r.key}] group=${r.group}`);
  console.log(`  Arabic: ${r.nameAr}`);
  console.log(`  Price:  ${r.price} EGP`);
  if (plan.matched) {
    const m = plan.matched;
    console.log(`Existing match:`);
    console.log(`  ProID:    ${m.ProID}`);
    console.log(`  Name:     ${m.ProName} / ${m.ProNameAr ?? '—'}`);
    console.log(`  Category: ${m.CatName ?? '—'} (CatID=${m.CatID ?? '—'})`);
    console.log(`  Price:    ${m.SPrice1} EGP`);
    console.log(`  Status:   deleted=${m.isDeleted ? 1 : 0} ProType=${m.ProType || '—'}`);
  } else {
    console.log(`Existing match: (none)`);
  }
  if (plan.category) {
    console.log(`Target category: ${plan.category.CatName} (CatID=${plan.category.CatID})`);
  }
  console.log(`Action: ${plan.action}`);
  console.log(`Reason: ${plan.reason}`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { apply, dbTarget } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'APPLY' : 'DRY-RUN';

  if (dbTarget === 'cloud') {
    delete process.env.HAWAI_DB_CLASS;
    delete process.env.BOOKING_V2_DB_CLASS;
    delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  }

  console.log(`[ensure-groom-addons] mode=${mode} db=${dbTarget}`);

  const { getPool, setDbTarget, sql, closePool } = await import('../src/lib/db');
  await setDbTarget(dbTarget);
  const { ensureServicePackagesTables } = await import('../src/lib/migrations/ensureServicePackages');
  const { isRetailProductClassification } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const {
    GROOM_ADDONS_CATEGORY_NAME,
    GROOM_HOME_VISIT_CATEGORY_NAME,
  } = await import('../src/lib/catalog/groomOptionalAddons');

  const db = await getPool();
  const ready = await ensureServicePackagesTables(db);
  if (!ready) throw new Error('Package tables unavailable');

  const catRes = await db.request().query(`
    SELECT CatID, CatName, CatType FROM dbo.TblCat ORDER BY CatID
  `);
  let categories: CategoryRow[] = (catRes.recordset as Record<string, unknown>[]).map((row) => ({
    CatID: Number(row.CatID),
    CatName: String(row.CatName ?? ''),
    CatType: row.CatType != null ? String(row.CatType) : null,
  }));

  const neededGroupCats = [
    { name: GROOM_ADDONS_CATEGORY_NAME, key: 'groom_addons' as const },
    { name: GROOM_HOME_VISIT_CATEGORY_NAME, key: 'home_visit' as const },
  ];

  const missingCats = neededGroupCats.filter(
    (g) => !categories.some((c) => normalizeName(c.CatName) === normalizeName(g.name)),
  );

  console.log(`\nGroup categories:`);
  for (const g of neededGroupCats) {
    const existing = categories.find(
      (c) => normalizeName(c.CatName) === normalizeName(g.name),
    );
    console.log(
      `  ${g.name}: ${existing ? `EXISTS CatID=${existing.CatID}` : 'WILL CREATE'}`,
    );
  }

  const svcRes = await db.request().query(`
    SELECT
      p.ProID, p.ProName, p.ProNameAr, p.SPrice1,
      p.CatID, ISNULL(p.ProType, N'') AS ProType,
      ISNULL(p.isDeleted, 0) AS isDeleted,
      c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY p.ProID
  `);

  const catalog: CatalogRow[] = (svcRes.recordset as Record<string, unknown>[]).map((row) => {
    const CatType = row.CatType != null ? String(row.CatType) : null;
    const CatName = row.CatName != null ? String(row.CatName) : null;
    const ProType = row.ProType != null ? String(row.ProType) : null;
    return {
      ProID: Number(row.ProID),
      ProName: String(row.ProName ?? ''),
      ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
      SPrice1: Number(row.SPrice1) || 0,
      CatID: row.CatID != null ? Number(row.CatID) : null,
      CatName,
      CatType,
      ProType,
      isDeleted: Number(row.isDeleted) === 1,
      isProduct: isRetailProductClassification({ ProType, CatType, CatName }),
    };
  });

  // Resolve categories for planning (assume missing group cats will be created on apply)
  const groupCatByKey = new Map<AddonGroup, CategoryRow | undefined>();
  for (const g of neededGroupCats) {
    groupCatByKey.set(
      g.key,
      categories.find((c) => normalizeName(c.CatName) === normalizeName(g.name)),
    );
  }

  const servicePlans = REQUESTED.map((req) => {
    const groupCat = groupCatByKey.get(req.group);
    // For dry-run CREATE when category missing, synthesize a placeholder target name.
    const category =
      resolvePreferredCategory(req, categories, groupCat) ||
      (req.useGroupCategory
        ? ({ CatID: -1, CatName: GROUP_CATEGORY[req.group], CatType: 'serv' } as CategoryRow)
        : undefined);
    return planService(req, catalog, category?.CatID === -1 ? undefined : category);
  });

  // Re-plan CREATEs that only failed due to missing group category (will create cat on apply)
  for (let i = 0; i < servicePlans.length; i++) {
    const plan = servicePlans[i];
    if (
      plan.action === 'AMBIGUOUS' &&
      plan.reason.includes('no category') &&
      plan.requested.useGroupCategory
    ) {
      servicePlans[i] = {
        ...plan,
        action: 'CREATE',
        category: {
          CatID: -1,
          CatName: GROUP_CATEGORY[plan.requested.group],
          CatType: 'serv',
        },
        reason: `will CREATE category "${GROUP_CATEGORY[plan.requested.group]}" then service`,
      };
    }
  }

  for (const plan of servicePlans) printServicePlan(plan);

  const ambiguous = servicePlans.filter((p) => p.action === 'AMBIGUOUS');
  if (ambiguous.length) {
    console.error(`\nSTOP — ${ambiguous.length} unresolved service(s). No writes.`);
    process.exit(2);
  }

  // Load groom packages
  const pkgRes = await db.request().query(`
    SELECT PackageID, NameEn, NameAr, NotesAr, isDeleted
    FROM dbo.TblServicePackage
    WHERE PackageKind = N'groom' AND isDeleted = 0
    ORDER BY SortOrder, PackageID
  `);

  const packages = pkgRes.recordset as Array<{
    PackageID: number;
    NameEn: string;
    NameAr: string | null;
    NotesAr: string | null;
  }>;

  const itemRes = await db.request().query(`
    SELECT PackageID, ProID, IsOptional
    FROM dbo.TblServicePackageItem
  `);
  const itemsByPkg = new Map<number, Array<{ ProID: number; IsOptional: boolean }>>();
  for (const row of itemRes.recordset as Array<{
    PackageID: number;
    ProID: number;
    IsOptional: boolean | number;
  }>) {
    const list = itemsByPkg.get(row.PackageID) ?? [];
    list.push({
      ProID: Number(row.ProID),
      IsOptional: Number(row.IsOptional) === 1 || row.IsOptional === true,
    });
    itemsByPkg.set(row.PackageID, list);
  }

  // Resolve planned ProIDs (best-effort for dry-run)
  const keyToProId = new Map<string, number>();
  for (const plan of servicePlans) {
    if (plan.finalProID != null) keyToProId.set(plan.requested.key, plan.finalProID);
  }

  const packagePlans: PackageOptionalPlan[] = [];
  for (const rule of PACKAGE_OPTIONAL_RULES) {
    const pkg =
      packages.find((p) => (p.NotesAr ?? '').includes(`[seed:${rule.seedKey}]`)) ||
      packages.find((p) => normalizeName(p.NameEn) === normalizeName(rule.matchNameEn));
    if (!pkg) {
      console.error(`\nSTOP — groom package not found: ${rule.matchNameEn}`);
      process.exit(2);
    }
    const existing = itemsByPkg.get(pkg.PackageID) ?? [];
    const requiredIds = new Set(
      existing.filter((i) => !i.IsOptional).map((i) => i.ProID),
    );
    const optionalProIds: number[] = [];
    const skippedAlreadyIncluded: number[] = [];
    for (const key of rule.addonKeys) {
      const proId = keyToProId.get(key);
      if (proId == null) {
        // CREATE on apply — mark as pending with 0 for dry-run display
        optionalProIds.push(0);
        continue;
      }
      if (requiredIds.has(proId)) {
        skippedAlreadyIncluded.push(proId);
        continue;
      }
      optionalProIds.push(proId);
    }
    packagePlans.push({
      packageId: pkg.PackageID,
      packageName: pkg.NameEn,
      packageKey: rule.seedKey,
      optionalProIds: optionalProIds.filter((id) => id > 0),
      skippedAlreadyIncluded,
    });
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log('PACKAGE OPTIONAL LINKS');
  console.log(`${'='.repeat(64)}`);
  for (const pp of packagePlans) {
    console.log(
      `\n${pp.packageName} (PackageID=${pp.packageId}) [${pp.packageKey}]`,
    );
    console.log(`  Optional ProIDs to sync: ${pp.optionalProIds.join(', ') || '(pending CREATE)'}`);
    if (pp.skippedAlreadyIncluded.length) {
      console.log(
        `  Skipped (already required): ${pp.skippedAlreadyIncluded.join(', ')}`,
      );
    }
  }

  if (!apply) {
    console.log(`\n[dry-run] Summary:`);
    for (const p of servicePlans) {
      console.log(
        `  ${p.requested.nameEn.padEnd(42)} → ${p.action}` +
          (p.finalProID != null ? ` ProID=${p.finalProID}` : ''),
      );
    }
    console.log(`  Categories to create: ${missingCats.map((c) => c.name).join(', ') || '(none)'}`);
    console.log('\nNo DB writes. Re-run with --apply after review.');
    if (typeof closePool === 'function') await closePool();
    process.exit(0);
  }

  console.log('\n[apply] Writing in one transaction...');
  const tx = new sql.Transaction(db);
  await tx.begin();

  const serviceResults: Array<{
    key: string;
    action: Action;
    proId: number;
    nameEn: string;
    price: number;
    category: string;
  }> = [];

  try {
    // Ensure group categories
    for (const g of neededGroupCats) {
      let cat = categories.find(
        (c) => normalizeName(c.CatName) === normalizeName(g.name),
      );
      if (!cat) {
        // Try with CatType if column exists; fall back to name-only.
        let inserted: { recordset: Array<{ CatID: number }> };
        try {
          inserted = await new sql.Request(tx)
            .input('CatName', g.name)
            .input('CatType', 'serv')
            .query(`
              INSERT INTO dbo.TblCat (CatName, CatType)
              VALUES (@CatName, @CatType);
              SELECT CAST(SCOPE_IDENTITY() AS INT) AS CatID;
            `);
        } catch {
          inserted = await new sql.Request(tx)
            .input('CatName', g.name)
            .query(`
              INSERT INTO dbo.TblCat (CatName)
              VALUES (@CatName);
              SELECT CAST(SCOPE_IDENTITY() AS INT) AS CatID;
            `);
        }
        cat = {
          CatID: Number(inserted.recordset[0].CatID),
          CatName: g.name,
          CatType: 'serv',
        };
        categories.push(cat);
        console.log(`  created category CatID=${cat.CatID} "${cat.CatName}"`);
      }
      groupCatByKey.set(g.key, cat);
    }

    // Refresh service plans with real categories
    const livePlans = REQUESTED.map((req) => {
      const groupCat = groupCatByKey.get(req.group);
      const category = resolvePreferredCategory(req, categories, groupCat);
      return planService(req, catalog, category);
    });

    for (const plan of livePlans) {
      if (plan.action === 'AMBIGUOUS') {
        throw new Error(`Unresolved ${plan.requested.key}: ${plan.reason}`);
      }
      const r = plan.requested;

      if (plan.action === 'REUSE' && plan.matched) {
        serviceResults.push({
          key: r.key,
          action: 'REUSE',
          proId: plan.matched.ProID,
          nameEn: r.nameEn,
          price: plan.matched.SPrice1,
          category: plan.matched.CatName ?? plan.category?.CatName ?? '—',
        });
        keyToProId.set(r.key, plan.matched.ProID);
        continue;
      }

      if (
        (plan.action === 'RESTORE' || plan.action === 'UPDATE') &&
        plan.matched
      ) {
        const m = plan.matched;
        const catId = r.ownedSku
          ? (plan.category?.CatID ?? m.CatID)
          : m.CatID;
        await new sql.Request(tx)
          .input('ProID', m.ProID)
          .input('ProName', r.ownedSku ? r.nameEn : m.ProName)
          .input('ProNameAr', r.ownedSku ? r.nameAr : m.ProNameAr)
          .input('SPrice1', r.ownedSku ? r.price : m.SPrice1)
          .input('CatID', catId)
          .input('ProType', 'serv')
          .query(`
            UPDATE dbo.TblPro
            SET isDeleted = 0,
                ProName = @ProName,
                ProNameAr = @ProNameAr,
                SPrice1 = @SPrice1,
                CatID = COALESCE(@CatID, CatID),
                ProType = CASE
                  WHEN ProType IS NULL OR LTRIM(RTRIM(ProType)) = N'' THEN @ProType
                  ELSE ProType
                END
            WHERE ProID = @ProID
          `);
        serviceResults.push({
          key: r.key,
          action: plan.action,
          proId: m.ProID,
          nameEn: r.nameEn,
          price: r.ownedSku ? r.price : m.SPrice1,
          category: plan.category?.CatName ?? m.CatName ?? '—',
        });
        keyToProId.set(r.key, m.ProID);
        // keep catalog in sync for later package planning
        m.isDeleted = false;
        if (r.ownedSku) {
          m.ProName = r.nameEn;
          m.ProNameAr = r.nameAr;
          m.SPrice1 = r.price;
          if (catId != null) m.CatID = catId;
        }
        continue;
      }

      if (plan.action === 'CREATE') {
        if (!plan.category || plan.category.CatID < 0) {
          throw new Error(`CREATE blocked for ${r.key}: missing category`);
        }
        const inserted = await new sql.Request(tx)
          .input('ProName', r.nameEn)
          .input('ProNameAr', r.nameAr)
          .input('SPrice1', r.price)
          .input('Bonus', 0)
          .input('CatID', plan.category.CatID)
          .input('ProType', 'serv')
          .input('isDeleted', 0)
          .query(`
            INSERT INTO dbo.TblPro (ProName, ProNameAr, SPrice1, Bonus, CatID, ProType, isDeleted)
            VALUES (@ProName, @ProNameAr, @SPrice1, @Bonus, @CatID, @ProType, @isDeleted);
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS ProID;
          `);
        const proId = Number(inserted.recordset[0].ProID);
        catalog.push({
          ProID: proId,
          ProName: r.nameEn,
          ProNameAr: r.nameAr,
          SPrice1: r.price,
          CatID: plan.category.CatID,
          CatName: plan.category.CatName,
          CatType: plan.category.CatType,
          ProType: 'serv',
          isDeleted: false,
          isProduct: false,
        });
        serviceResults.push({
          key: r.key,
          action: 'CREATE',
          proId,
          nameEn: r.nameEn,
          price: r.price,
          category: plan.category.CatName,
        });
        keyToProId.set(r.key, proId);
        console.log(`  created ProID=${proId} ${r.nameEn}`);
      }
    }

    // Sync optional package items (leave required items untouched)
    for (const rule of PACKAGE_OPTIONAL_RULES) {
      const pkg =
        packages.find((p) => (p.NotesAr ?? '').includes(`[seed:${rule.seedKey}]`)) ||
        packages.find((p) => normalizeName(p.NameEn) === normalizeName(rule.matchNameEn));
      if (!pkg) throw new Error(`Package missing: ${rule.matchNameEn}`);

      const existing = itemsByPkg.get(pkg.PackageID) ?? [];
      const requiredIds = new Set(
        existing.filter((i) => !i.IsOptional).map((i) => i.ProID),
      );

      const desiredOptional: number[] = [];
      for (const key of rule.addonKeys) {
        const proId = keyToProId.get(key);
        if (proId == null) throw new Error(`No ProID for addon key ${key}`);
        if (requiredIds.has(proId)) continue;
        if (!desiredOptional.includes(proId)) desiredOptional.push(proId);
      }

      // Delete optional links for this package, then insert desired set
      await new sql.Request(tx)
        .input('PackageID', pkg.PackageID)
        .query(`
          DELETE FROM dbo.TblServicePackageItem
          WHERE PackageID = @PackageID AND IsOptional = 1
        `);

      let addonSort = 1000;
      let visitSort = 2000;
      for (const proId of desiredOptional) {
        const req = REQUESTED.find((r) => keyToProId.get(r.key) === proId);
        const sortOrder =
          req?.group === 'home_visit' ? (visitSort += 10) : (addonSort += 10);
        await new sql.Request(tx)
          .input('PackageID', pkg.PackageID)
          .input('ProID', proId)
          .input('Qty', 1)
          .input('SortOrder', sortOrder)
          .input('IsOptional', 1)
          .query(`
            INSERT INTO dbo.TblServicePackageItem (PackageID, ProID, Qty, SortOrder, IsOptional)
            VALUES (@PackageID, @ProID, @Qty, @SortOrder, @IsOptional)
          `);
      }
      console.log(
        `  synced optional items PackageID=${pkg.PackageID} count=${desiredOptional.length} ProIDs=${desiredOptional.join(',')}`,
      );
    }

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    console.error('[apply] FAILED — rolled back:', err);
    process.exit(1);
  }

  // Verification
  console.log(`\n${'='.repeat(64)}`);
  console.log('VERIFICATION');
  console.log(`${'='.repeat(64)}`);

  for (const r of serviceResults) {
    const check = await db
      .request()
      .input('ProID', r.proId)
      .query(`
        SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1, ISNULL(p.isDeleted,0) AS isDeleted,
               c.CatName
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
        WHERE p.ProID = @ProID
      `);
    const row = check.recordset[0];
    console.log(
      `  ${r.action.padEnd(8)} ProID=${r.proId} "${row?.ProName}" price=${row?.SPrice1} cat=${row?.CatName} deleted=${row?.isDeleted}`,
    );
  }

  // Duplicate name check for owned SKUs
  for (const req of REQUESTED.filter((r) => r.ownedSku)) {
    const dups = await db
      .request()
      .input('Name', req.nameEn)
      .query(`
        SELECT ProID, ProName, ISNULL(isDeleted,0) AS isDeleted
        FROM dbo.TblPro
        WHERE ProName = @Name AND ISNULL(isDeleted,0) = 0
      `);
    if (dups.recordset.length !== 1) {
      console.error(
        `FAIL: expected exactly 1 active "${req.nameEn}", found ${dups.recordset.length}`,
      );
      process.exit(1);
    }
  }

  // Package optional verification
  for (const rule of PACKAGE_OPTIONAL_RULES) {
    const pkg =
      packages.find((p) => (p.NotesAr ?? '').includes(`[seed:${rule.seedKey}]`)) ||
      packages.find((p) => normalizeName(p.NameEn) === normalizeName(rule.matchNameEn));
    if (!pkg) continue;
    const items = await db
      .request()
      .input('PackageID', pkg.PackageID)
      .query(`
        SELECT ProID, IsOptional FROM dbo.TblServicePackageItem WHERE PackageID = @PackageID
      `);
    const optional = (items.recordset as Array<{ ProID: number; IsOptional: boolean | number }>)
      .filter((i) => Number(i.IsOptional) === 1)
      .map((i) => Number(i.ProID));
    const required = (items.recordset as Array<{ ProID: number; IsOptional: boolean | number }>)
      .filter((i) => Number(i.IsOptional) !== 1)
      .map((i) => Number(i.ProID));

    console.log(
      `  Package ${pkg.NameEn}: required=${required.length} optional=${optional.join(',')}`,
    );

    if (rule.seedKey === 'GROOM_COMPLETE') {
      if (optional.includes(14) || optional.includes(1077)) {
        console.error('FAIL: Complete must not offer pedicure/protein as optional');
        process.exit(1);
      }
      if (!required.includes(14) || !required.includes(1077)) {
        console.error('FAIL: Complete must keep pedicure/protein as required');
        process.exit(1);
      }
    }
  }

  console.log('\nRESULTS:');
  for (const r of serviceResults) {
    console.log(`  ${r.key}: ${r.action} ProID=${r.proId} price=${r.price} cat=${r.category}`);
  }
  console.log('\nPASS — groom add-ons ensured.');
  if (typeof closePool === 'function') await closePool();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
