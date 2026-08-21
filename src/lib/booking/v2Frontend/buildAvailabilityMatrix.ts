/**
 * Booking V2 B9 — availability matrix (FreeMask per Emp×Branch×BusinessDate).
 * B9.6: warm context cache + no bitmap re-encode + latency breakdown.
 */

import 'server-only';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import {
  BOOKING_TZ,
  businessDateTimeToEpochMs,
  isBusinessDateString,
} from '@/lib/booking/domain/BusinessDate';
import { getCairoBusinessDate, shiftCalendarDate } from '@/lib/businessDate';
import {
  listPublicDiscoverableBranches,
  resolvePublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import { listBookableEmployeeIdsForBranch } from '@/lib/branch/bookingQueueOwnership';
import { getPublicSettings } from '@/lib/publicBookingHelpers';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
import {
  BOOKING_V2_FRONTEND_CONTRACT,
  type V2PublicAvailabilityDayDto,
  type V2PublicAvailabilityMatrixRequest,
  type V2PublicAvailabilityMatrixResponse,
} from '@/lib/booking/v2Frontend/publicSafeDtos';
import {
  bumpWarmMatrixContextRevision,
  getOrLoadWarmMatrixContext,
  type WarmBranchRef,
  type WarmSettingsSlice,
} from '@/lib/booking/cache/WarmMatrixContextCache';

export class BookingV2MatrixError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'BookingV2MatrixError';
    this.code = code;
  }
}

export type WarmMatrixLatencyBreakdown = {
  branchSettingsMs: number;
  rosterMs: number;
  contextCacheHit: boolean;
  revisionMs: number;
  revisionSoftHit: boolean;
  l1ReadMs: number;
  dtoMs: number;
  resolveMs: number;
  appComputeMs: number;
  wallMs: number;
};

function uniqPosInts(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
}

function inclusiveSpan(from: string, to: string): number {
  let n = 0;
  let cur = from;
  while (cur <= to) {
    n += 1;
    cur = shiftCalendarDate(cur, 1);
  }
  return n;
}

async function resolveBranchCodes(
  req: V2PublicAvailabilityMatrixRequest,
): Promise<string[]> {
  const codes = [
    ...(req.branchCodes ?? []),
    ...(req.branchCode ? [req.branchCode] : []),
  ]
    .map((c) => String(c).trim().toUpperCase())
    .filter(Boolean);
  if (codes.length) return [...new Set(codes)];

  const ids = uniqPosInts([
    ...(req.branchIds ?? []),
    ...(req.branchId != null ? [req.branchId] : []),
  ]);
  if (ids.length) {
    const all = await listPublicDiscoverableBranches();
    const out: string[] = [];
    for (const id of ids) {
      const hit = all.find((b) => b.branchId === id);
      if (!hit) throw new BookingV2MatrixError('BRANCH_NOT_FOUND');
      out.push(hit.branchCode);
    }
    return out;
  }

  throw new BookingV2MatrixError('BRANCH_REQUIRED');
}

async function loadWarmContextForCode(args: {
  branchCode: string;
  asOfDate: string;
  needRoster: boolean;
}): Promise<{
  branch: WarmBranchRef;
  settings: WarmSettingsSlice;
  rosterEmpIds: number[];
  cacheHit: boolean;
  loadMs: number;
}> {
  const got = await getOrLoadWarmMatrixContext({
    branchCode: args.branchCode,
    asOfDate: args.asOfDate,
    load: async () => {
      const ctx = await resolvePublicBookingBranchContext({
        branchCode: args.branchCode,
        purpose: 'public_booking',
      });
      const settings = await getPublicSettings(ctx.branchId);
      const rosterEmpIds = args.needRoster
        ? await listBookableEmployeeIdsForBranch(ctx.branchId, args.asOfDate, {
            publicOnly: true,
          })
        : undefined;
      return {
        branch: {
          branchId: ctx.branchId,
          branchCode: ctx.branchCode,
          timezone: settings.timezone || ctx.timezone || BOOKING_TZ,
        },
        settings: {
          branchId: ctx.branchId,
          timezone: settings.timezone || ctx.timezone || BOOKING_TZ,
          slotIntervalMinutes: settings.slotIntervalMinutes || 15,
          maxBookingDaysAhead: settings.maxBookingDaysAhead || 14,
          minNoticeMinutes: settings.minNoticeMinutes || 0,
          currency: settings.currency,
        },
        rosterEmpIds,
      };
    },
  });

  let rosterEmpIds = got.entry.rosterByAsOf.get(args.asOfDate) ?? [];
  if (args.needRoster && !got.entry.rosterByAsOf.has(args.asOfDate)) {
    const t0 = performance.now();
    rosterEmpIds = await listBookableEmployeeIdsForBranch(
      got.entry.branch.branchId,
      args.asOfDate,
      { publicOnly: true },
    );
    got.entry.rosterByAsOf.set(args.asOfDate, rosterEmpIds);
    return {
      branch: got.entry.branch,
      settings: got.entry.settings,
      rosterEmpIds,
      cacheHit: got.cacheHit,
      loadMs: got.loadMs + (performance.now() - t0),
    };
  }

  return {
    branch: got.entry.branch,
    settings: got.entry.settings,
    rosterEmpIds,
    cacheHit: got.cacheHit,
    loadMs: got.loadMs,
  };
}

async function resolveDurationMinutes(args: {
  req: V2PublicAvailabilityMatrixRequest;
  branchCode: string;
}): Promise<number | null> {
  if (
    args.req.durationMinutes != null &&
    Number.isFinite(args.req.durationMinutes) &&
    args.req.durationMinutes > 0
  ) {
    return Math.floor(Number(args.req.durationMinutes));
  }
  const serviceIds = uniqPosInts([
    ...(args.req.serviceIds ?? []),
    ...(args.req.serviceId != null ? [args.req.serviceId] : []),
  ]);
  if (!serviceIds.length) return null;

  const ctx = await resolvePublicBookingBranchContext({
    branchCode: args.branchCode,
    purpose: 'public_booking',
  });
  const catalog = await getPublicBookingServicesCatalog(ctx);
  let total = 0;
  for (const sid of serviceIds) {
    const svc = catalog.services.find((s) => s.serviceId === sid);
    if (!svc) throw new BookingV2MatrixError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    total += svc.durationMinutes;
  }
  return total > 0 ? total : null;
}

/**
 * Build compact availability matrix via Booking V2 live resolver.
 * Duration is convenience only — response is FreeMask, not service-specific starts.
 */
export async function buildPublicAvailabilityMatrix(
  req: V2PublicAvailabilityMatrixRequest,
): Promise<{
  body: V2PublicAvailabilityMatrixResponse;
  metrics: {
    queryCount: number;
    dbMs: number;
    composeMs: number;
    totalMs: number;
    hotCache: unknown;
    warm?: WarmMatrixLatencyBreakdown;
  };
}> {
  const wall0 = performance.now();
  const from = String(req.fromBusinessDate ?? '');
  const to = String(req.toBusinessDate ?? '');
  if (!isBusinessDateString(from) || !isBusinessDateString(to)) {
    throw new BookingV2MatrixError('INVALID_DATE');
  }
  if (from > to) throw new BookingV2MatrixError('INVALID_DATE_RANGE');

  const explicitEmps = uniqPosInts([
    ...(req.employeeIds ?? []),
    ...(req.employeeId != null ? [req.employeeId] : []),
  ]);
  const needRoster = explicitEmps.length === 0;

  const codes = await resolveBranchCodes(req);
  const tCtx0 = performance.now();
  const contexts = await Promise.all(
    codes.map((branchCode) =>
      loadWarmContextForCode({
        branchCode,
        asOfDate: from,
        needRoster,
      }),
    ),
  );
  const branchSettingsMs = performance.now() - tCtx0;
  const contextCacheHit = contexts.every((c) => c.cacheHit);

  const branches = contexts.map((c) => c.branch);
  const primary = contexts[0]!;
  const settings = primary.settings;
  const today = getCairoBusinessDate();
  const maxAhead = Math.max(1, settings.maxBookingDaysAhead || 14);
  const horizonEnd = shiftCalendarDate(today, maxAhead);

  if (from < today) throw new BookingV2MatrixError('INVALID_DATE');
  if (to > horizonEnd) throw new BookingV2MatrixError('BOOKING_HORIZON_EXCEEDED');

  const span = inclusiveSpan(from, to);
  if (span > maxAhead + 1) {
    throw new BookingV2MatrixError('DATE_RANGE_TOO_LARGE');
  }

  const employeeIds = needRoster
    ? uniqPosInts(contexts.flatMap((c) => c.rosterEmpIds))
    : explicitEmps;
  // Any-barber / branch roster: needRoster loads public bookable emp IDs only.

  if (!employeeIds.length) {
    return {
      body: {
        ok: true,
        contract: BOOKING_V2_FRONTEND_CONTRACT,
        generatedAt: new Date().toISOString(),
        timezone: settings.timezone || BOOKING_TZ,
        slotIntervalMinutes: settings.slotIntervalMinutes || 15,
        fromBusinessDate: from,
        toBusinessDate: to,
        durationMinutes: null,
        days: [],
      },
      metrics: {
        queryCount: 0,
        dbMs: 0,
        composeMs: 0,
        totalMs: 0,
        hotCache: null,
        warm: {
          branchSettingsMs,
          rosterMs: 0,
          contextCacheHit,
          revisionMs: 0,
          revisionSoftHit: false,
          l1ReadMs: 0,
          dtoMs: 0,
          resolveMs: 0,
          appComputeMs: performance.now() - wall0,
          wallMs: performance.now() - wall0,
        },
      },
    };
  }

  // Skip catalog unless caller asked for service-based duration.
  const durationMinutes =
    (await resolveDurationMinutes({ req, branchCode: primary.branch.branchCode })) ??
    30;

  const { resolveBookingAvailabilityV2 } = await import(
    '@/lib/booking/projection/resolveBookingAvailabilityV2Live'
  );

  const tResolve0 = performance.now();
  const v2 = await resolveBookingAvailabilityV2({
    employeeIds,
    branchIds: branches.map((b) => b.branchId),
    businessDateRange: { from, to },
    durationMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes || 15,
    source: 'public',
    includeStarts: false,
  });
  const resolveMs = performance.now() - tResolve0;

  const branchCodeById = new Map(
    branches.map((b) => [b.branchId, b.branchCode] as const),
  );
  const tz = settings.timezone || BOOKING_TZ;

  // Precompute midnight ms per unique businessDate (avoid N× TZ work).
  const midnightByDate = new Map<string, number>();
  const midnightFor = (businessDate: string): number => {
    let v = midnightByDate.get(businessDate);
    if (v == null) {
      v = businessDateTimeToEpochMs({
        businessDate,
        clockTimeHhmm: '00:00',
        timeZone: tz,
      });
      midnightByDate.set(businessDate, v);
    }
    return v;
  };

  const tDto0 = performance.now();
  const days: V2PublicAvailabilityDayDto[] = v2.days.map((d) => {
    const businessDayStartAtMs = midnightFor(d.businessDate);
    const freeMaskB64 =
      d.freeMaskB64 ||
      AvailabilityBitmap.fromFreeRanges(d.freeRanges).toBase64();
    return {
      employeeId: d.employeeId,
      branchId: d.branchId,
      branchCode: branchCodeById.get(d.branchId) ?? String(d.branchId),
      businessDate: d.businessDate,
      availabilityRevision: d.availabilityRevision,
      freeRanges: d.freeRanges,
      freeMaskB64,
      timezone: tz,
      businessDayStartAtMs,
      timelineEndAtMs: businessDayStartAtMs + 48 * 60 * 60_000,
      hasOvernightFree: d.freeRanges.some(
        (r) => r.endMin > 1440 || r.startMin >= 1440,
      ),
      isAvailable: d.freeRanges.length > 0,
    };
  });
  const dtoMs = performance.now() - tDto0;

  const hot = v2.hotCache as
    | {
        revisionLookupMs?: number;
        cacheReadMs?: number;
        revisionSoftHit?: boolean;
        revisionQueryCount?: number;
      }
    | undefined;

  const revisionMs = hot?.revisionLookupMs ?? 0;
  const l1ReadMs = hot?.cacheReadMs ?? 0;
  const wallMs = performance.now() - wall0;
  // App compute = wall − revision SQL RTT (soft hit counts as near-zero SQL).
  const appComputeMs = Math.max(0, wallMs - (hot?.revisionSoftHit ? 0 : revisionMs));

  return {
    body: {
      ok: true,
      contract: BOOKING_V2_FRONTEND_CONTRACT,
      generatedAt: new Date().toISOString(),
      timezone: tz,
      slotIntervalMinutes: settings.slotIntervalMinutes || 15,
      fromBusinessDate: from,
      toBusinessDate: to,
      durationMinutes:
        req.durationMinutes != null ||
        req.serviceId != null ||
        (req.serviceIds?.length ?? 0) > 0
          ? durationMinutes
          : null,
      days,
    },
    metrics: {
      queryCount: v2.queryCount,
      dbMs: Math.round(v2.dbMs),
      composeMs: Number(v2.composeMs.toFixed(3)),
      totalMs: Number(v2.totalMs.toFixed(3)),
      hotCache: v2.hotCache ?? null,
      warm: {
        branchSettingsMs: +branchSettingsMs.toFixed(2),
        rosterMs: needRoster ? +branchSettingsMs.toFixed(2) : 0,
        contextCacheHit,
        revisionMs: +revisionMs.toFixed(2),
        revisionSoftHit: !!hot?.revisionSoftHit,
        l1ReadMs: +l1ReadMs.toFixed(2),
        dtoMs: +dtoMs.toFixed(2),
        resolveMs: +resolveMs.toFixed(2),
        appComputeMs: +appComputeMs.toFixed(2),
        wallMs: +wallMs.toFixed(2),
      },
    },
  };
}

/** Re-export for admin invalidators. */
export { bumpWarmMatrixContextRevision };
