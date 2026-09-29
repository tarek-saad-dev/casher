/**
 * Seed CUT Salon regular customer packages from cut-salon-regular-packages.json
 * into dbo.TblServicePackage + dbo.TblServicePackageItem.
 *
 * Idempotent: match existing regular packages by NotesAr seed marker
 * `[seed:REGULAR_KEY]` or exact NameEn/NameAr under PackageKind=regular.
 *
 * Package items resolve by confirmed ProID, or by exact preferredName when
 * resolveByExactName is set (new services from ensure-regular-package-services).
 *
 * Does NOT modify groom packages.
 *
 * Usage:
 *   npm run seed:regular-packages
 *   npm run seed:regular-packages:apply
 *   npx tsx scripts/seed-regular-packages.ts --dry-run [--local|--cloud]
 *   npx tsx scripts/seed-regular-packages.ts --apply [--local|--cloud]
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
const DEFAULT_SEED_PATH = path.join(ROOT, 'cut-salon-regular-packages.json');
const SEED_MARKER = (key: string) => `[seed:${key}]`;

interface SeedServiceRef {
  key: string;
  preferredName: string;
  proId: number | null;
  expectedPrice?: number;
  resolveByExactName?: boolean;
}

interface SeedPackage {
  key: string;
  nameEn: string;
  nameAr: string;
  price: number;
  originalPrice: number;
  expectedIndividualTotal?: number;
  displayOrder: number;
  recommended?: boolean;
  active?: boolean;
  descriptionEn?: string;
  descriptionAr?: string;
  includedServices: SeedServiceRef[];
}

interface SeedFile {
  packages: SeedPackage[];
}

interface CatalogService {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  DurationMinutes: number | null;
  CatName: string | null;
  CatType: string | null;
  ProType: string | null;
  isDeleted: boolean;
  isProduct: boolean;
}

type MatchStatus =
  | 'MATCHED'
  | 'MISSING'
  | 'DELETED'
  | 'WRONG_TYPE'
  | 'PRODUCT_REJECTED'
  | 'INVALID_REF';

interface ServiceMatch {
  ref: SeedServiceRef;
  status: MatchStatus;
  service?: CatalogService;
  reason?: string;
}

interface PackagePlan {
  pkg: SeedPackage;
  existingPackageId: number | null;
  action: 'insert' | 'update';
  matches: ServiceMatch[];
  ok: boolean;
  individualTotal: number;
  packagePrice: number;
  originalPrice: number;
  durationSum: number;
  expectedItemCount: number;
}

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
      /* missing ok */
    }
  }
}

function parseArgs(argv: string[]): {
  apply: boolean;
  seedPath: string;
  dbTarget: 'cloud' | 'local';
} {
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
  const cls = String(process.env.HAWAI_DB_CLASS || '').trim().toLowerCase();
  if (cls === 'local' || cls === 'isolated' || cls === 'test' || cls === 'dev') {
    dbTarget = 'local';
  }
  if (argv.includes('--local')) dbTarget = 'local';
  if (argv.includes('--cloud')) dbTarget = 'cloud';
  return { apply, seedPath, dbTarget };
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
  for (const pkg of raw.packages) {
    for (const svc of pkg.includedServices) {
      if (svc.resolveByExactName) {
        if (!svc.preferredName?.trim()) {
          throw new Error(`${pkg.key}: ${svc.key} resolveByExactName requires preferredName`);
        }
        continue;
      }
      if (!Number.isFinite(Number(svc.proId)) || Number(svc.proId) <= 0) {
        throw new Error(`${pkg.key}: included service ${svc.key} missing valid proId`);
      }
      svc.proId = Number(svc.proId);
    }
  }
  return raw;
}

function resolveService(
  ref: SeedServiceRef,
  byId: Map<number, CatalogService>,
  byExactName: Map<string, CatalogService[]>,
): ServiceMatch {
  if (ref.resolveByExactName) {
    const hits = byExactName.get(normalizeName(ref.preferredName)) ?? [];
    const active = hits.filter((s) => !s.isDeleted && !s.isProduct);
    if (active.length === 0) {
      return {
        ref,
        status: 'MISSING',
        reason: `exact name "${ref.preferredName}" not found — run ensure-regular-package-services --apply first`,
      };
    }
    if (active.length > 1) {
      return {
        ref,
        status: 'INVALID_REF',
        reason: `ambiguous exact name "${ref.preferredName}" count=${active.length}`,
      };
    }
    return validateMatched(ref, active[0]);
  }

  const proId = Number(ref.proId);
  if (!Number.isFinite(proId) || proId <= 0) {
    return { ref, status: 'INVALID_REF', reason: 'proId missing or invalid' };
  }
  const service = byId.get(proId);
  if (!service) {
    return { ref, status: 'MISSING', reason: `ProID ${proId} not found in catalog` };
  }
  return validateMatched(ref, service);
}

function validateMatched(ref: SeedServiceRef, service: CatalogService): ServiceMatch {
  if (service.isDeleted) {
    return {
      ref,
      status: 'DELETED',
      service,
      reason: `ProID ${service.ProID} is soft-deleted`,
    };
  }
  if (service.isProduct) {
    return {
      ref,
      status: 'PRODUCT_REJECTED',
      service,
      reason: `ProID ${service.ProID} is a retail/internal product — refused`,
    };
  }
  const proType = String(service.ProType ?? '')
    .trim()
    .toLowerCase();
  const isSalonService = proType === '' || proType === 'serv';
  if (!isSalonService) {
    return {
      ref,
      status: 'WRONG_TYPE',
      service,
      reason: `ProID ${service.ProID} ProType=${service.ProType ?? 'null'} (expected serv or legacy null)`,
    };
  }
  return { ref, status: 'MATCHED', service };
}

function buildNotesAr(pkg: SeedPackage): string {
  const parts = [SEED_MARKER(pkg.key), 'regular customer package'];
  const joined = parts.join(' | ');
  return joined.length > 500 ? joined.slice(0, 497) + '...' : joined;
}

function printPackagePlan(plan: PackagePlan): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${plan.pkg.nameEn}  [${plan.pkg.key}]`);
  console.log(`${'='.repeat(60)}`);
  console.log(
    `Existing PackageID: ${plan.existingPackageId ?? '(new)'} | action=${plan.action} | ` +
      `price=${plan.packagePrice} | original=${plan.originalPrice} | order=${plan.pkg.displayOrder} | popular=${Boolean(plan.pkg.recommended)}`,
  );
  console.log(`Expected package item count: ${plan.expectedItemCount}`);
  console.log(`DurationMinutes (sum): ${plan.durationSum}`);
  for (const m of plan.matches) {
    if (m.service) {
      const s = m.service;
      const tag = m.status === 'MATCHED' ? 'OK' : m.status;
      console.log(
        `  ${tag.padEnd(16)} ProID ${String(s.ProID).padStart(4)} | ` +
          `"${s.ProName}"` +
          (s.ProNameAr ? ` / ${s.ProNameAr}` : '') +
          ` | price=${s.SPrice1}` +
          ` | dur=${s.DurationMinutes ?? 'null'}` +
          (m.reason ? ` | ${m.reason}` : ''),
      );
    } else {
      console.log(
        `  ${m.status.padEnd(16)} ${m.ref.preferredName} — ${m.reason}`,
      );
    }
  }
  console.log(`Individual total: ${plan.individualTotal.toLocaleString('en-EG')} EGP`);
  console.log(`Package price:    ${plan.packagePrice.toLocaleString('en-EG')} EGP`);
  console.log(`Original price:   ${plan.originalPrice.toLocaleString('en-EG')} EGP`);
  if (
    plan.pkg.expectedIndividualTotal != null &&
    plan.individualTotal !== plan.pkg.expectedIndividualTotal
  ) {
    console.log(
      `  NOTE: individual total ${plan.individualTotal} differs from expected ${plan.pkg.expectedIndividualTotal}`,
    );
  }
  console.log(plan.ok ? 'STATUS: READY' : 'STATUS: BLOCKED');
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { apply, seedPath, dbTarget } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'APPLY' : 'DRY-RUN';

  if (dbTarget === 'cloud') {
    delete process.env.HAWAI_DB_CLASS;
    delete process.env.BOOKING_V2_DB_CLASS;
    delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  }

  console.log(`[seed-regular-packages] mode=${mode} db=${dbTarget}`);
  console.log(`[seed-regular-packages] seed=${seedPath}`);

  const seed = loadSeedFile(seedPath);

  const { getPool, setDbTarget, sql } = await import('../src/lib/db');
  await setDbTarget(dbTarget);
  const { ensureServicePackagesTables } = await import('../src/lib/migrations/ensureServicePackages');
  const { getServicePackageById, listServicePackages } = await import(
    '../src/lib/catalog/servicePackages'
  );
  const { isRetailProductClassification } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );

  const db = await getPool();
  const ready = await ensureServicePackagesTables(db);
  if (!ready) throw new Error('Package tables unavailable');

  const svcRes = await db.request().query(`
    SELECT
      p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
      p.ProType, ISNULL(p.isDeleted, 0) AS isDeleted,
      c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY p.ProID
  `);

  const catalog: CatalogService[] = (svcRes.recordset as Record<string, unknown>[]).map((row) => {
    const CatType = row.CatType != null ? String(row.CatType) : null;
    const CatName = row.CatName != null ? String(row.CatName) : null;
    const ProType = row.ProType != null ? String(row.ProType) : null;
    return {
      ProID: Number(row.ProID),
      ProName: String(row.ProName ?? ''),
      ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
      SPrice1: Number(row.SPrice1) || 0,
      DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
      CatName,
      CatType,
      ProType,
      isDeleted: Number(row.isDeleted) === 1,
      isProduct: isRetailProductClassification({ ProType, CatType, CatName }),
    };
  });
  const byId = new Map(catalog.map((s) => [s.ProID, s]));
  const byExactName = new Map<string, CatalogService[]>();
  for (const s of catalog) {
    const k = normalizeName(s.ProName);
    if (!k) continue;
    const list = byExactName.get(k) ?? [];
    list.push(s);
    byExactName.set(k, list);
  }

  const existingPkgs = await listServicePackages(db, { kind: 'regular' });
  const groomBefore = await listServicePackages(db, { kind: 'groom' });
  const groomFingerprint = groomBefore
    .map(
      (p) =>
        `${p.PackageID}:${p.NameEn}:${p.PackagePrice}:${p.IsPopular ? 1 : 0}:${p.isDeleted ? 1 : 0}:${p.ItemCount ?? 0}`,
    )
    .sort()
    .join('|');

  const plans: PackagePlan[] = [];

  for (const pkg of seed.packages) {
    const marker = SEED_MARKER(pkg.key);
    const existing =
      existingPkgs.find((p) => (p.NotesAr ?? '').includes(marker)) ||
      existingPkgs.find(
        (p) =>
          normalizeName(p.NameEn) === normalizeName(pkg.nameEn) ||
          normalizeName(p.NameAr) === normalizeName(pkg.nameAr),
      ) ||
      null;

    const matches = pkg.includedServices.map((ref) => resolveService(ref, byId, byExactName));

    const seen = new Set<number>();
    let hasDup = false;
    for (const m of matches) {
      const id = m.service?.ProID ?? m.ref.proId;
      if (id != null && Number(id) > 0) {
        if (seen.has(Number(id))) {
          hasDup = true;
          console.error(`DUPLICATE ProID ${id} inside ${pkg.key}`);
        }
        seen.add(Number(id));
      }
    }

    const ok = matches.every((m) => m.status === 'MATCHED') && !hasDup;
    const individualTotal = matches.reduce((sum, m) => sum + (m.service?.SPrice1 ?? 0), 0);
    const durationSum = matches.reduce(
      (sum, m) => sum + (m.service?.DurationMinutes ?? 0),
      0,
    );
    plans.push({
      pkg,
      existingPackageId: existing?.PackageID ?? null,
      action: existing ? 'update' : 'insert',
      matches,
      ok,
      individualTotal,
      packagePrice: Number(pkg.price),
      originalPrice: Number(pkg.originalPrice),
      durationSum,
      expectedItemCount: pkg.includedServices.length,
    });
  }

  for (const plan of plans) printPackagePlan(plan);

  const blocked = plans.filter((p) => !p.ok);
  if (blocked.length) {
    console.log(`\nBLOCKED packages (${blocked.length}):`);
    for (const p of blocked) {
      const bad = p.matches.filter((m) => m.status !== 'MATCHED');
      console.log(
        `  ${p.pkg.key}: ${bad.map((b) => `${b.ref.key}=${b.status}`).join(', ') || 'duplicate items'}`,
      );
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('TOTALS CHECK');
  console.log(`${'='.repeat(60)}`);
  for (const plan of plans) {
    const expected = plan.pkg.expectedIndividualTotal;
    const totalsOk =
      expected == null || plan.individualTotal === expected
        ? 'OK'
        : `MISMATCH expectedIndividual=${expected}`;
    const savings = plan.originalPrice - plan.packagePrice;
    const discountPct =
      plan.originalPrice > 0 ? ((savings / plan.originalPrice) * 100).toFixed(2) : 'n/a';
    console.log(
      `  ${plan.pkg.key}: items=${plan.matches.filter((m) => m.status === 'MATCHED').length}/${plan.expectedItemCount} ` +
        `individual=${plan.individualTotal} package=${plan.packagePrice} original=${plan.originalPrice} ` +
        `savings=${savings} discount=${discountPct}% dur=${plan.durationSum} ${totalsOk}`,
    );
  }

  if (!apply) {
    console.log(
      `\n[dry-run] No DB writes. ready=${plans.filter((p) => p.ok).length}/${plans.length}. Re-run with --apply after zero blockers.`,
    );
    process.exit(blocked.length ? 2 : 0);
  }

  if (blocked.length) {
    console.error('\n[apply] Refusing write — unresolved/invalid services remain.');
    process.exit(2);
  }

  console.log('\n[apply] Writing regular packages in one transaction...');
  const results: Array<{ key: string; action: 'inserted' | 'updated'; packageId: number }> = [];

  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    for (const plan of plans) {
      const items = plan.matches.map((m, i) => ({
        ProID: m.service!.ProID,
        Qty: 1,
        SortOrder: (i + 1) * 10,
        IsOptional: false,
      }));
      const notesAr = buildNotesAr(plan.pkg);
      const originalPrice = plan.originalPrice;
      const durationMinutes = plan.durationSum > 0 ? plan.durationSum : null;

      let packageId = plan.existingPackageId;

      if (packageId) {
        const upd = await new sql.Request(tx)
          .input('PackageID', sql.Int, packageId)
          .input('NameEn', sql.NVarChar(200), plan.pkg.nameEn)
          .input('NameAr', sql.NVarChar(200), plan.pkg.nameAr)
          .input('PackageKind', sql.NVarChar(20), 'regular')
          .input('PackagePrice', sql.Decimal(10, 2), plan.packagePrice)
          .input('OriginalPrice', sql.Decimal(10, 2), originalPrice)
          .input('DurationMinutes', sql.Int, durationMinutes)
          .input('Bonus', sql.Decimal(10, 2), 0)
          .input('ImageUrl', sql.NVarChar(1000), null)
          .input('DescriptionAr', sql.NVarChar(500), plan.pkg.descriptionAr ?? null)
          .input('DescriptionEn', sql.NVarChar(500), plan.pkg.descriptionEn ?? null)
          .input('SortOrder', sql.Int, plan.pkg.displayOrder)
          .input('IsPopular', sql.Bit, plan.pkg.recommended ? 1 : 0)
          .input('isDeleted', sql.Bit, plan.pkg.active === false ? 1 : 0)
          .input('DepositAmount', sql.Decimal(10, 2), null)
          .input('IncludesTrial', sql.Bit, 0)
          .input('SessionCount', sql.Int, null)
          .input('NotesAr', sql.NVarChar(500), notesAr)
          .query(`
            UPDATE dbo.TblServicePackage
            SET
              NameEn = @NameEn,
              NameAr = @NameAr,
              PackageKind = @PackageKind,
              PackagePrice = @PackagePrice,
              OriginalPrice = @OriginalPrice,
              DurationMinutes = @DurationMinutes,
              Bonus = @Bonus,
              ImageUrl = @ImageUrl,
              DescriptionAr = @DescriptionAr,
              DescriptionEn = @DescriptionEn,
              SortOrder = @SortOrder,
              IsPopular = @IsPopular,
              isDeleted = @isDeleted,
              DepositAmount = @DepositAmount,
              IncludesTrial = @IncludesTrial,
              SessionCount = @SessionCount,
              NotesAr = @NotesAr,
              UpdatedAt = SYSDATETIME()
            WHERE PackageID = @PackageID AND PackageKind = N'regular';
            SELECT @@ROWCOUNT AS affected;
          `);
        if (Number(upd.recordset[0]?.affected) === 0) {
          throw new Error(`Failed to update package ${plan.pkg.key} PackageID=${packageId}`);
        }
      } else {
        const ins = await new sql.Request(tx)
          .input('NameEn', sql.NVarChar(200), plan.pkg.nameEn)
          .input('NameAr', sql.NVarChar(200), plan.pkg.nameAr)
          .input('PackageKind', sql.NVarChar(20), 'regular')
          .input('PackagePrice', sql.Decimal(10, 2), plan.packagePrice)
          .input('OriginalPrice', sql.Decimal(10, 2), originalPrice)
          .input('DurationMinutes', sql.Int, durationMinutes)
          .input('Bonus', sql.Decimal(10, 2), 0)
          .input('ImageUrl', sql.NVarChar(1000), null)
          .input('DescriptionAr', sql.NVarChar(500), plan.pkg.descriptionAr ?? null)
          .input('DescriptionEn', sql.NVarChar(500), plan.pkg.descriptionEn ?? null)
          .input('SortOrder', sql.Int, plan.pkg.displayOrder)
          .input('IsPopular', sql.Bit, plan.pkg.recommended ? 1 : 0)
          .input('isDeleted', sql.Bit, plan.pkg.active === false ? 1 : 0)
          .input('DepositAmount', sql.Decimal(10, 2), null)
          .input('IncludesTrial', sql.Bit, 0)
          .input('SessionCount', sql.Int, null)
          .input('NotesAr', sql.NVarChar(500), notesAr)
          .query(`
            INSERT INTO dbo.TblServicePackage (
              NameEn, NameAr, PackageKind, PackagePrice, OriginalPrice, DurationMinutes,
              Bonus, ImageUrl, DescriptionAr, DescriptionEn, SortOrder, IsPopular, isDeleted,
              DepositAmount, IncludesTrial, SessionCount, NotesAr
            )
            VALUES (
              @NameEn, @NameAr, @PackageKind, @PackagePrice, @OriginalPrice, @DurationMinutes,
              @Bonus, @ImageUrl, @DescriptionAr, @DescriptionEn, @SortOrder, @IsPopular, @isDeleted,
              @DepositAmount, @IncludesTrial, @SessionCount, @NotesAr
            );
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS PackageID;
          `);
        packageId = Number(ins.recordset[0].PackageID);
      }

      // Sync required items only — do not touch unrelated packages.
      await new sql.Request(tx)
        .input('PackageID', sql.Int, packageId)
        .query(`
          DELETE FROM dbo.TblServicePackageItem
          WHERE PackageID = @PackageID AND IsOptional = 0
        `);

      for (const item of items) {
        await new sql.Request(tx)
          .input('PackageID', sql.Int, packageId!)
          .input('ProID', sql.Int, item.ProID)
          .input('Qty', sql.Decimal(10, 2), item.Qty)
          .input('SortOrder', sql.Int, item.SortOrder)
          .input('IsOptional', sql.Bit, 0)
          .query(`
            IF NOT EXISTS (
              SELECT 1 FROM dbo.TblServicePackageItem
              WHERE PackageID = @PackageID AND ProID = @ProID
            )
            INSERT INTO dbo.TblServicePackageItem (PackageID, ProID, Qty, SortOrder, IsOptional)
            VALUES (@PackageID, @ProID, @Qty, @SortOrder, @IsOptional)
            ELSE
            UPDATE dbo.TblServicePackageItem
            SET Qty = @Qty, SortOrder = @SortOrder, IsOptional = @IsOptional
            WHERE PackageID = @PackageID AND ProID = @ProID
          `);
      }

      // Remove optional leftovers for these regular packages (should be none).
      await new sql.Request(tx)
        .input('PackageID', sql.Int, packageId)
        .query(`
          DELETE FROM dbo.TblServicePackageItem
          WHERE PackageID = @PackageID AND IsOptional = 1
        `);

      const action = plan.existingPackageId ? 'updated' : 'inserted';
      results.push({ key: plan.pkg.key, action, packageId: packageId! });
      console.log(`  ${action} PackageID=${packageId} ${plan.pkg.key} items=${items.length}`);
    }

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    console.error('[apply] FAILED — transaction rolled back:', err);
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('VERIFICATION');
  console.log(`${'='.repeat(60)}`);
  const regular = await listServicePackages(db, { kind: 'regular', activeOnly: true });
  const seeded = regular.filter((p) =>
    seed.packages.some(
      (s) =>
        (p.NotesAr ?? '').includes(SEED_MARKER(s.key)) ||
        normalizeName(p.NameEn) === normalizeName(s.nameEn),
    ),
  );
  console.log(`Active regular packages (seeded set): ${seeded.length}`);

  let verifyOk = seeded.length === seed.packages.length;
  for (const plan of plans) {
    const result = results.find((r) => r.key === plan.pkg.key)!;
    const full = await getServicePackageById(db, result.packageId);
    const required = (full?.items ?? []).filter((i) => !i.IsOptional);
    const optional = (full?.items ?? []).filter((i) => i.IsOptional);
    const itemIds = required.map((i) => i.ProID);
    const unique = new Set(itemIds);
    const expectedIds = plan.matches.map((m) => m.service!.ProID);
    const sameSet =
      itemIds.length === expectedIds.length &&
      expectedIds.every((id) => itemIds.includes(id)) &&
      itemIds.length === unique.size;
    const savings =
      full?.OriginalPrice != null ? Number(full.OriginalPrice) - Number(full.PackagePrice) : null;

    console.log(
      `  PackageID=${result.packageId} | ${plan.pkg.nameEn} | price=${full?.PackagePrice} | ` +
        `original=${full?.OriginalPrice} | savings=${savings} | popular=${full?.IsPopular ? 1 : 0} | ` +
        `sort=${full?.SortOrder} | dur=${full?.DurationMinutes} | ` +
        `items=${itemIds.length} optional=${optional.length} | ${itemIds.join(',')}`,
    );

    if (full?.PackageKind !== 'regular') {
      console.log('    FAIL: PackageKind != regular');
      verifyOk = false;
    }
    if (!sameSet) {
      console.log(`    FAIL: items mismatch. expected=${expectedIds.join(',')}`);
      verifyOk = false;
    }
    if (Number(full?.PackagePrice) !== plan.packagePrice) {
      console.log(`    FAIL: price ${full?.PackagePrice} != ${plan.packagePrice}`);
      verifyOk = false;
    }
    if (Number(full?.OriginalPrice) !== plan.originalPrice) {
      console.log(`    FAIL: original ${full?.OriginalPrice} != ${plan.originalPrice}`);
      verifyOk = false;
    }
    if (Boolean(full?.IsPopular) !== Boolean(plan.pkg.recommended)) {
      console.log('    FAIL: IsPopular mismatch');
      verifyOk = false;
    }
    if (Number(full?.DurationMinutes) !== plan.durationSum) {
      console.log(`    FAIL: duration ${full?.DurationMinutes} != ${plan.durationSum}`);
      verifyOk = false;
    }
    if (optional.length > 0) {
      console.log('    FAIL: unexpected optional items');
      verifyOk = false;
    }
    if (itemIds.length !== unique.size) {
      console.log('    FAIL: duplicate package-service relations');
      verifyOk = false;
    }
  }

  const nameCounts = new Map<string, number>();
  for (const p of regular) {
    const k = normalizeName(p.NameEn);
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1 && seed.packages.some((s) => normalizeName(s.nameEn) === name)) {
      console.log(`FAIL: duplicate active regular package name "${name}" count=${count}`);
      verifyOk = false;
    }
  }

  const groomAfter = await listServicePackages(db, { kind: 'groom' });
  const groomFingerprintAfter = groomAfter
    .map(
      (p) =>
        `${p.PackageID}:${p.NameEn}:${p.PackagePrice}:${p.IsPopular ? 1 : 0}:${p.isDeleted ? 1 : 0}:${p.ItemCount ?? 0}`,
    )
    .sort()
    .join('|');
  if (groomFingerprint !== groomFingerprintAfter) {
    console.log('FAIL: groom packages changed');
    verifyOk = false;
  } else {
    console.log('PASS: groom packages unchanged');
  }

  console.log('\nRESULTS:');
  for (const r of results) {
    console.log(`  ${r.key}: ${r.action} PackageID=${r.packageId}`);
  }

  if (!verifyOk) {
    console.error('\nFAIL — verification did not match approved definitions.');
    process.exit(1);
  }
  console.log('\nPASS — regular packages seeded/updated.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
