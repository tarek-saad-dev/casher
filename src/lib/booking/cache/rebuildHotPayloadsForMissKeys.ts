/**
 * Booking V2 B8.5 — rebuild hot payloads from SoT for a miss set only
 * (not full range preload when most days are warm).
 */

import 'server-only';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  dayOfWeekFromYmd,
  type ResolveBookingAvailabilityV2PreloadedDay,
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
import { buildHotDayPayloadFromPreloaded } from '@/lib/booking/cache/buildHotDayPayload';
import type { HotAvailabilityDayKey } from '@/lib/booking/cache/HotAvailabilityTypes';
import type { HotAvailabilityDayPayload } from '@/lib/booking/cache/HotAvailabilityTypes';
import type { AvailabilityRevisionParts } from '@/lib/booking/projection/AvailabilityRevision';
import { hotAvailabilityDayKeyString } from '@/lib/booking/cache/HotAvailabilityTypes';

export type RebuildMissSetResult = {
  byKey: Map<string, HotAvailabilityDayPayload>;
  queryCount: number;
  dbMs: number;
};

/**
 * Load SoT for only the Emp×Branch×Date keys that missed cache.
 * Groups into minimal date range + emp/branch sets.
 */
export async function rebuildHotPayloadsForMissKeys(args: {
  keys: HotAvailabilityDayKey[];
  revisionPartsByEmpDate: Map<string, AvailabilityRevisionParts>;
  source?: 'public' | 'operations' | 'admin';
  nowMs?: number;
  includeQueue?: boolean;
}): Promise<RebuildMissSetResult> {
  const byKey = new Map<string, HotAvailabilityDayPayload>();
  if (!args.keys.length) {
    return { byKey, queryCount: 0, dbMs: 0 };
  }

  let queryCount = 0;
  let dbMs = 0;
  const markDb = async <T>(p: Promise<T>): Promise<T> => {
    const s = performance.now();
    const v = await p;
    dbMs += performance.now() - s;
    return v;
  };

  const empIds = [...new Set(args.keys.map((k) => k.employeeId))];
  const branchIds = [...new Set(args.keys.map((k) => k.branchId))];
  const dates = [...new Set(args.keys.map((k) => k.businessDate))].sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const asOfDate = to;
  const source = args.source ?? 'public';
  const nowMs = args.nowMs ?? Date.now();
  const today = getCairoBusinessDate(new Date(nowMs));

  const weeklyUnique = new Map<
    string,
    { employeeId: number; branchId: number; dayOfWeek: number; asOfDate: string }
  >();
  for (const k of args.keys) {
    const dow = parseDayOfWeek(dayOfWeekFromYmd(k.businessDate));
    const key = `${k.employeeId}:${k.branchId}:${dow}:${asOfDate}`;
    if (!weeklyUnique.has(key)) {
      weeklyUnique.set(key, {
        employeeId: k.employeeId,
        branchId: k.branchId,
        dayOfWeek: dow,
        asOfDate,
      });
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
        from,
        to,
      }),
    ),
    markDb(
      loadHoldOccupancyIntervalsRangeBatch({
        employeeIds: empIds,
        from,
        to,
        nowMs,
      }),
    ),
    ...branchIds.map((branchId) =>
      markDb(
        loadEffectiveDayLayerInputsRangeBatch({
          employeeIds: empIds,
          branchId,
          from,
          to,
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
    // One occupancy loader call per distinct queue date (typically today only
    // for public future ranges). Not N×14 independent SoT trees.
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

  // In-memory: build N day payloads from the single batched SoT preload above.
  for (const k of args.keys) {
    const dow = parseDayOfWeek(dayOfWeekFromYmd(k.businessDate));
    const wkKey = weeklyBaselineBatchKeyString({
      employeeId: k.employeeId,
      branchId: k.branchId,
      dayOfWeek: dow,
      asOfDate,
    });
    const weekly = weeklyBatch.byKey.get(wkKey);
    if (!weekly) continue;

    const weeklyForCompose = {
      ...weekly,
      branchHours: null as typeof weekly.branchHours,
    };
    const layersPack = layersByBranch.get(k.branchId)!;
    const bookingsByEmp = sliceBookingOccupancyForDate(
      bookingsRange.allByEmpId,
      [k.employeeId],
      k.businessDate,
    );
    const holdsByEmp = sliceHoldOccupancyForDate(
      holdsRange.allByEmpId,
      [k.employeeId],
      k.businessDate,
    );
    const loadQueue =
      args.includeQueue ?? !(source === 'public' && k.businessDate > today);

    const preloaded: ResolveBookingAvailabilityV2PreloadedDay = {
      employeeId: k.employeeId,
      branchId: k.branchId,
      businessDate: k.businessDate,
      weeklyBaselineInputs: weeklyForCompose,
      layers: layersPack.byEmpDate.get(`${k.employeeId}:${k.businessDate}`) ?? {
        blockRanges: [],
        dailyAdjustments: [],
      },
      bookingIntervals: bookingsByEmp.get(k.employeeId) ?? [],
      holdIntervals: (holdsByEmp.get(k.employeeId) ?? []).map((h) => ({
        id: h.id,
        startAtMs: h.startAtMs,
        endAtMs: h.endAtMs,
        branchId: h.branchId,
      })),
      queueIntervals: loadQueue
        ? queueByDate.get(k.businessDate)?.get(k.employeeId) ?? []
        : [],
    };

    const parts =
      args.revisionPartsByEmpDate.get(`${k.employeeId}:${k.businessDate}`) ?? {
        effectiveWorkRevision: 0,
        bookingOccupancyRevision: 0,
        holdOccupancyRevision: 0,
        queueOccupancyRevision: 0,
      };

    const payload = buildHotDayPayloadFromPreloaded(preloaded, parts);
    byKey.set(hotAvailabilityDayKeyString(k), payload);
  }

  return { byKey, queryCount, dbMs };
}
