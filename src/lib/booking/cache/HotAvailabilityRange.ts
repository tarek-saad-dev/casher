/**
 * Booking V2 B8 — 14-day range composition from day-level hot cache.
 * B8.5: batch revision tokens + rebuild only misses (coalesce overlapping).
 * Does NOT store a separate fat service-specific payload.
 */

import type { HotAvailabilityCache } from '@/lib/booking/cache/HotAvailabilityCache';
import type {
  HotAvailabilityDayKey,
  HotAvailabilityDayPayload,
} from '@/lib/booking/cache/HotAvailabilityTypes';
import { hotAvailabilityDayKeyString } from '@/lib/booking/cache/HotAvailabilityTypes';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import { shiftCalendarDate } from '@/lib/businessDate';
import { createSingleFlight } from '@/lib/booking/cache/singleFlight';

export type HotRangeDayResult = {
  key: HotAvailabilityDayKey;
  payload: HotAvailabilityDayPayload;
  starts: number[];
  source: string;
  latencyMs: number;
};

export type HotRangeComposeResult = {
  days: HotRangeDayResult[];
  totalMs: number;
  composeMs: number;
  cacheHits: number;
  cacheMisses: number;
  cacheStale: number;
  rebuildCount: number;
  revisionLookupMs: number;
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

const missFlight = createSingleFlight<Map<string, HotAvailabilityDayPayload>>();

/**
 * Resolve 1 employee × N days via day-cache lookups + duration compose only.
 * After warmup: should be cache hits + <1ms compose each.
 *
 * When `expectedRevisionForDate` is provided, stale revision entries are
 * treated as misses (cross-instance safe). Misses are rebuilt in one batch
 * via `rebuildMissKeys` when provided, else per-day `rebuild`.
 */
export async function composeHotAvailabilityRange(args: {
  cache: HotAvailabilityCache;
  employeeId: number;
  branchId: number;
  fromBusinessDate: string;
  toBusinessDate: string;
  durationMinutes: number;
  slotIntervalMinutes?: number;
  /** Lightweight revision token per businessDate (batch-fetched by caller). */
  expectedRevisionForDate?: (businessDate: string) => string;
  rebuild: (
    key: HotAvailabilityDayKey,
  ) => Promise<HotAvailabilityDayPayload>;
  /** Preferred: rebuild only the miss set in one SoT round-trip. */
  rebuildMissKeys?: (
    keys: HotAvailabilityDayKey[],
  ) => Promise<Map<string, HotAvailabilityDayPayload>>;
}): Promise<HotRangeComposeResult> {
  const t0 = performance.now();
  const dates = eachDateInclusive(args.fromBusinessDate, args.toBusinessDate);
  const days: HotRangeDayResult[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheStale = 0;
  let rebuildCount = 0;
  let composeMs = 0;
  const revisionLookupMs = 0;

  type Item = {
    key: HotAvailabilityDayKey;
    expected?: string;
    cached: HotAvailabilityDayPayload | null;
  };

  const items: Item[] = dates.map((businessDate) => {
    const key: HotAvailabilityDayKey = {
      employeeId: args.employeeId,
      branchId: args.branchId,
      businessDate,
    };
    const cached = args.cache.getCached(key);
    const expected = args.expectedRevisionForDate?.(businessDate);
    return { key, expected, cached };
  });

  const misses: HotAvailabilityDayKey[] = [];
  const hitPayloads = new Map<string, HotAvailabilityDayPayload>();

  for (const item of items) {
    const keyStr = hotAvailabilityDayKeyString(item.key);
    if (
      item.cached &&
      (item.expected == null ||
        item.cached.availabilityRevision === item.expected)
    ) {
      cacheHits++;
      hitPayloads.set(keyStr, item.cached);
    } else {
      if (
        item.cached &&
        item.expected != null &&
        item.cached.availabilityRevision !== item.expected
      ) {
        cacheStale++;
        await args.cache.invalidateDay(item.key, 'revision_mismatch');
      }
      cacheMisses++;
      misses.push(item.key);
    }
  }

  if (misses.length) {
    const flightKey = [
      'range',
      args.employeeId,
      args.branchId,
      args.fromBusinessDate,
      args.toBusinessDate,
      misses.map((m) => m.businessDate).join(','),
    ].join('|');

    const { value: rebuilt } = await missFlight.do(flightKey, async () => {
      if (args.rebuildMissKeys) {
        return args.rebuildMissKeys(misses);
      }
      const map = new Map<string, HotAvailabilityDayPayload>();
      for (const key of misses) {
        const payload = await args.rebuild(key);
        const stamped: HotAvailabilityDayPayload = {
          ...payload,
          availabilityRevision:
            args.expectedRevisionForDate?.(key.businessDate) ??
            payload.availabilityRevision,
          builtAtMs: Date.now(),
        };
        await args.cache.put(key, stamped);
        map.set(hotAvailabilityDayKeyString(key), stamped);
      }
      return map;
    });

    rebuildCount = misses.length;
    for (const key of misses) {
      const keyStr = hotAvailabilityDayKeyString(key);
      let payload = rebuilt.get(keyStr);
      if (!payload) {
        payload = await args.rebuild(key);
      }
      const stamped: HotAvailabilityDayPayload = {
        ...payload,
        availabilityRevision:
          args.expectedRevisionForDate?.(key.businessDate) ??
          payload.availabilityRevision,
        builtAtMs: Date.now(),
      };
      await args.cache.put(key, stamped);
      hitPayloads.set(keyStr, stamped);
    }
  }

  for (const item of items) {
    const keyStr = hotAvailabilityDayKeyString(item.key);
    const payload = hitPayloads.get(keyStr);
    if (!payload) continue;
    const tc = performance.now();
    const starts = AvailabilityComposer.generateStarts({
      freeMask: payload.freeMask,
      durationMinutes: args.durationMinutes,
      slotIntervalMinutes: args.slotIntervalMinutes,
    });
    composeMs += performance.now() - tc;
    days.push({
      key: item.key,
      payload,
      starts,
      source: misses.some(
        (m) =>
          m.businessDate === item.key.businessDate &&
          m.branchId === item.key.branchId,
      )
        ? 'rebuild'
        : 'l1',
      latencyMs: 0,
    });
  }

  return {
    days,
    totalMs: performance.now() - t0,
    composeMs,
    cacheHits,
    cacheMisses,
    cacheStale,
    rebuildCount,
    revisionLookupMs,
  };
}
