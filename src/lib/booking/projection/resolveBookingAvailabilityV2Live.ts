/**
 * Booking V2 B7A.5 / B8.5 — DB-backed availability resolver.
 *
 * When BOOKING_V2_HOT_CACHE=on:
 *   revision batch → L1 lookup → rebuild miss set only (read-through).
 * When off: full SoT preload (legacy B7A path).
 *
 * Cache is never write correctness authority.
 */

import 'server-only';
import { getCairoBusinessDate, shiftCalendarDate } from '@/lib/businessDate';
import {
  composeEmployeeDayAvailabilityV2,
  dayOfWeekFromYmd,
  type ResolveBookingAvailabilityV2PreloadedDay,
  type ResolveBookingAvailabilityV2Result,
  type V2EmployeeDayAvailability,
} from '@/lib/booking/projection/resolveBookingAvailabilityV2';
import {
  loadWeeklyBaselineSourceInputsBatch,
  weeklyBaselineBatchKeyString,
} from '@/lib/booking/projection/loadWeeklyBaselineBatch';
import { loadEffectiveDayLayerInputsRangeBatch } from '@/lib/booking/projection/loadEffectiveDayLayersBatch';
import {
  loadBookingOccupancyIntervalsRangeBatch,
  loadHoldOccupancyIntervalsRangeBatch,
  loadQueueOccupancyIntervalsBatch,
  sliceBookingOccupancyForDate,
  sliceHoldOccupancyForDate,
} from '@/lib/booking/projection/loadOccupancyBatch';
import { parseDayOfWeek } from '@/lib/booking/domain/WeeklyBaseline';
import { createSingleFlight } from '@/lib/booking/cache/singleFlight';

export type ResolveBookingAvailabilityV2Args = {
  employeeIds: number[];
  branchIds: number[];
  businessDateRange: { from: string; to: string };
  durationMinutes: number;
  slotIntervalMinutes?: number;
  source?: 'public' | 'operations' | 'admin';
  nowMs?: number;
  minNoticeMinutes?: number;
  /** When false, skip queue layer (future public days). Default: auto by date. */
  includeQueue?: boolean;
  /** Force full DB path (tests / admin). */
  bypassHotCache?: boolean;
  /**
   * When false, skip duration start generation (matrix FreeMask path).
   * FreeMask itself is never duration-keyed. Default true.
   */
  includeStarts?: boolean;
};

export type HotCacheResolveStats = {
  hotCacheHit: number;
  hotCacheMiss: number;
  hotCacheStale: number;
  hotCacheRebuild: number;
  hotCacheCoalesced: number;
  revisionLookupMs: number;
  revisionQueryCount: number;
  revisionSoftHit?: boolean;
  rebuildDbMs: number;
  cacheReadMs: number;
};

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = shiftCalendarDate(cur, 1);
  }
  return out;
}

const rangeFlight = createSingleFlight<ResolveBookingAvailabilityV2Result>();

/**
 * Resolve V2 availability for N employees × date range × branches.
 */
export async function resolveBookingAvailabilityV2(
  args: ResolveBookingAvailabilityV2Args,
): Promise<ResolveBookingAvailabilityV2Result & { hotCache?: HotCacheResolveStats }> {
  const { resolveHotCacheEnabled } = await import(
    '@/lib/booking/cache/buildHotDayPayload'
  );
  const useHot =
    !args.bypassHotCache && resolveHotCacheEnabled();

  if (!useHot) {
    return resolveBookingAvailabilityV2FullDb(args);
  }

  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((a, b) => a - b);
  const branchIds = [
    ...new Set(args.branchIds.filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((a, b) => a - b);
  const flightKey = [
    'v2rt',
    empIds.join(','),
    branchIds.join(','),
    args.businessDateRange.from,
    args.businessDateRange.to,
    args.includeStarts === false ? 'mask' : `dur:${args.durationMinutes}`,
    args.slotIntervalMinutes ?? 15,
    args.source ?? 'public',
    args.minNoticeMinutes ?? 0,
    args.includeStarts === false ? 'nostarts' : 'starts',
  ].join('|');

  const { value, coalesced } = await rangeFlight.do(flightKey, () =>
    resolveBookingAvailabilityV2ReadThrough(args),
  );
  if (coalesced && value.hotCache) {
    value.hotCache = {
      ...value.hotCache,
      hotCacheCoalesced: value.hotCache.hotCacheCoalesced + 1,
    };
  }
  return value;
}

async function resolveBookingAvailabilityV2ReadThrough(
  args: ResolveBookingAvailabilityV2Args,
): Promise<ResolveBookingAvailabilityV2Result & { hotCache: HotCacheResolveStats }> {
  const t0 = performance.now();
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const branchIds = [
    ...new Set(args.branchIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const dates = eachDateInclusive(
    args.businessDateRange.from,
    args.businessDateRange.to,
  );
  const slotInterval = args.slotIntervalMinutes ?? 15;
  const nowMs = args.nowMs ?? Date.now();

  const emptyStats: HotCacheResolveStats = {
    hotCacheHit: 0,
    hotCacheMiss: 0,
    hotCacheStale: 0,
    hotCacheRebuild: 0,
    hotCacheCoalesced: 0,
    revisionLookupMs: 0,
    revisionQueryCount: 0,
    rebuildDbMs: 0,
    cacheReadMs: 0,
  };

  if (!empIds.length || !branchIds.length || !dates.length) {
    return {
      days: [],
      queryCount: 0,
      composeMs: 0,
      totalMs: 0,
      dbMs: 0,
      hotCache: emptyStats,
    };
  }

  const { getPartsOrEmpty, partsToRevisionToken } = await import(
    '@/lib/booking/cache/AvailabilityRevisionSqlStore'
  );
  const { loadAvailabilityRevisionBatchSoft } = await import(
    '@/lib/booking/cache/WarmMatrixContextCache'
  );
  const { getHotAvailabilityCache } = await import(
    '@/lib/booking/cache/HotAvailabilityCache'
  );
  const { composeV2DayFromHotPayload } = await import(
    '@/lib/booking/cache/composeV2DayFromHotPayload'
  );
  const { rebuildHotPayloadsForMissKeys } = await import(
    '@/lib/booking/cache/rebuildHotPayloadsForMissKeys'
  );
  const { hotAvailabilityDayKeyString } = await import(
    '@/lib/booking/cache/HotAvailabilityTypes'
  );

  const cache = getHotAvailabilityCache();

  const tRev0 = performance.now();
  const revBatch = await loadAvailabilityRevisionBatchSoft({
    employeeIds: empIds,
    fromBusinessDate: args.businessDateRange.from,
    toBusinessDate: args.businessDateRange.to,
  });

  const stats: HotCacheResolveStats = {
    ...emptyStats,
    revisionLookupMs: revBatch.softHit
      ? performance.now() - tRev0
      : revBatch.dbMs,
    revisionQueryCount: revBatch.queryCount,
    revisionSoftHit: revBatch.softHit,
  };

  type WorkItem = {
    employeeId: number;
    branchId: number;
    businessDate: string;
    expectedRevision: string;
  };

  const work: WorkItem[] = [];
  for (const branchId of branchIds) {
    for (const empId of empIds) {
      for (const date of dates) {
        const parts = getPartsOrEmpty(revBatch.byKey, empId, date);
        // Keep process board in sync with SQL for local bump paths.
        cache.revisionBoard.note({
          employeeId: empId,
          businessDate: date,
          ...parts,
        });
        work.push({
          employeeId: empId,
          branchId,
          businessDate: date,
          expectedRevision: partsToRevisionToken(parts),
        });
      }
    }
  }

  const daysOut: V2EmployeeDayAvailability[] = [];
  const misses: WorkItem[] = [];
  let composeMs = 0;
  const tCache0 = performance.now();

  for (const item of work) {
    const key = {
      employeeId: item.employeeId,
      branchId: item.branchId,
      businessDate: item.businessDate,
    };
    const cached = cache.getCached(key);
    if (
      cached &&
      cached.availabilityRevision === item.expectedRevision
    ) {
      stats.hotCacheHit++;
      const tc = performance.now();
      daysOut.push(
        composeV2DayFromHotPayload({
          ...key,
          payload: cached,
          durationMinutes: args.durationMinutes,
          slotIntervalMinutes: slotInterval,
          nowMs: args.includeStarts === false ? undefined : nowMs,
          minNoticeMinutes: args.minNoticeMinutes,
          includeStarts: args.includeStarts,
        }),
      );
      composeMs += performance.now() - tc;
    } else {
      if (cached && cached.availabilityRevision !== item.expectedRevision) {
        stats.hotCacheStale++;
        await cache.invalidateDay(key, 'revision_mismatch');
      }
      stats.hotCacheMiss++;
      misses.push(item);
    }
  }
  stats.cacheReadMs = performance.now() - tCache0;

  let queryCount = revBatch.queryCount;
  let dbMs = revBatch.dbMs;

  if (misses.length) {
    const missKeys = misses.map((m) => ({
      employeeId: m.employeeId,
      branchId: m.branchId,
      businessDate: m.businessDate,
    }));
    // Coalesce concurrent rebuilds of the same miss set via day-level flight inside cache.
    const rebuilt = await rebuildHotPayloadsForMissKeys({
      keys: missKeys,
      revisionPartsByEmpDate: revBatch.byKey,
      source: args.source,
      nowMs,
      includeQueue: args.includeQueue,
    });
    stats.rebuildDbMs = rebuilt.dbMs;
    stats.hotCacheRebuild = misses.length;
    queryCount += rebuilt.queryCount;
    dbMs += rebuilt.dbMs;

    for (const item of misses) {
      const key = {
        employeeId: item.employeeId,
        branchId: item.branchId,
        businessDate: item.businessDate,
      };
      const keyStr = hotAvailabilityDayKeyString(key);
      let payload = rebuilt.byKey.get(keyStr);
      if (!payload) {
        // No weekly baseline → empty day
        continue;
      }
      // Stamp expected SQL revision so L1 matches next lookup.
      const parts = getPartsOrEmpty(
        revBatch.byKey,
        item.employeeId,
        item.businessDate,
      );
      payload = {
        ...payload,
        parts,
        availabilityRevision: item.expectedRevision,
        builtAtMs: Date.now(),
      };
      await cache.put(key, payload);
      const tc = performance.now();
      daysOut.push(
        composeV2DayFromHotPayload({
          ...key,
          payload,
          durationMinutes: args.durationMinutes,
          slotIntervalMinutes: slotInterval,
          nowMs: args.includeStarts === false ? undefined : nowMs,
          minNoticeMinutes: args.minNoticeMinutes,
          includeStarts: args.includeStarts,
        }),
      );
      composeMs += performance.now() - tc;
    }
  }

  const totalMs = performance.now() - t0;
  try {
    const { logHotCacheMetric } = await import(
      '@/lib/booking/cache/HotCacheMetrics'
    );
    logHotCacheMetric({
      event: 'read_through',
      hotCacheHit: stats.hotCacheHit,
      hotCacheMiss: stats.hotCacheMiss,
      hotCacheStale: stats.hotCacheStale,
      hotCacheRebuild: stats.hotCacheRebuild,
      hotCacheCoalesced: stats.hotCacheCoalesced,
      revisionLookupMs: stats.revisionLookupMs,
      rebuildDbMs: stats.rebuildDbMs,
      cacheReadMs: stats.cacheReadMs,
      totalMs,
      queryCount,
      empCount: empIds.length,
      branchCount: branchIds.length,
      dayCount: dates.length,
    });
  } catch {
    /* optional */
  }

  return {
    days: daysOut,
    queryCount,
    composeMs,
    totalMs,
    dbMs,
    hotCache: stats,
  };
}

/** Full DB preload path (hot cache off / bypass). */
async function resolveBookingAvailabilityV2FullDb(
  args: ResolveBookingAvailabilityV2Args,
): Promise<ResolveBookingAvailabilityV2Result> {
  const t0 = performance.now();
  let queryCount = 0;
  let dbMs = 0;
  const markDb = async <T>(p: Promise<T>): Promise<T> => {
    const s = performance.now();
    const v = await p;
    dbMs += performance.now() - s;
    return v;
  };

  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const branchIds = [
    ...new Set(args.branchIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const dates = eachDateInclusive(args.businessDateRange.from, args.businessDateRange.to);
  const slotInterval = args.slotIntervalMinutes ?? 15;
  const source = args.source ?? 'public';
  const today = getCairoBusinessDate(args.nowMs != null ? new Date(args.nowMs) : undefined);
  const nowMs = args.nowMs ?? Date.now();
  const asOfDate = args.businessDateRange.to;

  if (!empIds.length || !branchIds.length || !dates.length) {
    return { days: [], queryCount: 0, composeMs: 0, totalMs: 0, dbMs: 0 };
  }

  const weeklyUnique = new Map<
    string,
    { employeeId: number; branchId: number; dayOfWeek: number; asOfDate: string }
  >();
  for (const branchId of branchIds) {
    for (const empId of empIds) {
      for (const date of dates) {
        const dow = parseDayOfWeek(dayOfWeekFromYmd(date));
        const key = `${empId}:${branchId}:${dow}:${asOfDate}`;
        if (!weeklyUnique.has(key)) {
          weeklyUnique.set(key, {
            employeeId: empId,
            branchId,
            dayOfWeek: dow,
            asOfDate,
          });
        }
      }
    }
  }

  const queueDates = [
    ...new Set(
      dates.filter(
        (d) => args.includeQueue ?? !(source === 'public' && d > today),
      ),
    ),
  ];

  const [weeklyBatch, bookingsRange, holdsRange, ...layerPacks] = await Promise.all([
    markDb(loadWeeklyBaselineSourceInputsBatch([...weeklyUnique.values()])),
    markDb(
      loadBookingOccupancyIntervalsRangeBatch({
        employeeIds: empIds,
        from: args.businessDateRange.from,
        to: args.businessDateRange.to,
      }),
    ),
    markDb(
      loadHoldOccupancyIntervalsRangeBatch({
        employeeIds: empIds,
        from: args.businessDateRange.from,
        to: args.businessDateRange.to,
        nowMs,
      }),
    ),
    ...branchIds.map((branchId) =>
      markDb(
        loadEffectiveDayLayerInputsRangeBatch({
          employeeIds: empIds,
          branchId,
          from: args.businessDateRange.from,
          to: args.businessDateRange.to,
        }),
      ),
    ),
  ]);

  queryCount +=
    weeklyBatch.queryCount +
    bookingsRange.queryCount +
    holdsRange.queryCount +
    layerPacks.reduce((n, p) => n + p.queryCount, 0);

  const layersByBranch = new Map(
    branchIds.map((id, i) => [id, layerPacks[i]!] as const),
  );

  const queueByDate = new Map<
    string,
    Map<number, { id: number; startAtMs: number; endAtMs: number; branchId: number | null }[]>
  >();
  if (queueDates.length) {
    const queuePacks = await Promise.all(
      queueDates.map((date) =>
        markDb(
          loadQueueOccupancyIntervalsBatch({
            employeeIds: empIds,
            businessDate: date,
            now: new Date(nowMs),
            includeNextDay: true,
          }),
        ),
      ),
    );
    for (let i = 0; i < queueDates.length; i++) {
      const pack = queuePacks[i]!;
      queueByDate.set(queueDates[i]!, pack.byEmpId);
      queryCount += pack.queryCount;
    }
  }

  const daysOut: V2EmployeeDayAvailability[] = [];
  const tCompose0 = performance.now();

  for (const branchId of branchIds) {
    const layersPack = layersByBranch.get(branchId)!;
    for (const date of dates) {
      const loadQueueForDate =
        args.includeQueue ?? !(source === 'public' && date > today);
      const bookingsByEmp = sliceBookingOccupancyForDate(
        bookingsRange.allByEmpId,
        empIds,
        date,
      );
      const holdsByEmp = sliceHoldOccupancyForDate(
        holdsRange.allByEmpId,
        empIds,
        date,
      );

      for (const empId of empIds) {
        const dow = parseDayOfWeek(dayOfWeekFromYmd(date));
        const wkKey = weeklyBaselineBatchKeyString({
          employeeId: empId,
          branchId,
          dayOfWeek: dow,
          asOfDate,
        });
        const weekly = weeklyBatch.byKey.get(wkKey);
        if (!weekly) continue;

        const weeklyForCompose = {
          ...weekly,
          branchHours: null as typeof weekly.branchHours,
        };

        const preloaded: ResolveBookingAvailabilityV2PreloadedDay = {
          employeeId: empId,
          branchId,
          businessDate: date,
          weeklyBaselineInputs: weeklyForCompose,
          layers: layersPack.byEmpDate.get(`${empId}:${date}`) ?? {
            blockRanges: [],
            dailyAdjustments: [],
          },
          bookingIntervals: bookingsByEmp.get(empId) ?? [],
          holdIntervals: (holdsByEmp.get(empId) ?? []).map((h) => ({
            id: h.id,
            startAtMs: h.startAtMs,
            endAtMs: h.endAtMs,
            branchId: h.branchId,
          })),
          queueIntervals: loadQueueForDate
            ? queueByDate.get(date)?.get(empId) ?? []
            : [],
        };

        daysOut.push(
          composeEmployeeDayAvailabilityV2({
            day: preloaded,
            durationMinutes: args.durationMinutes,
            slotIntervalMinutes: slotInterval,
            nowMs: args.includeStarts === false ? undefined : nowMs,
            minNoticeMinutes: args.minNoticeMinutes,
            includeStarts: args.includeStarts,
          }),
        );
      }
    }
  }

  return {
    days: daysOut,
    queryCount,
    composeMs: performance.now() - tCompose0,
    totalMs: performance.now() - t0,
    dbMs,
  };
}
