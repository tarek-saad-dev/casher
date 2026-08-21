/**
 * Booking V2 B9 — public bootstrap catalog (no live availability).
 * B9.5: no per-employee schedule on cold path; parallel branch loads;
 * L1 + SQL snapshot + HTTP ETag (not process-memory-only).
 */

import 'server-only';
import { createHash } from 'node:crypto';
import {
  listPublicDiscoverableBranches,
  resolvePublicBookingBranchContext,
  toPublicBranchSafeWire,
} from '@/lib/booking/publicBookingBranchContext';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
import { listPublicBookingBarbers } from '@/lib/booking/publicBookingBarbers';
import { getPublicSettings } from '@/lib/publicBookingHelpers';
import { getStaticBootstrapCache } from '@/lib/booking/cache/StaticBootstrapCache';
import { BOOKING_TZ } from '@/lib/booking/domain/BusinessDate';
import {
  BOOKING_V2_FRONTEND_CONTRACT,
  type V2PublicBarberDto,
  type V2PublicBootstrapResponse,
  type V2PublicBranchDto,
  type V2PublicEmployeeBranchMappingDto,
  type V2PublicMediaRefDto,
  type V2PublicServiceDto,
  type V2PublicBookingSettingsDto,
} from '@/lib/booking/v2Frontend/publicSafeDtos';

const BOOTSTRAP_SCOPE = 'public:all';
/** L1 soft TTL — SQL snapshot covers cold serverless. */
const BOOTSTRAP_L1_TTL_MS = 120_000;
/** SQL snapshot freshness before forced rebuild. */
const BOOTSTRAP_SQL_TTL_MS = 15 * 60_000;

export type BootstrapBuildTimings = {
  connectionMs: number;
  discoverMs: number;
  branchParallelMs: number;
  catalogMs: number;
  settingsMs: number;
  barbersMs: number;
  serializeMs: number;
  revisionMs: number;
  sqlStoreMs: number;
  totalMs: number;
  source: 'l1' | 'sql' | 'rebuild';
};

function fingerprint(parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function toServiceDto(s: {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  durationMinutes: number;
  imageUrl: string | null;
  photoUrl: string | null;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  sortOrder: number;
}): V2PublicServiceDto {
  return {
    serviceId: s.serviceId,
    nameAr: s.nameAr,
    nameEn: s.nameEn,
    name: s.name,
    price: s.price,
    durationMinutes: s.durationMinutes,
    imageUrl: s.imageUrl,
    photoUrl: s.photoUrl,
    categoryId: s.categoryId,
    categoryNameAr: s.categoryNameAr,
    categoryNameEn: s.categoryNameEn,
    sortOrder: s.sortOrder,
    bookable: true,
  };
}

function toBarberDto(b: {
  empId: number;
  nameAr: string;
  nameEn: string | null;
  name: string;
  imageUrl: string | null;
  photoUrl: string | null;
  shortBio: string | null;
  displaySortOrder: number;
  serviceIds: number[];
  branches: Array<{ branchCode: string; branchName: string }>;
}): V2PublicBarberDto {
  return {
    employeeId: b.empId,
    nameAr: b.nameAr,
    nameEn: b.nameEn,
    name: b.name,
    imageUrl: b.imageUrl,
    photoUrl: b.photoUrl,
    shortBio: b.shortBio,
    displaySortOrder: b.displaySortOrder,
    serviceIds: [...b.serviceIds],
    branchCodes: b.branches.map((x) => x.branchCode),
  };
}

async function rebuildBootstrap(opts?: {
  previewQueryParam?: string | null;
}): Promise<{
  body: V2PublicBootstrapResponse;
  timings: Omit<BootstrapBuildTimings, 'totalMs' | 'source' | 'sqlStoreMs' | 'connectionMs'>;
}> {
  const t0 = performance.now();
  const discoverable = await listPublicDiscoverableBranches();
  const discoverMs = performance.now() - t0;

  const tPar0 = performance.now();
  // Parallel per-branch catalog/settings + ONE global barbers roster.
  // Do NOT pass `date` to barbers — that triggered resolveEmployeeGlobalSchedule
  // per employee (~10s+/branch on cloud) and caused the historical ~21s cold path.
  const [barbersGlobal, ...branchPacks] = await Promise.all([
    listPublicBookingBarbers({
      mode: 'global',
      previewQueryParam: opts?.previewQueryParam,
    }),
    ...discoverable.map(async (b) => {
      const ctx = await resolvePublicBookingBranchContext({
        branchCode: b.branchCode,
        purpose: 'public_booking',
        previewQueryParam: opts?.previewQueryParam,
      });
      const [catalog, settings] = await Promise.all([
        getPublicBookingServicesCatalog(ctx),
        getPublicSettings(ctx.branchId),
      ]);
      return { b, ctx, catalog, settings };
    }),
  ]);
  const branchParallelMs = performance.now() - tPar0;

  const tSer0 = performance.now();
  const branches: V2PublicBranchDto[] = [];
  const servicesByBranch: Record<string, V2PublicServiceDto[]> = {};
  const settingsByBranch: Record<string, V2PublicBookingSettingsDto> = {};
  const media: V2PublicMediaRefDto[] = [];
  const revisionParts: string[] = [];
  const employeeMap = new Map<number, V2PublicBarberDto>();
  const mappings: V2PublicEmployeeBranchMappingDto[] = [];
  const codeSet = new Set(discoverable.map((d) => d.branchCode));

  for (const pack of branchPacks) {
    const { b, ctx, catalog, settings } = pack;
    const safe = toPublicBranchSafeWire(ctx);
    branches.push(safe);

    const barbersAtBranch = barbersGlobal.barbers.filter((barber) =>
      barber.branches.some((x) => x.branchCode === b.branchCode),
    );

    revisionParts.push(
      `${b.branchCode}:${catalog.meta.catalogVersion ?? catalog.meta.generatedAt}:${settings.minNoticeMinutes}:${settings.maxBookingDaysAhead}:${barbersAtBranch.length}`,
    );

    servicesByBranch[b.branchCode] = catalog.services.map(toServiceDto);
    for (const s of catalog.services) {
      if (s.imageUrl) {
        media.push({ kind: 'service', id: s.serviceId, imageUrl: s.imageUrl });
      }
    }

    settingsByBranch[b.branchCode] = {
      branchId: ctx.branchId,
      branchCode: b.branchCode,
      minNoticeMinutes: settings.minNoticeMinutes,
      maxBookingDaysAhead: settings.maxBookingDaysAhead,
      slotIntervalMinutes: settings.slotIntervalMinutes || 15,
      allowSpecificBarber: settings.allowSpecificBarber,
      allowNearestBarber: settings.allowNearestBarber,
      defaultMode: settings.defaultMode,
      timezone: settings.timezone || ctx.timezone || BOOKING_TZ,
      currency: settings.currency,
      bookingEnabled: !!settings.bookingEnabled && ctx.bookingEnabled,
    };

    for (const barber of barbersAtBranch) {
      const dto = toBarberDto({
        ...barber,
        branches: barber.branches.filter((x) => codeSet.has(x.branchCode)),
      });
      const prev = employeeMap.get(dto.employeeId);
      if (!prev) {
        employeeMap.set(dto.employeeId, dto);
      } else {
        const codes = new Set([...prev.branchCodes, ...dto.branchCodes]);
        const services = new Set([...prev.serviceIds, ...dto.serviceIds]);
        employeeMap.set(dto.employeeId, {
          ...prev,
          branchCodes: [...codes],
          serviceIds: [...services],
        });
      }
      mappings.push({
        employeeId: dto.employeeId,
        branchId: ctx.branchId,
        branchCode: b.branchCode,
      });
      if (dto.imageUrl) {
        media.push({
          kind: 'barber',
          id: dto.employeeId,
          imageUrl: dto.imageUrl,
        });
      }
    }
  }

  const employees = [...employeeMap.values()].sort(
    (a, b) =>
      a.displaySortOrder - b.displaySortOrder ||
      a.nameAr.localeCompare(b.nameAr, 'ar'),
  );

  const tRev0 = performance.now();
  const revision = fingerprint([
    BOOKING_V2_FRONTEND_CONTRACT,
    ...revisionParts,
    `emp:${employees.length}`,
    `map:${mappings.length}`,
  ]);
  const revisionMs = performance.now() - tRev0;

  const body: V2PublicBootstrapResponse = {
    ok: true,
    contract: BOOKING_V2_FRONTEND_CONTRACT,
    capability: {
      version: BOOKING_V2_FRONTEND_CONTRACT,
      supportsMatrix: true,
      supportsLocalSlotGeneration: true,
      overnightTimelineHours: 48,
      availabilityQuantumMinutes: 5,
    },
    revision,
    generatedAt: new Date().toISOString(),
    timezone: BOOKING_TZ,
    branches,
    employees,
    employeeBranchMappings: mappings,
    servicesByBranch,
    settingsByBranch,
    media,
  };
  const serializeMs = performance.now() - tSer0;

  return {
    body,
    timings: {
      discoverMs,
      branchParallelMs,
      catalogMs: 0,
      settingsMs: 0,
      barbersMs: 0,
      serializeMs,
      revisionMs,
    },
  };
}

/**
 * Build (or reuse cached) public bootstrap payload.
 * Does NOT include live availability.
 */
export async function buildPublicBookingV2Bootstrap(opts?: {
  previewQueryParam?: string | null;
  forceRefresh?: boolean;
}): Promise<{
  body: V2PublicBootstrapResponse;
  etag: string;
  cacheHit: boolean;
  timings?: BootstrapBuildTimings;
}> {
  const tAll0 = performance.now();
  const cache = getStaticBootstrapCache();

  if (!opts?.forceRefresh) {
    const hit = cache.get<V2PublicBootstrapResponse>('branches', BOOTSTRAP_SCOPE);
    if (hit && Date.now() - hit.builtAtMs < BOOTSTRAP_L1_TTL_MS) {
      return {
        body: hit.payload,
        etag: `W/"${hit.revision}"`,
        cacheHit: true,
        timings: {
          connectionMs: 0,
          discoverMs: 0,
          branchParallelMs: 0,
          catalogMs: 0,
          settingsMs: 0,
          barbersMs: 0,
          serializeMs: 0,
          revisionMs: 0,
          sqlStoreMs: 0,
          totalMs: performance.now() - tAll0,
          source: 'l1',
        },
      };
    }

    const tSql0 = performance.now();
    try {
      const { getBootstrapSqlStore } = await import(
        '@/lib/booking/cache/BootstrapSqlStore'
      );
      const snap = await getBootstrapSqlStore().load(BOOTSTRAP_SCOPE);
      const sqlStoreMs = performance.now() - tSql0;
      if (
        snap &&
        Date.now() - snap.builtAtMs < BOOTSTRAP_SQL_TTL_MS
      ) {
        const body = JSON.parse(snap.payloadJson) as V2PublicBootstrapResponse;
        cache.set({
          kind: 'branches',
          scopeKey: BOOTSTRAP_SCOPE,
          revision: snap.revision,
          payload: body,
          builtAtMs: Date.now(),
        });
        return {
          body,
          etag: `W/"${snap.revision}"`,
          cacheHit: true,
          timings: {
            connectionMs: 0,
            discoverMs: 0,
            branchParallelMs: 0,
            catalogMs: 0,
            settingsMs: 0,
            barbersMs: 0,
            serializeMs: 0,
            revisionMs: 0,
            sqlStoreMs,
            totalMs: performance.now() - tAll0,
            source: 'sql',
          },
        };
      }
    } catch {
      /* SQL snapshot optional */
    }
  }

  const { body, timings } = await rebuildBootstrap(opts);

  cache.set({
    kind: 'branches',
    scopeKey: BOOTSTRAP_SCOPE,
    revision: body.revision,
    payload: body,
    builtAtMs: Date.now(),
  });

  let sqlStoreMs = 0;
  try {
    const tSql0 = performance.now();
    const { getBootstrapSqlStore } = await import(
      '@/lib/booking/cache/BootstrapSqlStore'
    );
    await getBootstrapSqlStore().save({
      scopeKey: BOOTSTRAP_SCOPE,
      revision: body.revision,
      payloadJson: JSON.stringify(body),
    });
    sqlStoreMs = performance.now() - tSql0;
  } catch {
    /* optional */
  }

  return {
    body,
    etag: `W/"${body.revision}"`,
    cacheHit: false,
    timings: {
      connectionMs: 0,
      ...timings,
      sqlStoreMs,
      totalMs: performance.now() - tAll0,
      source: 'rebuild',
    },
  };
}

/** Invalidate bootstrap when admin catalog changes (call from catalog invalidators). */
export function invalidatePublicBookingV2Bootstrap(): void {
  getStaticBootstrapCache().invalidate('branches', BOOTSTRAP_SCOPE);
  void import('@/lib/booking/cache/BootstrapSqlStore')
    .then((m) => m.getBootstrapSqlStore().invalidate(BOOTSTRAP_SCOPE))
    .catch(() => undefined);
}
