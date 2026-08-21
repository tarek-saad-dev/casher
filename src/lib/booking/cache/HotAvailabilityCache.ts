/**
 * Booking V2 B8 — Hot Availability Cache (L1 + optional L2).
 *
 * Caches Emp×Branch×BusinessDate raw masks keyed by AvailabilityRevision.
 * Duration / slotInterval applied at read via AvailabilityComposer — never cached.
 * Cache is speed-only; writes must not treat cache as SoT.
 */

import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  createAvailabilityRevisionBoard,
  deriveAvailabilityRevision,
  type AvailabilityRevisionBoard,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';
import { BoundedLruCache } from '@/lib/booking/cache/BoundedLruCache';
import { createSingleFlight } from '@/lib/booking/cache/singleFlight';
import {
  createHotCacheMetrics,
  logHotCacheMetric,
  type HotCacheMetrics,
  type HotCacheMetricsSnapshot,
} from '@/lib/booking/cache/HotCacheMetrics';
import {
  createNullHotAvailabilityL2Store,
  type HotAvailabilityL2Store,
} from '@/lib/booking/cache/HotAvailabilityL2';
import {
  decodeHotAvailabilityDay,
  encodeHotAvailabilityDay,
  estimateHotAvailabilityRecordBytes,
  hotAvailabilityDayKeyString,
  type HotAvailabilityDayKey,
  type HotAvailabilityDayPayload,
  type HotAvailabilityDayRecord,
} from '@/lib/booking/cache/HotAvailabilityTypes';
import type { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';

export type HotAvailabilityRebuildFn = (
  key: HotAvailabilityDayKey,
) => Promise<HotAvailabilityDayPayload>;

export type HotAvailabilityCacheOptions = {
  maxEntries?: number;
  maxBytes?: number;
  /** Soft age for SWR when revision still matches (ms). Default 2s. */
  softTtlMs?: number;
  /** Enable short stale-while-revalidate for reads only. Default true. */
  allowStaleWhileRevalidate?: boolean;
  l2?: HotAvailabilityL2Store;
  revisionBoard?: AvailabilityRevisionBoard;
  metrics?: HotCacheMetrics;
  logEvents?: boolean;
};

export type HotAvailabilityGetResult = {
  payload: HotAvailabilityDayPayload;
  source: 'l1' | 'l2' | 'rebuild' | 'coalesced' | 'stale';
  latencyMs: number;
};

export type HotAvailabilityCache = {
  getOrRebuild(
    key: HotAvailabilityDayKey,
    rebuild: HotAvailabilityRebuildFn,
    opts?: { expectedRevision?: string; allowStale?: boolean },
  ): Promise<HotAvailabilityGetResult>;
  put(key: HotAvailabilityDayKey, payload: HotAvailabilityDayPayload): Promise<void>;
  invalidateDay(key: HotAvailabilityDayKey, reason?: string): Promise<void>;
  invalidateEmployeeDays(args: {
    employeeId: number;
    businessDates: string[];
    branchIds?: number[];
    reason?: string;
  }): Promise<void>;
  getCached(key: HotAvailabilityDayKey): HotAvailabilityDayPayload | null;
  composeStarts(args: {
    freeMask: AvailabilityBitmap;
    durationMinutes: number;
    slotIntervalMinutes?: number;
  }): number[];
  revisionBoard: AvailabilityRevisionBoard;
  metrics(): HotCacheMetricsSnapshot;
  clear(): void;
  l1Size(): number;
};

const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_SOFT_TTL_MS = 2_000;

export function createHotAvailabilityCache(
  opts?: HotAvailabilityCacheOptions,
): HotAvailabilityCache {
  const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const softTtlMs = opts?.softTtlMs ?? DEFAULT_SOFT_TTL_MS;
  const allowSwr = opts?.allowStaleWhileRevalidate !== false;
  const l2 = opts?.l2 ?? createNullHotAvailabilityL2Store();
  const revisionBoard = opts?.revisionBoard ?? createAvailabilityRevisionBoard();
  const metrics = opts?.metrics ?? createHotCacheMetrics();
  const logEvents = opts?.logEvents === true;

  const l1 = new BoundedLruCache<HotAvailabilityDayRecord>({
    maxEntries,
    maxBytes,
    sizeOf: (v) =>
      estimateHotAvailabilityRecordBytes(v as HotAvailabilityDayRecord),
  });
  const flight = createSingleFlight<HotAvailabilityDayPayload>();

  const expectedRevisionFor = (key: HotAvailabilityDayKey): string =>
    revisionBoard.availabilityRevision(key.employeeId, key.businessDate);

  const emit = (event: string, extra?: Record<string, unknown>) => {
    if (!logEvents) return;
    logHotCacheMetric({ event, ...extra });
  };

  const isFresh = (record: HotAvailabilityDayRecord, nowMs: number): boolean =>
    nowMs - record.builtAtMs <= softTtlMs;

  async function put(
    key: HotAvailabilityDayKey,
    payload: HotAvailabilityDayPayload,
  ): Promise<void> {
    const record = encodeHotAvailabilityDay(key, {
      ...payload,
      builtAtMs: payload.builtAtMs || Date.now(),
    });
    const keyStr = hotAvailabilityDayKeyString(key);
    const beforeEvict = l1.stats().evictions;
    l1.set(keyStr, record);
    const afterEvict = l1.stats().evictions;
    if (afterEvict > beforeEvict) {
      metrics.record('eviction');
      emit('eviction', { key: keyStr });
    }
    await l2.set(keyStr, record);
  }

  async function invalidateDay(
    key: HotAvailabilityDayKey,
    reason?: string,
  ): Promise<void> {
    const keyStr = hotAvailabilityDayKeyString(key);
    l1.delete(keyStr);
    await l2.delete(keyStr);
    emit('invalidate', { key: keyStr, reason: reason ?? null });
  }

  async function readL1OrL2(
    keyStr: string,
  ): Promise<{ record: HotAvailabilityDayRecord; from: 'l1' | 'l2' } | null> {
    const local = l1.get(keyStr);
    if (local) return { record: local, from: 'l1' };
    const remote = await l2.get(keyStr);
    if (remote) {
      metrics.record('l2_hit');
      l1.set(keyStr, remote);
      return { record: remote, from: 'l2' };
    }
    metrics.record('l2_miss');
    return null;
  }

  const api: HotAvailabilityCache = {
    revisionBoard,

    async getOrRebuild(key, rebuild, getOpts) {
      const t0 = performance.now();
      const keyStr = hotAvailabilityDayKeyString(key);
      const expected =
        getOpts?.expectedRevision ?? expectedRevisionFor(key);
      const nowMs = Date.now();
      const allowStale = getOpts?.allowStale !== false && allowSwr;

      const cached = await readL1OrL2(keyStr);
      if (cached) {
        if (cached.record.availabilityRevision === expected) {
          if (isFresh(cached.record, nowMs)) {
            const latencyMs = performance.now() - t0;
            metrics.record('hit', latencyMs);
            emit('hit', { key: keyStr, latencyMs, source: cached.from });
            return {
              payload: decodeHotAvailabilityDay(cached.record),
              source: cached.from,
              latencyMs,
            };
          }
          if (allowStale) {
            const latencyMs = performance.now() - t0;
            metrics.record('stale', latencyMs);
            emit('stale', { key: keyStr, latencyMs });
            void flight.do(`${keyStr}:swr`, async () => {
              const payload = await rebuild(key);
              const stamped: HotAvailabilityDayPayload = {
                ...payload,
                availabilityRevision:
                  payload.availabilityRevision ||
                  deriveAvailabilityRevision(payload.parts),
                builtAtMs: Date.now(),
              };
              await put(key, stamped);
              return stamped;
            });
            return {
              payload: decodeHotAvailabilityDay(cached.record),
              source: 'stale',
              latencyMs,
            };
          }
        } else {
          metrics.record('revision_mismatch');
          emit('revision_mismatch', {
            key: keyStr,
            cached: cached.record.availabilityRevision,
            expected,
          });
          await invalidateDay(key, 'revision_mismatch');
        }
      }

      metrics.record('miss');
      emit('miss', { key: keyStr });

      const { value, coalesced } = await flight.do(keyStr, async () => {
        const rt0 = performance.now();
        const payload = await rebuild(key);
        const stamped: HotAvailabilityDayPayload = {
          ...payload,
          availabilityRevision:
            payload.availabilityRevision ||
            deriveAvailabilityRevision(payload.parts),
          builtAtMs: Date.now(),
        };
        await put(key, stamped);
        metrics.record('rebuild', performance.now() - rt0);
        emit('rebuild', { key: keyStr, rebuildMs: performance.now() - rt0 });
        return stamped;
      });

      if (coalesced) {
        metrics.record('coalesced');
        emit('coalesced', { key: keyStr });
      }

      return {
        payload: value,
        source: coalesced ? 'coalesced' : 'rebuild',
        latencyMs: performance.now() - t0,
      };
    },

    put,
    invalidateDay,

    async invalidateEmployeeDays(args) {
      const branchFilter = args.branchIds?.length
        ? new Set(args.branchIds)
        : null;
      for (const k of l1.keys()) {
        const parts = k.split(':');
        if (parts.length < 4) continue;
        const emp = Number(parts[1]);
        const branch = Number(parts[2]);
        const date = parts.slice(3).join(':');
        if (emp !== args.employeeId) continue;
        if (!args.businessDates.includes(date)) continue;
        if (branchFilter && !branchFilter.has(branch)) continue;
        l1.delete(k);
        await l2.delete(k);
      }
      emit('invalidate_employee_days', {
        employeeId: args.employeeId,
        dates: args.businessDates.length,
        reason: args.reason ?? null,
      });
    },

    getCached(key) {
      const rec = l1.peek(hotAvailabilityDayKeyString(key));
      return rec ? decodeHotAvailabilityDay(rec) : null;
    },

    composeStarts(args) {
      return AvailabilityComposer.generateStarts({
        freeMask: args.freeMask,
        durationMinutes: args.durationMinutes,
        slotIntervalMinutes: args.slotIntervalMinutes,
      });
    },

    metrics() {
      const s = l1.stats();
      return metrics.snapshot({ approxBytes: s.bytes, entries: s.size });
    },

    clear() {
      l1.clear();
      metrics.reset();
      flight.resetStats();
    },

    l1Size() {
      return l1.stats().size;
    },
  };

  return api;
}

let singleton: HotAvailabilityCache | null = null;

export function getHotAvailabilityCache(): HotAvailabilityCache {
  if (!singleton) singleton = createHotAvailabilityCache();
  return singleton;
}

export function __resetHotAvailabilityCacheForTests(
  cache?: HotAvailabilityCache | null,
): void {
  singleton = cache === undefined ? null : cache;
}

export type { AvailabilityRevisionParts };
