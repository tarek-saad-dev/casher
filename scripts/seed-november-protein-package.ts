/**
 * Seed CUT Salon November 2026 Protein Package (NOV-PRO600).
 *
 * Idempotent + transaction-safe:
 *  - Ensure generic "Care Mask" service (create only if missing)
 *  - Soft-delete October promotional package for NEW bookings (history preserved)
 *  - Upsert November regular package with campaign window in NotesAr
 *
 * Usage:
 *   npx tsx scripts/seed-november-protein-package.ts --dry-run [--local|--cloud]
 *   npx tsx scripts/seed-november-protein-package.ts --apply [--local|--cloud]
 *   npx tsx scripts/seed-november-protein-package.ts --apply --cloud --allow-production
 *
 * Production DB `last132` is refused unless --allow-production is set (human approval).
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Module from 'module';

const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const ROOT = process.cwd();
const DEFAULT_SEED_PATH = path.join(ROOT, 'cut-salon-november-protein-package.json');
const PRODUCTION_DB = 'last132';
const SEED_MARKER = (key: string) => `[seed:${key}]`;

interface EnsureServiceSpec {
  key: string;
  nameEn: string;
  nameAr: string;
  preferredPrice: number;
  preferredDurationMinutes: number;
  categoryPreferences: string[];
  proType?: string;
  note?: string;
}

interface IncludedServiceRef {
  key: string;
  proId: number | null;
  preferredName: string;
  resolveByExactName?: boolean;
  role?: string;
  note?: string;
}

interface SeedPackage {
  key: string;
  nameEn: string;
  nameAr: string;
  price: number;
  displayOrder: number;
  recommended?: boolean;
  active?: boolean;
  descriptionEn?: string;
  descriptionAr?: string;
  includedServices: IncludedServiceRef[];
}

interface SeedFile {
  internalCode: string;
  campaign: {
    code: string;
    from: string;
    to: string;
    timezone: string;
  };
  disablePackages: Array<{ key: string; nameEn: string; nameAr: string }>;
  ensureServices: EnsureServiceSpec[];
  packages: SeedPackage[];
}

function loadEnvLocal(): void {
  for (const envPath of ['.env.local', '.env']) {
    try {
      const envText = readFileSync(path.join(ROOT, envPath), 'utf8');
      for (const line of envText.split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          let value = match[2].trim();
          value = value.replace(/^["']|["']$/g, '');
          process.env[match[1]] = value;
        }
      }
    } catch {
      /* missing ok */
    }
  }
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const dry = argv.includes('--dry-run');
  if (apply && dry) throw new Error('Use either --apply or --dry-run, not both');
  const pathIdx = argv.indexOf('--seed');
  const seedPath =
    pathIdx >= 0 && argv[pathIdx + 1]
      ? path.resolve(argv[pathIdx + 1])
      : DEFAULT_SEED_PATH;
  const envTarget = String(process.env.AUDIT_DB_TARGET || '').trim().toLowerCase();
  let dbTarget: 'cloud' | 'local' = envTarget === 'local' ? 'local' : 'cloud';
  if (argv.includes('--local')) dbTarget = 'local';
  if (argv.includes('--cloud')) dbTarget = 'cloud';
  const allowProduction = argv.includes('--allow-production');
  return { apply: apply && !dry, seedPath, dbTarget, allowProduction };
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
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadSeedFile(seedPath: string): SeedFile {
  if (!existsSync(seedPath)) throw new Error(`Seed file not found: ${seedPath}`);
  const raw = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
  if (!raw?.packages?.length) throw new Error('Seed file has no packages');
  if (!raw.campaign?.code || !raw.campaign.from || !raw.campaign.to) {
    throw new Error('Seed file missing campaign window');
  }
  return raw;
}

function buildNotesAr(
  pkgKey: string,
  campaign: SeedFile['campaign'],
  formatMarker: (w: {
    code: string;
    from: string;
    to: string;
    timezone: string;
  }) => string,
): string {
  const parts = [
    SEED_MARKER(pkgKey),
    formatMarker({
      code: campaign.code,
      from: campaign.from,
      to: campaign.to,
      timezone: campaign.timezone || 'Africa/Cairo',
    }),
  ];
  const joined = parts.join(' ');
  return joined.length > 500 ? joined.slice(0, 497) + '...' : joined;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { apply, seedPath, dbTarget, allowProduction } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'APPLY' : 'DRY-RUN';

  if (dbTarget === 'cloud') {
    delete process.env.HAWAI_DB_CLASS;
    delete process.env.BOOKING_V2_DB_CLASS;
    delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  }

  console.log(`[seed-nov-pro600] mode=${mode} db=${dbTarget}`);
  console.log(`[seed-nov-pro600] seed=${seedPath}`);

  const seed = loadSeedFile(seedPath);

  const { getPool, setDbTarget, sql } = await import('../src/lib/db');
  await setDbTarget(dbTarget);
  const db = await getPool();

  const dbNameRes = await db.request().query(`SELECT DB_NAME() AS DB`);
  const liveDb = String(dbNameRes.recordset[0]?.DB ?? '');
  console.log(`[seed-nov-pro600] live database: ${liveDb}`);
  if (liveDb === PRODUCTION_DB && apply && !allowProduction) {
    throw new Error(
      `Refusing to write production database ${PRODUCTION_DB}. Re-run with --allow-production after human approval.`,
    );
  }
  if (liveDb === PRODUCTION_DB && !apply) {
    console.log(
      `[seed-nov-pro600] NOTE: dry-run against production is read-only; apply still requires --allow-production.`,
    );
  }

  const { resolveLegacyBootstrapTenantId } = await import(
    '../src/platform/tenant/legacyBootstrapSeam'
  );
  const tenantId = await resolveLegacyBootstrapTenantId('casher-boot-operator-script');
  console.log(`[seed-nov-pro600] tenant=CASHER_BOOT ${tenantId}`);

  const { ensureServicePackagesTables } = await import('../src/lib/migrations/ensureServicePackages');
  const ready = await ensureServicePackagesTables(db);
  if (!ready) throw new Error('Package tables unavailable');

  const { listServicePackages, softDeleteServicePackage, createServicePackage, updateServicePackage } =
    await import('../src/lib/catalog/servicePackages');
  const { isRetailProductClassification } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const { formatPackageCampaignMarker } = await import('../src/lib/catalog/packageCampaignWindow');

  // ---- catalog ----
  const svcRes = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT
        p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
        p.ProType, p.CatID, ISNULL(p.isDeleted, 0) AS isDeleted,
        c.CatName, c.CatType
      FROM dbo.TblPro p
      LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID AND c.TenantId = p.TenantId
      WHERE p.TenantId = @tenantId
      ORDER BY p.ProID
    `);

  type CatalogRow = {
    ProID: number;
    ProName: string;
    ProNameAr: string | null;
    SPrice1: number;
    DurationMinutes: number | null;
    ProType: string | null;
    CatID: number | null;
    CatName: string | null;
    CatType: string | null;
    isDeleted: boolean;
    isProduct: boolean;
  };

  const catalog: CatalogRow[] = (svcRes.recordset as Record<string, unknown>[]).map((row) => {
    const CatType = row.CatType != null ? String(row.CatType) : null;
    const CatName = row.CatName != null ? String(row.CatName) : null;
    const ProType = row.ProType != null ? String(row.ProType) : null;
    return {
      ProID: Number(row.ProID),
      ProName: String(row.ProName ?? ''),
      ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
      SPrice1: Number(row.SPrice1) || 0,
      DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
      ProType,
      CatID: row.CatID != null ? Number(row.CatID) : null,
      CatName,
      CatType,
      isDeleted: Number(row.isDeleted) === 1,
      isProduct: isRetailProductClassification({ ProType, CatType, CatName }),
    };
  });
  const byId = new Map(catalog.map((s) => [s.ProID, s]));

  const catRes = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT CatID, CatName, CatType
      FROM dbo.TblCat
      WHERE TenantId = @tenantId
      ORDER BY CatID
    `);
  const categories = (catRes.recordset as Array<{ CatID: number; CatName: string; CatType: string | null }>).map(
    (r) => ({
      CatID: Number(r.CatID),
      CatName: String(r.CatName ?? ''),
      CatType: r.CatType != null ? String(r.CatType) : null,
    }),
  );

  // ---- ensure Care Mask ----
  type EnsurePlan = {
    spec: EnsureServiceSpec;
    action: 'REUSE' | 'RESTORE' | 'CREATE';
    proId: number | null;
    catId: number | null;
    reason: string;
  };

  const ensurePlans: EnsurePlan[] = [];
  for (const spec of seed.ensureServices) {
    const exact = catalog.find(
      (s) =>
        normalizeName(s.ProName) === normalizeName(spec.nameEn) ||
        normalizeName(s.ProNameAr) === normalizeName(spec.nameAr),
    );
    if (exact && !exact.isDeleted && !exact.isProduct) {
      ensurePlans.push({
        spec,
        action: 'REUSE',
        proId: exact.ProID,
        catId: exact.CatID,
        reason: `existing ProID ${exact.ProID}`,
      });
      continue;
    }
    if (exact && exact.isDeleted && !exact.isProduct) {
      ensurePlans.push({
        spec,
        action: 'RESTORE',
        proId: exact.ProID,
        catId: exact.CatID,
        reason: `soft-deleted ProID ${exact.ProID}`,
      });
      continue;
    }
    const cat =
      categories.find((c) =>
        spec.categoryPreferences.some((pref) => normalizeName(c.CatName) === normalizeName(pref)),
      ) ?? null;
    ensurePlans.push({
      spec,
      action: 'CREATE',
      proId: null,
      catId: cat?.CatID ?? null,
      reason: cat ? `new under CatID ${cat.CatID} (${cat.CatName})` : 'BLOCKED: no matching category',
    });
  }

  console.log(`\n${'='.repeat(60)}\nENSURE SERVICES\n${'='.repeat(60)}`);
  for (const p of ensurePlans) {
    console.log(`  ${p.action.padEnd(8)} ${p.spec.nameEn} — ${p.reason}`);
  }

  const ensureBlocked = ensurePlans.filter((p) => p.action === 'CREATE' && p.catId == null);
  if (ensureBlocked.length) {
    console.error('Cannot ensure services without a category. Aborting.');
    process.exit(2);
  }

  // Resolve ensure ProIDs for dry-run planning (CREATE uses placeholder -1 until apply)
  const ensuredProIdByKey = new Map<string, number>();
  for (const p of ensurePlans) {
    if (p.proId != null) ensuredProIdByKey.set(p.spec.key, p.proId);
  }

  // ---- October disable ----
  const allPkgs = await listServicePackages(db, tenantId);
  console.log(`\n${'='.repeat(60)}\nDISABLE OCTOBER (soft-delete)\n${'='.repeat(60)}`);
  const octoberTargets: number[] = [];
  for (const spec of seed.disablePackages) {
    const marker = SEED_MARKER(spec.key);
    const hits = allPkgs.filter(
      (p) =>
        (p.NotesAr ?? '').includes(marker) ||
        normalizeName(p.NameEn) === normalizeName(spec.nameEn) ||
        normalizeName(p.NameAr ?? '') === normalizeName(spec.nameAr),
    );
    for (const h of hits) {
      octoberTargets.push(h.PackageID);
      console.log(
        `  PackageID ${h.PackageID} "${h.NameEn}" isDeleted=${h.isDeleted ? 1 : 0} → soft-delete for new bookings`,
      );
    }
    if (!hits.length) {
      console.log(`  (no match for ${spec.key} / ${spec.nameEn} — nothing to disable)`);
    }
  }

  // ---- November package plan ----
  console.log(`\n${'='.repeat(60)}\nNOVEMBER PACKAGE\n${'='.repeat(60)}`);
  const plans: Array<{
    pkg: SeedPackage;
    existingId: number | null;
    action: 'insert' | 'update';
    items: Array<{ proId: number; name: string; price: number; duration: number }>;
    ok: boolean;
    individualTotal: number;
    durationSum: number;
  }> = [];

  for (const pkg of seed.packages) {
    const marker = SEED_MARKER(pkg.key);
    const existing =
      allPkgs.find((p) => (p.NotesAr ?? '').includes(marker)) ||
      allPkgs.find(
        (p) =>
          normalizeName(p.NameEn) === normalizeName(pkg.nameEn) ||
          normalizeName(p.NameAr ?? '') === normalizeName(pkg.nameAr),
      ) ||
      null;

    const items: Array<{ proId: number; name: string; price: number; duration: number }> = [];
    let ok = true;
    for (const ref of pkg.includedServices) {
      let matched: CatalogRow | undefined;
      if (ref.proId != null && Number(ref.proId) > 0) {
        matched = byId.get(Number(ref.proId));
      } else if (ref.resolveByExactName) {
        const ensuredId = ensuredProIdByKey.get(ref.key);
        if (ensuredId != null) matched = byId.get(ensuredId);
        if (!matched) {
          matched = catalog.find(
            (s) =>
              !s.isDeleted &&
              !s.isProduct &&
              normalizeName(s.ProName) === normalizeName(ref.preferredName),
          );
        }
        // CREATE path: not in catalog yet — accept planned create
        if (!matched && ensurePlans.some((e) => e.spec.key === ref.key && e.action === 'CREATE')) {
          const ens = seed.ensureServices.find((e) => e.key === ref.key);
          items.push({
            proId: -1,
            name: ref.preferredName,
            price: ens?.preferredPrice ?? 0,
            duration: ens?.preferredDurationMinutes ?? 0,
          });
          console.log(
            `  PENDING CREATE | ${ref.preferredName} | ${ens?.preferredPrice ?? 0} EGP | ${ens?.preferredDurationMinutes ?? '-'} min | role=${ref.role ?? ref.key}`,
          );
          continue;
        }
      }
      if (!matched || matched.isDeleted || matched.isProduct) {
        ok = false;
        console.log(
          `  MISSING ${ref.key} proId=${ref.proId} name=${ref.preferredName}`,
        );
        continue;
      }
      const proType = String(matched.ProType ?? '')
        .trim()
        .toLowerCase();
      if (proType && proType !== 'serv') {
        ok = false;
        console.log(`  WRONG_TYPE ProID ${matched.ProID} ProType=${matched.ProType}`);
        continue;
      }
      items.push({
        proId: matched.ProID,
        name: matched.ProName,
        price: matched.SPrice1,
        duration: matched.DurationMinutes && matched.DurationMinutes > 0 ? matched.DurationMinutes : 0,
      });
      console.log(
        `  OK ProID ${String(matched.ProID).padStart(4)} | ${matched.ProName} | ${matched.SPrice1} EGP | ${matched.DurationMinutes ?? '-'} min | role=${ref.role ?? ref.key}`,
      );
    }

    const individualTotal = items.reduce((s, i) => s + i.price, 0);
    const durationSum = items.reduce((s, i) => s + i.duration, 0);
    console.log(
      `  package=${pkg.nameEn} action=${existing ? 'update' : 'insert'} ` +
        `price=${pkg.price} original≈${individualTotal} duration≈${durationSum} ` +
        `existing=${existing?.PackageID ?? '(new)'} ok=${ok && items.length === pkg.includedServices.length}`,
    );

    plans.push({
      pkg,
      existingId: existing?.PackageID ?? null,
      action: existing ? 'update' : 'insert',
      items,
      ok: ok && items.length === pkg.includedServices.length,
      individualTotal,
      durationSum,
    });
  }

  const blocked = plans.filter((p) => !p.ok);
  if (!apply) {
    console.log(
      `\n[dry-run] No DB writes. packages ready=${plans.filter((p) => p.ok).length}/${plans.length}; ` +
        `october soft-deletes=${octoberTargets.length}; ensure=${ensurePlans.map((e) => e.action).join(',')}`,
    );
    process.exit(blocked.length ? 2 : 0);
  }

  if (blocked.length) {
    console.error('\n[apply] Refusing write — unresolved services remain.');
    process.exit(2);
  }

  console.log('\n[apply] Writing in one transaction...');
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    // Ensure services
    for (const plan of ensurePlans) {
      if (plan.action === 'REUSE') {
        ensuredProIdByKey.set(plan.spec.key, plan.proId!);
        continue;
      }
      if (plan.action === 'RESTORE') {
        await new sql.Request(tx)
          .input('ProID', sql.Int, plan.proId)
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .query(`
            UPDATE dbo.TblPro
            SET isDeleted = 0
            WHERE ProID = @ProID AND TenantId = @tenantId
          `);
        ensuredProIdByKey.set(plan.spec.key, plan.proId!);
        console.log(`  restored Care Mask ProID ${plan.proId}`);
        continue;
      }
      // CREATE
      const ins = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('CatID', sql.Int, plan.catId)
        .input('ProName', sql.NVarChar(200), plan.spec.nameEn)
        .input('ProNameAr', sql.NVarChar(200), plan.spec.nameAr)
        .input('ProType', sql.NVarChar(20), plan.spec.proType ?? 'serv')
        .input('SPrice1', sql.Decimal(10, 2), plan.spec.preferredPrice)
        .input('Bonus', sql.Decimal(10, 2), 0)
        .input('DurationMinutes', sql.Int, plan.spec.preferredDurationMinutes)
        .query(`
          INSERT INTO dbo.TblPro (
            TenantId, CatID, ProName, ProNameAr, ProType, SPrice1, Bonus, DurationMinutes, isDeleted
          )
          VALUES (
            @tenantId, @CatID, @ProName, @ProNameAr, @ProType, @SPrice1, @Bonus, @DurationMinutes, 0
          );
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS ProID;
        `);
      const newId = Number(ins.recordset[0]?.ProID);
      if (!Number.isInteger(newId) || newId <= 0) {
        throw new Error(`Failed to create ${plan.spec.nameEn}`);
      }
      ensuredProIdByKey.set(plan.spec.key, newId);
      console.log(`  created Care Mask ProID ${newId}`);
    }

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }

  // Soft-delete October outside the create TX (idempotent library helper uses its own requests)
  for (const packageId of [...new Set(octoberTargets)]) {
    await softDeleteServicePackage(db, tenantId, packageId);
    console.log(`  soft-deleted October PackageID ${packageId}`);
  }

  // Upsert November packages via catalog helpers (tenant-safe)
  for (const plan of plans) {
    const resolvedItems = plan.pkg.includedServices.map((ref, idx) => {
      let proId = ref.proId != null && Number(ref.proId) > 0 ? Number(ref.proId) : null;
      if (proId == null) {
        proId = ensuredProIdByKey.get(ref.key) ?? null;
      }
      if (proId == null || proId <= 0) {
        throw new Error(`Unresolved ProID for ${ref.key}`);
      }
      return { ProID: proId, Qty: 1, SortOrder: (idx + 1) * 10, IsOptional: false };
    });

    // Refresh prices/durations from DB after ensure
    let individualTotal = 0;
    let durationSum = 0;
    for (const item of resolvedItems) {
      const row = await db
        .request()
        .input('ProID', sql.Int, item.ProID)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`
          SELECT SPrice1, DurationMinutes FROM dbo.TblPro
          WHERE ProID = @ProID AND TenantId = @tenantId
        `);
      const r = row.recordset[0] as { SPrice1: number; DurationMinutes: number | null } | undefined;
      individualTotal += Number(r?.SPrice1) || 0;
      const d = r?.DurationMinutes != null ? Number(r.DurationMinutes) : 0;
      durationSum += d > 0 ? d : 0;
    }

    if (durationSum <= 0) {
      throw new Error(`Package ${plan.pkg.key} has no positive DurationMinutes from included services`);
    }
    const notesAr = buildNotesAr(plan.pkg.key, seed.campaign, formatPackageCampaignMarker);
    const body = {
      NameEn: plan.pkg.nameEn,
      NameAr: plan.pkg.nameAr,
      PackageKind: 'regular' as const,
      PackagePrice: plan.pkg.price,
      OriginalPrice: individualTotal,
      DurationMinutes: durationSum,
      Bonus: 0,
      DescriptionEn: plan.pkg.descriptionEn ?? null,
      DescriptionAr: plan.pkg.descriptionAr ?? null,
      SortOrder: plan.pkg.displayOrder,
      IsPopular: Boolean(plan.pkg.recommended),
      isActive: plan.pkg.active !== false,
      NotesAr: notesAr,
      items: resolvedItems,
    };

    if (plan.existingId) {
      const updated = await updateServicePackage(db, tenantId, plan.existingId, body);
      console.log(
        `  updated PackageID ${plan.existingId} ${plan.pkg.nameEn} price=${plan.pkg.price} ` +
          `original=${individualTotal} duration=${durationSum} items=${resolvedItems.map((i) => i.ProID).join(',')}`,
      );
      if (!updated) throw new Error(`Update failed for PackageID ${plan.existingId}`);
    } else {
      const created = await createServicePackage(db, tenantId, body);
      console.log(
        `  inserted PackageID ${created.PackageID} ${plan.pkg.nameEn} price=${plan.pkg.price} ` +
          `original=${individualTotal} duration=${durationSum} items=${resolvedItems.map((i) => i.ProID).join(',')}`,
      );
    }
  }

  // Verify no duplicates by seed marker
  const after = await listServicePackages(db, tenantId, { kind: 'regular' });
  const novHits = after.filter((p) => (p.NotesAr ?? '').includes(SEED_MARKER('NOV-PRO600')));
  const octActive = after.filter(
    (p) =>
      !p.isDeleted &&
      (normalizeName(p.NameEn) === normalizeName('October Package') ||
        (p.NotesAr ?? '').includes(SEED_MARKER('REGULAR_OCTOBER_2026'))),
  );
  console.log(`\n[verify] NOV-PRO600 rows=${novHits.length} (expect 1)`);
  for (const p of novHits) {
    console.log(
      `  PackageID=${p.PackageID} price=${p.PackagePrice} duration=${p.DurationMinutes} ` +
        `active=${p.isDeleted ? 0 : 1} notes=${p.NotesAr}`,
    );
  }
  console.log(`[verify] October still active for new bookings=${octActive.length} (expect 0)`);
  if (novHits.length !== 1 || octActive.length !== 0) {
    process.exit(2);
  }

  console.log('\n[apply] DONE — website must use the PackageID printed above (not a hardcoded ID).');
}

main().catch((err) => {
  console.error('[seed-nov-pro600] FAILED', err);
  process.exit(1);
});
