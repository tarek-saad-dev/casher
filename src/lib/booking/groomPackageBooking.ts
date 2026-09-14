/**
 * Groom package booking resolution — separate from generic public catalog booking.
 *
 * Package path validates against TblServicePackage / TblServicePackageItem,
 * not Phase-2 public bookable catalog membership.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ResolvedBookingServiceLine } from '@/lib/booking/bookingServiceDuration';
import {
  hasConflictingHomeVisitProIds,
  resolveGroomOptionalGroup,
} from '@/lib/catalog/groomOptionalAddons';
import { isRetailProductClassification } from '@/lib/booking/publicBookingServicePolicy';
import { parsePublicServiceIdsParam } from '@/lib/booking/publicBookingBarberPolicy';

export type GroomPackageBookingErrorCode =
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_NOT_ACTIVE'
  | 'PACKAGE_NOT_GROOM'
  | 'PACKAGE_EMPTY'
  | 'PACKAGE_SERVICE_INVALID'
  | 'PACKAGE_ADDON_INVALID'
  | 'PACKAGE_ADDON_NOT_OPTIONAL'
  | 'PACKAGE_ADDON_ALREADY_INCLUDED'
  | 'HOME_VISIT_EXCLUSIVE'
  | 'INVALID_PACKAGE_ID'
  | 'INVALID_ADDON_IDS'
  | 'PACKAGE_DURATION_MISSING';

export class GroomPackageBookingError extends Error {
  readonly code: GroomPackageBookingErrorCode;
  readonly metadata: Record<string, unknown>;
  constructor(code: GroomPackageBookingErrorCode, metadata: Record<string, unknown> = {}) {
    super(code);
    this.name = 'GroomPackageBookingError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type ResolvedGroomPackageBooking = {
  packageId: number;
  nameEn: string;
  nameAr: string;
  packagePrice: number;
  packageDurationMinutes: number;
  requiredServiceIds: number[];
  addonProIds: number[];
  /** Required + addon lines for schedule / BookingServices persistence */
  services: ResolvedBookingServiceLine[];
  serviceIds: number[];
  addonLines: ResolvedBookingServiceLine[];
  addonTotal: number;
  /** PackagePrice + addonTotal — NOT sum of required list prices */
  totalPrice: number;
  /** packageDuration + defined addon durations only */
  totalDurationMinutes: number;
  clientServiceIdsMismatch: boolean;
  /** Structured note fragment for Bookings.Notes */
  metadataNote: string;
};

type ProRow = {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  DurationMinutes: number | null;
  ProType: string | null;
  CatName: string | null;
  CatType: string | null;
  isDeleted: boolean;
};

function parseIdList(raw: unknown): number[] {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    const parsed = parsePublicServiceIdsParam(raw);
    if (!parsed.ok) throw new GroomPackageBookingError('INVALID_ADDON_IDS');
    return parsed.ids;
  }
  if (Array.isArray(raw)) {
    const parsed = parsePublicServiceIdsParam(raw.map(String).join(','));
    if (!parsed.ok) throw new GroomPackageBookingError('INVALID_ADDON_IDS');
    return parsed.ids;
  }
  throw new GroomPackageBookingError('INVALID_ADDON_IDS');
}

function parsePackageId(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new GroomPackageBookingError('INVALID_PACKAGE_ID');
  }
  return n;
}

function isSalonService(row: ProRow): boolean {
  if (row.isDeleted) return false;
  if (isRetailProductClassification({
    ProType: row.ProType,
    CatType: row.CatType,
    CatName: row.CatName,
  })) {
    return false;
  }
  const proType = String(row.ProType ?? '')
    .trim()
    .toLowerCase();
  return proType === '' || proType === 'serv';
}

function catalogDuration(row: ProRow): number {
  const d = row.DurationMinutes;
  if (d == null || !Number.isFinite(Number(d))) return 0;
  const n = Math.trunc(Number(d));
  return n > 0 ? n : 0;
}

function toLine(
  row: ProRow,
  price: number,
  durationMinutes: number,
): ResolvedBookingServiceLine {
  const nameEn = (row.ProName ?? '').trim() || `Service #${row.ProID}`;
  const nameAr = (row.ProNameAr ?? '').trim() || nameEn;
  return {
    serviceId: row.ProID,
    nameAr,
    nameEn,
    price,
    durationMinutes,
  };
}

/**
 * Build structured metadata for Bookings.Notes (no PackageID column).
 * Format is machine-parseable for POS handoff.
 */
export function buildGroomPackageMetadataNote(args: {
  packageId: number;
  packagePrice: number;
  addonProIds: number[];
  requiredServiceIds: number[];
  totalPrice: number;
}): string {
  // Compact key=value; keep under Notes NVARCHAR(500) budget with other notes.
  return (
    `[groomPackage] packageId=${args.packageId};` +
    `packagePrice=${args.packagePrice};` +
    `addons=${args.addonProIds.join(',') || '-'};` +
    `required=${args.requiredServiceIds.join(',')};` +
    `total=${args.totalPrice}`
  );
}

export function parseGroomPackageMetadataNote(
  notes: string | null | undefined,
): {
  packageId: number;
  packagePrice: number;
  addonProIds: number[];
  requiredServiceIds: number[];
  totalPrice: number;
} | null {
  if (!notes) return null;
  const m = notes.match(/\[groomPackage\]\s*([^\n\r]*)/);
  if (!m) return null;
  const body = m[1];
  const get = (key: string) => {
    const hit = body.match(new RegExp(`(?:^|;)${key}=([^;]+)`));
    return hit?.[1]?.trim() ?? '';
  };
  const packageId = Number(get('packageId'));
  const packagePrice = Number(get('packagePrice'));
  const totalRaw = get('total');
  const totalPrice = Number(String(totalRaw).replace(/[^\d.]/g, ''));
  const addonsRaw = get('addons');
  const requiredRaw = get('required');
  if (!Number.isInteger(packageId) || packageId <= 0) return null;
  return {
    packageId,
    packagePrice: Number.isFinite(packagePrice) ? packagePrice : 0,
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
    addonProIds:
      !addonsRaw || addonsRaw === '-'
        ? []
        : addonsRaw
            .split(',')
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0),
    requiredServiceIds: requiredRaw
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}

async function loadProRows(proIds: number[]): Promise<Map<number, ProRow>> {
  const map = new Map<number, ProRow>();
  const unique = [...new Set(proIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return map;
  const db = await getPool();

  // Bound IN list — package catalogs are small (typically < 20 ids).
  const req = db.request();
  const placeholders: string[] = [];
  unique.forEach((id, i) => {
    const key = `p${i}`;
    placeholders.push(`@${key}`);
    req.input(key, sql.Int, id);
  });
  const result = await req.query(`
    SELECT
      p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
      ISNULL(p.ProType, N'') AS ProType,
      ISNULL(p.isDeleted, 0) AS isDeleted,
      c.CatName, c.CatType
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE p.ProID IN (${placeholders.join(',')})
  `);

  for (const row of result.recordset as Record<string, unknown>[]) {
    const proId = Number(row.ProID);
    map.set(proId, {
      ProID: proId,
      ProName: String(row.ProName ?? ''),
      ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
      SPrice1: Number(row.SPrice1) || 0,
      DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
      ProType: row.ProType != null ? String(row.ProType) : null,
      CatName: row.CatName != null ? String(row.CatName) : null,
      CatType: row.CatType != null ? String(row.CatType) : null,
      isDeleted: Number(row.isDeleted) === 1,
    });
  }
  return map;
}

/**
 * Resolve a groom package booking from server truth.
 * Does NOT use Phase-2 public catalog membership.
 */
export async function resolveGroomPackageBooking(args: {
  packageId: unknown;
  addonProIds?: unknown;
  /** Optional client serviceIds — consistency check only */
  clientServiceIds?: unknown;
}): Promise<ResolvedGroomPackageBooking> {
  const packageId = parsePackageId(args.packageId);
  const addonProIds = parseIdList(args.addonProIds);
  const clientServiceIds =
    args.clientServiceIds == null || args.clientServiceIds === ''
      ? null
      : parseIdList(args.clientServiceIds);

  const db = await getPool();
  const pkgRes = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .query(`
      SELECT PackageID, NameEn, NameAr, PackageKind, PackagePrice, DurationMinutes,
             ISNULL(isDeleted, 0) AS isDeleted
      FROM dbo.TblServicePackage
      WHERE PackageID = @PackageID
    `);
  const pkg = pkgRes.recordset[0] as Record<string, unknown> | undefined;
  if (!pkg) throw new GroomPackageBookingError('PACKAGE_NOT_FOUND', { packageId });
  if (Number(pkg.isDeleted) === 1) {
    throw new GroomPackageBookingError('PACKAGE_NOT_ACTIVE', { packageId });
  }
  if (String(pkg.PackageKind ?? '') !== 'groom') {
    throw new GroomPackageBookingError('PACKAGE_NOT_GROOM', { packageId });
  }

  const packagePrice = Number(pkg.PackagePrice);
  if (!Number.isFinite(packagePrice) || packagePrice < 0) {
    throw new GroomPackageBookingError('PACKAGE_SERVICE_INVALID', {
      packageId,
      reason: 'invalid_package_price',
    });
  }

  const packageDurationMinutes = Number(pkg.DurationMinutes);
  if (
    !Number.isInteger(packageDurationMinutes) ||
    packageDurationMinutes <= 0
  ) {
    throw new GroomPackageBookingError('PACKAGE_DURATION_MISSING', {
      packageId,
      durationMinutes: pkg.DurationMinutes,
    });
  }

  const itemsRes = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .query(`
      SELECT ProID, IsOptional, SortOrder
      FROM dbo.TblServicePackageItem
      WHERE PackageID = @PackageID
      ORDER BY SortOrder, PackageItemID
    `);
  const items = itemsRes.recordset as Array<{
    ProID: number;
    IsOptional: boolean | number;
    SortOrder: number;
  }>;
  if (!items.length) throw new GroomPackageBookingError('PACKAGE_EMPTY', { packageId });

  const requiredIds = items
    .filter((i) => Number(i.IsOptional) !== 1)
    .map((i) => Number(i.ProID));
  const optionalIds = new Set(
    items.filter((i) => Number(i.IsOptional) === 1).map((i) => Number(i.ProID)),
  );

  if (!requiredIds.length) {
    throw new GroomPackageBookingError('PACKAGE_EMPTY', { packageId });
  }

  // Home visit exclusivity among addons
  const allProMetaNeeded = [...requiredIds, ...addonProIds, ...optionalIds];
  const proMap = await loadProRows(allProMetaNeeded);

  const homeVisitProIds: number[] = [];
  for (const [id, row] of proMap) {
    if (resolveGroomOptionalGroup({ proId: id, catName: row.CatName }) === 'home_visit') {
      homeVisitProIds.push(id);
    }
  }
  // Also include known optional home visits from package even if not yet loaded? already loaded
  if (hasConflictingHomeVisitProIds(addonProIds, homeVisitProIds)) {
    throw new GroomPackageBookingError('HOME_VISIT_EXCLUSIVE', {
      addonProIds,
      homeVisitProIds,
    });
  }

  // Validate required services exist as salon services (not catalog-public)
  for (const id of requiredIds) {
    const row = proMap.get(id);
    if (!row || !isSalonService(row)) {
      throw new GroomPackageBookingError('PACKAGE_SERVICE_INVALID', {
        packageId,
        proId: id,
        reason: !row ? 'missing' : row.isDeleted ? 'deleted' : 'not_salon_service',
      });
    }
  }

  // Validate addons
  const uniqueAddons: number[] = [];
  for (const id of addonProIds) {
    if (uniqueAddons.includes(id)) continue;
    uniqueAddons.push(id);

    if (requiredIds.includes(id)) {
      throw new GroomPackageBookingError('PACKAGE_ADDON_ALREADY_INCLUDED', {
        packageId,
        proId: id,
      });
    }
    if (!optionalIds.has(id)) {
      throw new GroomPackageBookingError('PACKAGE_ADDON_NOT_OPTIONAL', {
        packageId,
        proId: id,
      });
    }
    const row = proMap.get(id);
    if (!row) {
      throw new GroomPackageBookingError('PACKAGE_ADDON_INVALID', {
        packageId,
        proId: id,
        reason: 'missing',
      });
    }
    if (row.isDeleted) {
      throw new GroomPackageBookingError('PACKAGE_ADDON_INVALID', {
        packageId,
        proId: id,
        reason: 'deleted',
      });
    }
    if (!isSalonService(row)) {
      throw new GroomPackageBookingError('PACKAGE_ADDON_INVALID', {
        packageId,
        proId: id,
        reason: 'not_salon_service',
      });
    }
    if (!(Number(row.SPrice1) >= 0) || !Number.isFinite(Number(row.SPrice1))) {
      throw new GroomPackageBookingError('PACKAGE_ADDON_INVALID', {
        packageId,
        proId: id,
        reason: 'invalid_price',
      });
    }
  }

  // Client consistency check (non-authoritative)
  let clientServiceIdsMismatch = false;
  if (clientServiceIds) {
    const expected = [...requiredIds, ...uniqueAddons];
    const a = [...clientServiceIds].sort((x, y) => x - y).join(',');
    const b = [...expected].sort((x, y) => x - y).join(',');
    if (a !== b) {
      clientServiceIdsMismatch = true;
      console.warn('[groomPackageBooking] client serviceIds mismatch', {
        packageId,
        clientServiceIds,
        serverRequired: requiredIds,
        serverAddons: uniqueAddons,
      });
    }
  }

  // Build lines:
  // Required: price 0 on all but first gets packagePrice (POS sum = package + addons)
  // Duration on required lines: store catalog mins for ops, but totalDuration uses package base
  const requiredLines: ResolvedBookingServiceLine[] = requiredIds.map((id, idx) => {
    const row = proMap.get(id)!;
    return toLine(row, idx === 0 ? packagePrice : 0, catalogDuration(row));
  });

  const addonLines: ResolvedBookingServiceLine[] = uniqueAddons.map((id) => {
    const row = proMap.get(id)!;
    return toLine(row, Number(row.SPrice1) || 0, catalogDuration(row));
  });

  const addonTotal = addonLines.reduce((sum, l) => sum + l.price, 0);
  const addonDurationSum = addonLines.reduce((sum, l) => sum + l.durationMinutes, 0);
  const totalPrice = packagePrice + addonTotal;
  const totalDurationMinutes = packageDurationMinutes + addonDurationSum;

  const nameEn = String(pkg.NameEn ?? '').trim();
  const nameAr = String(pkg.NameAr ?? '').trim() || nameEn;
  const services = [...requiredLines, ...addonLines];

  return {
    packageId,
    nameEn,
    nameAr,
    packagePrice,
    packageDurationMinutes,
    requiredServiceIds: requiredIds,
    addonProIds: uniqueAddons,
    services,
    serviceIds: services.map((s) => s.serviceId),
    addonLines,
    addonTotal,
    totalPrice,
    totalDurationMinutes,
    clientServiceIdsMismatch,
    metadataNote: buildGroomPackageMetadataNote({
      packageId,
      packagePrice,
      addonProIds: uniqueAddons,
      requiredServiceIds: requiredIds,
      totalPrice,
    }),
  };
}

export function mapGroomPackageErrorToPublicCode(
  code: GroomPackageBookingErrorCode,
):
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_NOT_ACTIVE'
  | 'PACKAGE_NOT_GROOM'
  | 'PACKAGE_EMPTY'
  | 'PACKAGE_SERVICE_INVALID'
  | 'PACKAGE_ADDON_INVALID'
  | 'PACKAGE_ADDON_NOT_OPTIONAL'
  | 'PACKAGE_ADDON_ALREADY_INCLUDED'
  | 'HOME_VISIT_EXCLUSIVE'
  | 'INVALID_PACKAGE_ID'
  | 'INVALID_ADDON_IDS'
  | 'PACKAGE_DURATION_MISSING'
  | 'SERVICE_NOT_AVAILABLE_AT_BRANCH' {
  return code;
}
