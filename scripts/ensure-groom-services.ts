/**
 * Ensure CUT Salon groom-specific services exist in dbo.TblPro.
 *
 * Idempotent:
 *  - exact / alias match → REUSE (no duplicate)
 *  - soft-deleted equivalent → RESTORE
 *  - genuinely missing → CREATE
 *  - ambiguous matches → abort before writes
 *
 * There is no IsBookable column on TblPro — public/ops bookability is derived
 * from active salon-service filters (not deleted, price > 0, not product/excluded).
 * This script does NOT change booking/product filter logic.
 *
 * Usage:
 *   npx tsx scripts/ensure-groom-services.ts --dry-run [--local|--cloud]
 *   npx tsx scripts/ensure-groom-services.ts --apply [--local|--cloud]
 *   npm run ensure:groom-services
 *   npm run ensure:groom-services:apply
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

type Action = 'REUSE' | 'RESTORE' | 'CREATE' | 'AMBIGUOUS';

interface RequestedService {
  key: string;
  nameEn: string;
  nameAr: string;
  price: number;
  /** Preferred category names (first live match wins). */
  categoryPreferences: string[];
  aliases: string[];
  /**
   * Normalized names that must NEVER be treated as equivalents
   * (e.g. Dry-Hair must stay separate from Groom Final Styling).
   */
  excludeNormalizedNames: string[];
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
  DurationMinutes: number | null;
  isDeleted: boolean;
  isProduct: boolean;
}

interface CategoryRow {
  CatID: number;
  CatName: string;
  CatType: string | null;
}

interface PlanItem {
  requested: RequestedService;
  action: Action;
  matched?: CatalogRow;
  candidates?: CatalogRow[];
  category?: CategoryRow;
  reason: string;
  finalProID?: number;
}

const REQUESTED: RequestedService[] = [
  {
    key: 'NOSE_EAR_WAX',
    nameEn: 'Nose & Ear Wax',
    nameAr: 'وكس الأنف والأذن',
    price: 80,
    categoryPreferences: ['Skincare', 'العناية بالبشرة'],
    aliases: [
      'Nose and Ear Wax',
      'Nose & Ear Waxing',
      'Nose and Ear Waxing',
      'وكس الأنف والأذن',
      'واكس الأنف والأذن',
      'واكس الانف والاذن',
      'وكس الانف والاذن',
    ],
    // Face / Full / Partial wax are different SKUs — never reuse them.
    excludeNormalizedNames: [
      'face wax',
      'full wax',
      'full face wax',
      'partial wax',
      'واكس وش كامل',
      'واكس جزئي',
      'وكس الوجه',
    ],
  },
  {
    key: 'GROOM_FINAL_STYLING',
    nameEn: 'Groom Final Styling',
    nameAr: 'تسريح وتجهيز العريس النهائي',
    price: 200,
    categoryPreferences: [
      'Hair Styling & Finishing',
      'خدمات اضافيه للشعر',
      'خدمات إضافية للشعر',
    ],
    aliases: [
      'Groom Final Styling',
      'Groom Final Style',
      'تسريح وتجهيز العريس النهائي',
      'تسريح العريس النهائي',
    ],
    // Must stay separate from normal dry/styling catalog items.
    excludeNormalizedNames: [
      'dry hair',
      'dry-hair',
      'blow dry',
      'blowdry',
      'hair styling',
      'styling',
      'wavy styling',
      'سشوار',
      'تصفيف شعر',
      'تصفيف الشعر',
      'ويفي',
    ],
  },
  {
    key: 'FINAL_TOUCH',
    nameEn: 'Final Touch',
    nameAr: 'اللمسات النهائية للعريس',
    price: 150,
    categoryPreferences: [
      'Hair Styling & Finishing',
      'خدمات اضافيه للشعر',
      'خدمات إضافية للشعر',
      'Skincare',
    ],
    aliases: [
      'Final Touch',
      'Groom Final Touch',
      'Final Touches',
      'اللمسات النهائية للعريس',
      'لمسات نهائية للعريس',
    ],
    excludeNormalizedNames: [
      'dry hair',
      'dry-hair',
      'hair styling',
      'styling',
      'premium finishing touches',
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

function parseArgs(argv: string[]): {
  apply: boolean;
  dbTarget: 'cloud' | 'local';
} {
  const apply = argv.includes('--apply');
  const dry = argv.includes('--dry-run');
  if (apply && dry) throw new Error('Use either --apply or --dry-run, not both');
  const envTarget = String(process.env.AUDIT_DB_TARGET || '').trim().toLowerCase();
  let dbTarget: 'cloud' | 'local' = envTarget === 'local' ? 'local' : 'cloud';
  // Default to local when HAWAI_DB_CLASS is local-like (casher default tunnel).
  const cls = String(process.env.HAWAI_DB_CLASS || '').trim().toLowerCase();
  if (cls === 'local' || cls === 'isolated' || cls === 'test' || cls === 'dev') {
    dbTarget = 'local';
  }
  if (argv.includes('--local')) dbTarget = 'local';
  if (argv.includes('--cloud')) dbTarget = 'cloud';
  // Default CLI mode is dry-run unless --apply.
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

function isExcluded(svc: CatalogRow, requested: RequestedService): boolean {
  const names = [normalizeName(svc.ProName), normalizeName(svc.ProNameAr)];
  const excluded = requested.excludeNormalizedNames.map(normalizeName);
  return names.some((n) => n && excluded.includes(n));
}

function scoreMatch(svc: CatalogRow, requested: RequestedService): number {
  if (isExcluded(svc, requested)) return 0;

  const names = [normalizeName(svc.ProName), normalizeName(svc.ProNameAr)].filter(
    Boolean,
  );
  const terms = [
    requested.nameEn,
    requested.nameAr,
    ...requested.aliases,
  ].map(normalizeName);

  let best = 0;
  for (const term of terms) {
    if (!term) continue;
    for (const n of names) {
      if (n === term) best = Math.max(best, 100);
      else if (n.includes(term) || term.includes(n)) {
        // Require strong overlap — avoid Face Wax matching "Wax" alone.
        const shorter = n.length <= term.length ? n : term;
        const longer = n.length > term.length ? n : term;
        if (shorter.length >= 10 && longer.includes(shorter)) {
          best = Math.max(best, 70);
        }
      }
    }
  }
  return best;
}

function resolveCategory(
  requested: RequestedService,
  categories: CategoryRow[],
): CategoryRow | undefined {
  for (const pref of requested.categoryPreferences) {
    const want = normalizeName(pref);
    const hit = categories.find((c) => normalizeName(c.CatName) === want);
    if (hit) return hit;
  }
  for (const pref of requested.categoryPreferences) {
    const want = normalizeName(pref);
    const hit = categories.find((c) => {
      const n = normalizeName(c.CatName);
      return n.includes(want) || want.includes(n);
    });
    if (hit) return hit;
  }
  return undefined;
}

function planService(
  requested: RequestedService,
  catalog: CatalogRow[],
  categories: CategoryRow[],
): PlanItem {
  const category = resolveCategory(requested, categories);
  const scored = catalog
    .map((service) => ({ service, score: scoreMatch(service, requested) }))
    .filter((x) => x.score >= 70)
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
        reason: 'CREATE needed but no matching category found',
      };
    }
    return {
      requested,
      action: 'CREATE',
      category,
      reason: 'no equivalent service found (active or soft-deleted)',
    };
  }

  if (pool.length > 1 && pool[0].score === pool[1].score) {
    return {
      requested,
      action: 'AMBIGUOUS',
      candidates: pool.map((p) => p.service),
      category,
      reason: `ambiguous matches (score=${pool[0].score})`,
    };
  }

  const matched = pool[0].service;
  if (matched.isDeleted) {
    return {
      requested,
      action: 'RESTORE',
      matched,
      category,
      reason: `soft-deleted equivalent ServiceID/ProID=${matched.ProID}`,
      finalProID: matched.ProID,
    };
  }

  return {
    requested,
    action: 'REUSE',
    matched,
    category,
    reason: `active equivalent ServiceID/ProID=${matched.ProID}`,
    finalProID: matched.ProID,
  };
}

function printPlan(item: PlanItem): void {
  const r = item.requested;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`Requested: ${r.nameEn}`);
  console.log(`  Arabic:   ${r.nameAr}`);
  console.log(`  Price:    ${r.price} EGP`);
  console.log(`  Key:      ${r.key}`);
  if (item.matched) {
    const m = item.matched;
    console.log(`Matched existing:`);
    console.log(`  ServiceID/ProID: ${m.ProID}`);
    console.log(`  NameEn:          ${m.ProName}`);
    console.log(`  NameAr:          ${m.ProNameAr ?? '—'}`);
    console.log(`  Status:          ${m.isDeleted ? 'SOFT-DELETED' : 'ACTIVE'}`);
    console.log(`  Category:        ${m.CatName ?? '—'} (CatID=${m.CatID ?? '—'})`);
    console.log(`  Price:           ${m.SPrice1} EGP`);
    console.log(`  ProType:         ${m.ProType || '—'}`);
  } else {
    console.log(`Matched existing: (none)`);
  }
  if (item.candidates?.length) {
    console.log(`Candidates:`);
    for (const c of item.candidates) {
      console.log(
        `  - ServiceID/ProID=${c.ProID} "${c.ProName}" / ${c.ProNameAr ?? '—'} ` +
          `[${c.CatName ?? '—'}] price=${c.SPrice1} deleted=${c.isDeleted ? 1 : 0}` +
          `${c.isProduct ? ' PRODUCT' : ''}`,
      );
    }
  }
  if (item.category) {
    console.log(
      `Target category: ${item.category.CatName} (CatID=${item.category.CatID})`,
    );
  }
  console.log(`Action: ${item.action}`);
  console.log(`Reason: ${item.reason}`);
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

  console.log(`[ensure-groom-services] mode=${mode} db=${dbTarget}`);
  console.log(
    '[ensure-groom-services] booking/product filters: UNCHANGED (no policy edits)',
  );

  const { getPool, setDbTarget, sql } = await import('../src/lib/db');
  await setDbTarget(dbTarget);
  const { isRetailProductClassification } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );

  const db = await getPool();

  const catRes = await db.request().query(`
    SELECT CatID, CatName, CatType
    FROM dbo.TblCat
    ORDER BY CatID
  `);
  const categories: CategoryRow[] = (catRes.recordset as Record<string, unknown>[]).map(
    (row) => ({
      CatID: Number(row.CatID),
      CatName: String(row.CatName ?? ''),
      CatType: row.CatType != null ? String(row.CatType) : null,
    }),
  );

  const svcRes = await db.request().query(`
    SELECT
      p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
      p.CatID, ISNULL(p.ProType, N'') AS ProType,
      ISNULL(p.isDeleted, 0) AS isDeleted,
      c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY p.ProID
  `);

  const catalog: CatalogRow[] = (svcRes.recordset as Record<string, unknown>[]).map(
    (row) => {
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
        DurationMinutes:
          row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
        isDeleted: Number(row.isDeleted) === 1,
        isProduct: isRetailProductClassification({ ProType, CatType, CatName }),
      };
    },
  );

  const plans = REQUESTED.map((req) => planService(req, catalog, categories));
  for (const plan of plans) printPlan(plan);

  const ambiguous = plans.filter((p) => p.action === 'AMBIGUOUS');
  if (ambiguous.length) {
    console.error(
      `\n[ensure-groom-services] STOP — ${ambiguous.length} ambiguous/unresolvable item(s). No writes.`,
    );
    process.exit(2);
  }

  if (!apply) {
    console.log(`\n[dry-run] Summary:`);
    for (const p of plans) {
      console.log(
        `  ${p.requested.nameEn.padEnd(24)} → ${p.action}` +
          (p.finalProID != null ? ` (ProID ${p.finalProID})` : ''),
      );
    }
    console.log(
      '\nNo DB writes. Re-run with --apply after reviewing actions above.',
    );
    process.exit(0);
  }

  console.log('\n[apply] Writing inside a single transaction...');
  const tx = new sql.Transaction(db);
  await tx.begin();

  const results: Array<{
    key: string;
    action: Action;
    proId: number;
    nameEn: string;
    nameAr: string;
    price: number;
    category: string;
  }> = [];

  try {
    for (const plan of plans) {
      const r = plan.requested;
      if (plan.action === 'REUSE' && plan.matched) {
        const m = plan.matched;
        // Align identity fields when this is clearly our SKU (exact name).
        const exactName =
          normalizeName(m.ProName) === normalizeName(r.nameEn) ||
          normalizeName(m.ProNameAr) === normalizeName(r.nameAr);
        if (exactName) {
          const req = new sql.Request(tx);
          await req
            .input('ProID', m.ProID)
            .input('ProName', r.nameEn)
            .input('ProNameAr', r.nameAr)
            .input('SPrice1', r.price)
            .input('CatID', plan.category?.CatID ?? m.CatID)
            .input('ProType', 'serv').query(`
              UPDATE dbo.TblPro
              SET ProName = @ProName,
                  ProNameAr = @ProNameAr,
                  SPrice1 = @SPrice1,
                  CatID = COALESCE(@CatID, CatID),
                  ProType = CASE
                    WHEN ProType IS NULL OR LTRIM(RTRIM(ProType)) = N'' THEN @ProType
                    ELSE ProType
                  END,
                  isDeleted = 0
              WHERE ProID = @ProID
            `);
        }
        results.push({
          key: r.key,
          action: 'REUSE',
          proId: m.ProID,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          price: exactName ? r.price : m.SPrice1,
          category: plan.category?.CatName ?? m.CatName ?? '—',
        });
        continue;
      }

      if (plan.action === 'RESTORE' && plan.matched) {
        const m = plan.matched;
        const req = new sql.Request(tx);
        await req
          .input('ProID', m.ProID)
          .input('ProName', r.nameEn)
          .input('ProNameAr', r.nameAr)
          .input('SPrice1', r.price)
          .input('CatID', plan.category?.CatID ?? m.CatID)
          .input('ProType', 'serv').query(`
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
        results.push({
          key: r.key,
          action: 'RESTORE',
          proId: m.ProID,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          price: r.price,
          category: plan.category?.CatName ?? m.CatName ?? '—',
        });
        continue;
      }

      if (plan.action === 'CREATE') {
        if (!plan.category) {
          throw new Error(`CREATE blocked for ${r.key}: missing category`);
        }
        const req = new sql.Request(tx);
        const inserted = await req
          .input('ProName', r.nameEn)
          .input('ProNameAr', r.nameAr)
          .input('SPrice1', r.price)
          .input('Bonus', 0)
          .input('CatID', plan.category.CatID)
          .input('ProType', 'serv')
          .input('isDeleted', 0).query(`
            INSERT INTO dbo.TblPro (ProName, ProNameAr, SPrice1, Bonus, CatID, ProType, isDeleted)
            VALUES (@ProName, @ProNameAr, @SPrice1, @Bonus, @CatID, @ProType, @isDeleted);

            SELECT CAST(SCOPE_IDENTITY() AS INT) AS ProID;
          `);
        const proId = Number(inserted.recordset[0].ProID);
        results.push({
          key: r.key,
          action: 'CREATE',
          proId,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          price: r.price,
          category: plan.category.CatName,
        });
        continue;
      }

      throw new Error(`Unhandled action for ${r.key}: ${plan.action}`);
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  // Post-apply verification
  console.log('\n[verify] Checking exactly one active service per requested SKU...');
  let verifyOk = true;
  for (const r of REQUESTED) {
    const check = await db
      .request()
      .input('NameEn', r.nameEn)
      .input('NameAr', r.nameAr)
      .query(`
        SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1,
               ISNULL(p.isDeleted,0) AS isDeleted, c.CatName
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
        WHERE ISNULL(p.isDeleted,0) = 0
          AND (
            p.ProName = @NameEn
            OR p.ProNameAr = @NameAr
          )
        ORDER BY p.ProID
      `);
    const rows = check.recordset as Array<{
      ProID: number;
      ProName: string;
      ProNameAr: string | null;
      SPrice1: number;
      isDeleted: boolean | number;
      CatName: string | null;
    }>;
    const priceOk = rows.length === 1 && Number(rows[0].SPrice1) === r.price;
    const status = rows.length === 1 && priceOk ? 'PASS' : 'FAIL';
    if (status === 'FAIL') verifyOk = false;
    console.log(
      `  ${status} ${r.nameEn}: count=${rows.length}` +
        (rows[0]
          ? ` ProID=${rows[0].ProID} price=${rows[0].SPrice1} cat=${rows[0].CatName}`
          : ''),
    );
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log('FINAL REPORT');
  console.log(`${'='.repeat(64)}`);
  console.log(
    `Already existed (REUSE): ${results.filter((x) => x.action === 'REUSE').length}`,
  );
  console.log(
    `Restored:                ${results.filter((x) => x.action === 'RESTORE').length}`,
  );
  console.log(
    `Created:                 ${results.filter((x) => x.action === 'CREATE').length}`,
  );
  console.log('');
  for (const row of results) {
    console.log(
      `  [${row.action}] ${row.nameEn} / ${row.nameAr}` +
        `\n           ServiceID/ProID=${row.proId}` +
        `\n           category=${row.category}` +
        `\n           price=${row.price} EGP`,
    );
  }
  console.log('');
  console.log('Duplicate check: verification requires exactly one active row per name.');
  console.log('Booking/product filters: not modified by this script.');
  console.log(`Verification: ${verifyOk ? 'PASS' : 'FAIL'}`);

  process.exit(verifyOk ? 0 : 3);
}

main().catch((err) => {
  console.error('[ensure-groom-services] fatal:', err);
  process.exit(1);
});
