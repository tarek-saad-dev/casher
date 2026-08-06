/**
 * Booking Phase 2 — public services catalog loader + bounded cache.
 */
import 'server-only';
import { getPool } from '@/lib/db';
import { ensureTblProImageUrlColumn, tblProImageUrlSelect } from '@/lib/migrations/ensureServiceImageUrl';
import {
  ensureTblCatSortOrderColumn,
  tblCatSortOrderSelect,
} from '@/lib/migrations/ensureCategorySortOrder';
import type { PublicBookingBranchContext } from '@/lib/booking/publicBookingBranchContext';
import {
  PUBLIC_BOOKING_CURRENCY,
  PUBLIC_BOOKING_PRICING_SCOPE,
  PUBLIC_BOOKING_SERVICE_CONTRACT_VERSION,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME_AR,
  UNCATEGORIZED_CATEGORY_NAME_EN,
  categoryKey,
  compareCategories,
  compareServices,
  evaluateServiceEligibility,
  resolveCategoryNames,
  resolvePublicServiceImageUrl,
  resolveServiceDisplayNames,
  sanitizePublicDescription,
  type PublicBookingServiceRow,
} from '@/lib/booking/publicBookingServicePolicy';

export {
  isServiceEligibleForPublicBooking,
  evaluateServiceEligibility,
  resolvePublicCatalogDurationMinutes,
  resolvePublicCatalogPrice,
} from '@/lib/booking/publicBookingServicePolicy';

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 32;
const cacheRootKey = '__pos_public_booking_services_v3';

export type PublicBookingServiceWire = {
  serviceId: number;
  /** Legacy flat-list alias */
  id: number;
  nameAr: string;
  nameEn: string;
  /** Legacy flat-list display name (Arabic-first for booking UI) */
  name: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  price: number;
  durationMinutes: number;
  sortOrder: number;
  bookable: true;
  imageUrl: string | null;
  /** Alias of imageUrl for clients that mirror the barbers wire. */
  photoUrl: string | null;
  categoryId: string;
  /** @deprecated Prefer categoryNameAr — kept for older clients */
  categoryName: string;
  categoryNameAr: string;
  categoryNameEn: string;
};

export type PublicBookingCategoryWire = {
  categoryId: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  services: PublicBookingServiceWire[];
};

export type PublicBookingServicesCatalogResponse = {
  ok: true;
  branch: {
    branchCode: string;
    branchName: string;
  };
  currency: typeof PUBLIC_BOOKING_CURRENCY;
  pricingScope: typeof PUBLIC_BOOKING_PRICING_SCOPE;
  categories: PublicBookingCategoryWire[];
  /** Flat compatibility list (same services, deterministic order). */
  services: PublicBookingServiceWire[];
  /** Legacy groups shape for older clients. */
  groups: Array<{
    categoryId: string;
    categoryName: string;
    categoryNameAr: string;
    categoryNameEn: string;
    services: PublicBookingServiceWire[];
  }>;
  meta: {
    serviceCount: number;
    categoryCount: number;
    generatedAt: string;
    catalogVersion: string;
    contractVersion: string;
    pricingScope: typeof PUBLIC_BOOKING_PRICING_SCOPE;
  };
};

type CacheEntry = {
  expiresAt: number;
  key: string;
  value: PublicBookingServicesCatalogResponse;
};

function getCacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [cacheRootKey]?: Map<string, CacheEntry>;
  };
  if (!g[cacheRootKey]) g[cacheRootKey] = new Map();
  return g[cacheRootKey]!;
}

const STAMP_TTL_MS = 20_000;
const stampRootKey = '__pos_public_booking_services_stamp_v1';

export function invalidatePublicBookingServicesCache(branchCode?: string): void {
  const map = getCacheMap();
  if (!branchCode) {
    map.clear();
  } else {
    const prefix = `${branchCode.toUpperCase()}::`;
    for (const k of map.keys()) {
      if (k.startsWith(prefix)) map.delete(k);
    }
  }
  const g = globalThis as typeof globalThis & {
    [stampRootKey]?: { expiresAt: number; value: string };
  };
  delete g[stampRootKey];
}

async function loadCatalogVersionStamp(): Promise<string> {
  const db = await getPool();
  try {
    const res = await db.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblPro) AS ProCount,
        (SELECT COUNT(*) FROM dbo.TblPro WHERE ISNULL(isDeleted,0)=0) AS ActiveCount,
        (SELECT ISNULL(SUM(ProID),0) FROM dbo.TblPro) AS ProIdSum,
        (SELECT ISNULL(SUM(CAST(ISNULL(SPrice1,0) AS BIGINT)),0) FROM dbo.TblPro) AS PriceSum,
        (SELECT ISNULL(SUM(CAST(ISNULL(DurationMinutes,0) AS BIGINT)),0) FROM dbo.TblPro) AS DurSum,
        (SELECT ISNULL(SUM(CAST(ISNULL(CatID,0) AS BIGINT)),0) FROM dbo.TblPro) AS CatSum,
        (SELECT ISNULL(SUM(CAST(ISNULL(SortOrder,0) AS BIGINT)),0) FROM dbo.TblCat) AS CatSortSum
    `);
    const r = res.recordset[0] ?? {};
    return [
      r.ProCount,
      r.ActiveCount,
      r.ProIdSum,
      r.PriceSum,
      r.DurSum,
      r.CatSum,
      r.CatSortSum,
      PUBLIC_BOOKING_SERVICE_CONTRACT_VERSION,
      PUBLIC_BOOKING_PRICING_SCOPE,
    ].join('|');
  } catch {
    return `fallback|${Date.now()}|${PUBLIC_BOOKING_SERVICE_CONTRACT_VERSION}`;
  }
}

async function loadCatalogVersionStampCached(): Promise<string> {
  const g = globalThis as typeof globalThis & {
    [stampRootKey]?: { expiresAt: number; value: string };
  };
  const hit = g[stampRootKey];
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loadCatalogVersionStamp();
  g[stampRootKey] = { expiresAt: Date.now() + STAMP_TTL_MS, value };
  return value;
}

function branchContextVersion(ctx: PublicBookingBranchContext): string {
  return [
    ctx.branchCode,
    ctx.publicBookingEnabled ? '1' : '0',
    ctx.bookingEnabled ? '1' : '0',
    ctx.branchName,
  ].join('|');
}

function cacheKeyFor(
  branchCode: string,
  branchVersion: string,
  catalogVersion: string,
): string {
  return [
    branchCode.toUpperCase(),
    branchVersion,
    catalogVersion,
    PUBLIC_BOOKING_PRICING_SCOPE,
    PUBLIC_BOOKING_SERVICE_CONTRACT_VERSION,
  ].join('::');
}

async function loadRawServiceRows(): Promise<PublicBookingServiceRow[]> {
  const db = await getPool();
  const hasImageUrl = await ensureTblProImageUrlColumn(db);
  const hasSortOrder = await ensureTblCatSortOrderColumn(db);
  const imageUrlCol = tblProImageUrlSelect(hasImageUrl);
  const sortOrderCol = tblCatSortOrderSelect(hasSortOrder);

  const result = await db.request().query(`
    SELECT
      p.ProID,
      p.ProName,
      p.ProNameAr,
      p.SPrice1,
      p.DurationMinutes,
      ISNULL(p.isDeleted, 0) AS isDeleted,
      ISNULL(p.ProType, N'') AS ProType,
      p.CatID,
      c.CatName,
      c.CatType,
      ${sortOrderCol},
      ${imageUrlCol}
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY ISNULL(SortOrder, 999999), ISNULL(c.CatName, N''), p.ProID
  `);

  return result.recordset as PublicBookingServiceRow[];
}

function toWireService(
  row: PublicBookingServiceRow,
  price: number,
  durationMinutes: number,
  catId: string,
  categoryNameAr: string,
  categoryNameEn: string,
  sortOrder: number,
): PublicBookingServiceWire {
  const { nameAr, nameEn } = resolveServiceDisplayNames(row.ProName, row.ProNameAr);
  const imageUrl = resolvePublicServiceImageUrl({
    imageUrl: row.ImageUrl,
    proName: row.ProName,
    proNameAr: row.ProNameAr,
    nameEn,
    nameAr,
  });
  return {
    serviceId: Number(row.ProID),
    id: Number(row.ProID),
    nameAr,
    nameEn,
    name: nameAr || nameEn,
    descriptionAr: sanitizePublicDescription(row.DescriptionAr),
    descriptionEn: sanitizePublicDescription(row.DescriptionEn),
    price,
    durationMinutes,
    sortOrder,
    bookable: true,
    imageUrl,
    photoUrl: imageUrl,
    categoryId: catId,
    categoryName: categoryNameAr,
    categoryNameAr,
    categoryNameEn,
  };
}

/**
 * Pure assembly — exported for unit tests.
 */
export function buildPublicServicesCatalog(
  rows: PublicBookingServiceRow[],
  ctx: Pick<PublicBookingBranchContext, 'branchCode' | 'branchName'>,
  catalogVersion: string,
  generatedAt = new Date().toISOString(),
): PublicBookingServicesCatalogResponse {
  const seen = new Set<number>();
  const catMap = new Map<
    string,
    {
      categoryId: string;
      nameAr: string;
      nameEn: string;
      sortOrder: number;
      services: PublicBookingServiceWire[];
    }
  >();

  for (const row of rows) {
    const evalResult = evaluateServiceEligibility(row);
    if (!evalResult.eligible || evalResult.price == null || evalResult.durationMinutes == null) {
      continue;
    }
    const serviceId = Number(row.ProID);
    if (!Number.isFinite(serviceId) || seen.has(serviceId)) continue;
    seen.add(serviceId);

    const catId = categoryKey(row.CatID);
    const isUncategorized = catId === UNCATEGORIZED_CATEGORY_ID;
    const names = isUncategorized
      ? { nameAr: UNCATEGORIZED_CATEGORY_NAME_AR, nameEn: UNCATEGORIZED_CATEGORY_NAME_EN }
      : resolveCategoryNames(row.CatName);
    const catSort = isUncategorized
      ? 999999
      : Number.isFinite(Number(row.SortOrder))
        ? Number(row.SortOrder)
        : 999;

    if (!catMap.has(catId)) {
      catMap.set(catId, {
        categoryId: catId,
        nameAr: names.nameAr,
        nameEn: names.nameEn,
        sortOrder: catSort,
        services: [],
      });
    }

    const serviceSort = 0; // no persisted service SortOrder — name then ProID
    const wire = toWireService(
      row,
      evalResult.price,
      evalResult.durationMinutes,
      catId,
      names.nameAr,
      names.nameEn,
      serviceSort,
    );
    catMap.get(catId)!.services.push(wire);
  }

  const categories = Array.from(catMap.values())
    .map((cat) => {
      const services = [...cat.services].sort((a, b) =>
        compareServices(
          { sortOrder: a.sortOrder, nameAr: a.nameAr, serviceId: a.serviceId },
          { sortOrder: b.sortOrder, nameAr: b.nameAr, serviceId: b.serviceId },
        ),
      );
      const ranked = services.map((s, idx) => ({ ...s, sortOrder: idx + 1 }));
      return { ...cat, services: ranked };
    })
    .filter((c) => c.services.length > 0)
    .sort((a, b) =>
      compareCategories(
        { sortOrder: a.sortOrder, nameAr: a.nameAr, categoryId: a.categoryId },
        { sortOrder: b.sortOrder, nameAr: b.nameAr, categoryId: b.categoryId },
      ),
    );

  const services = categories.flatMap((c) => c.services);
  const groups = categories.map((c) => ({
    categoryId: c.categoryId,
    categoryName: c.nameAr,
    categoryNameAr: c.nameAr,
    categoryNameEn: c.nameEn,
    services: c.services,
  }));

  return {
    ok: true,
    branch: {
      branchCode: ctx.branchCode,
      branchName: ctx.branchName,
    },
    currency: PUBLIC_BOOKING_CURRENCY,
    pricingScope: PUBLIC_BOOKING_PRICING_SCOPE,
    categories,
    services,
    groups,
    meta: {
      serviceCount: services.length,
      categoryCount: categories.length,
      generatedAt,
      catalogVersion,
      contractVersion: PUBLIC_BOOKING_SERVICE_CONTRACT_VERSION,
      pricingScope: PUBLIC_BOOKING_PRICING_SCOPE,
    },
  };
}

export async function getPublicBookingServicesCatalog(
  ctx: PublicBookingBranchContext,
): Promise<PublicBookingServicesCatalogResponse> {
  const branchVersion = branchContextVersion(ctx);
  const map = getCacheMap();
  // Soft hit: any fresh catalog for this branch+branchVersion avoids a stamp round-trip.
  const branchPrefix = `${ctx.branchCode.toUpperCase()}::${branchVersion}::`;
  for (const [k, hit] of map) {
    if (k.startsWith(branchPrefix) && hit.expiresAt > Date.now()) {
      return hit.value;
    }
  }

  const catalogVersion = await loadCatalogVersionStampCached();
  const key = cacheKeyFor(ctx.branchCode, branchVersion, catalogVersion);
  const hit = map.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  const rows = await loadRawServiceRows();
  const value = buildPublicServicesCatalog(rows, ctx, catalogVersion);

  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, key, value });
  return value;
}
