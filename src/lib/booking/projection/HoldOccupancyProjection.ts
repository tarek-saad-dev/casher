/**
 * Booking V2 B5 — ActiveHoldOccupancyProjection
 *
 * Built from active, unexpired holds. EmpID is global across branches.
 * Respects TTL / expiry / consumed / released (only active+unexpired occupy).
 */

import {
  createEmptyOccupancyDay,
  createOccupancyMemoryStore,
  occupancyApplyClear,
  occupancyApplySet,
  occupancyDayToRecord,
  rebuildOccupancyDayFromIntervals,
  type OccupancyDayRecord,
  type OccupancyDayState,
  type OccupancyMemoryStore,
} from '@/lib/booking/projection/OccupancyDayState';
import {
  parseOccupancyDayKey,
  type AbsoluteOccupancyInterval,
  type OccupancyDayKey,
} from '@/lib/booking/projection/OccupancyTimeline';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';

export type HoldOccupancyInterval = AbsoluteOccupancyInterval & {
  expiresAtMs: number;
  status: 'active' | 'consumed' | 'released' | 'expired';
};

/** Keep only holds that still block the slot at `nowMs`. */
export function filterActiveUnexpiredHolds(
  holds: HoldOccupancyInterval[],
  nowMs: number,
): AbsoluteOccupancyInterval[] {
  return holds
    .filter(
      (h) =>
        h.status === 'active' &&
        h.expiresAtMs > nowMs &&
        h.endAtMs > h.startAtMs,
    )
    .map(({ id, startAtMs, endAtMs, branchId }) => ({
      id,
      startAtMs,
      endAtMs,
      branchId,
    }));
}

export type HoldOccupancyProjectionService = {
  rebuild(args: {
    key: OccupancyDayKey;
    holds: HoldOccupancyInterval[];
    nowMs?: number;
  }): OccupancyDayRecord;
  get(key: OccupancyDayKey): OccupancyDayRecord | null;
  onHoldCreated(args: {
    key: OccupancyDayKey;
    hold: HoldOccupancyInterval;
    nowMs?: number;
  }): OccupancyDayRecord;
  onHoldReleasedOrConsumedOrExpired(args: {
    key: OccupancyDayKey;
    holdId: number;
    nowMs?: number;
  }): OccupancyDayRecord | null;
  /** Drop holds that expired since last build (safe clear + recompute). */
  expireHolds(args: {
    key: OccupancyDayKey;
    nowMs: number;
    /** Hold ids known expired / inactive. */
    expiredHoldIds: number[];
  }): OccupancyDayRecord | null;
  buildMask(
    holds: HoldOccupancyInterval[],
    key: OccupancyDayKey,
    nowMs?: number,
  ): AvailabilityBitmap;
  revision(key: OccupancyDayKey): number;
  store: OccupancyMemoryStore;
};

function ensureState(
  store: OccupancyMemoryStore,
  key: OccupancyDayKey,
  nowMs?: number,
): OccupancyDayState {
  return store.get(key) ?? createEmptyOccupancyDay(key, { nowMs });
}

export function createHoldOccupancyProjectionService(opts?: {
  store?: OccupancyMemoryStore;
}): HoldOccupancyProjectionService {
  const store = opts?.store ?? createOccupancyMemoryStore();

  return {
    store,
    buildMask(holds, key, nowMs = Date.now()) {
      return rebuildOccupancyDayFromIntervals({
        key,
        source: 'hold',
        intervals: filterActiveUnexpiredHolds(holds, nowMs),
      }).mask;
    },
    rebuild(args) {
      const nowMs = args.nowMs ?? Date.now();
      const state = rebuildOccupancyDayFromIntervals({
        key: args.key,
        source: 'hold',
        intervals: filterActiveUnexpiredHolds(args.holds, nowMs),
        nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    get(key) {
      const state = store.get(parseOccupancyDayKey(key));
      return state ? occupancyDayToRecord(state) : null;
    },
    onHoldCreated(args) {
      const nowMs = args.nowMs ?? Date.now();
      const active = filterActiveUnexpiredHolds([args.hold], nowMs);
      if (!active.length) {
        return occupancyDayToRecord(ensureState(store, args.key, nowMs));
      }
      const base = ensureState(store, args.key, nowMs);
      const { state } = occupancyApplySet({
        state: base,
        source: 'hold',
        interval: active[0]!,
        nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    onHoldReleasedOrConsumedOrExpired(args) {
      const base = store.get(args.key);
      if (!base) return null;
      const state = occupancyApplyClear({
        state: base,
        source: 'hold',
        id: args.holdId,
        nowMs: args.nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    expireHolds(args) {
      let state = store.get(args.key);
      if (!state) return null;
      for (const holdId of args.expiredHoldIds) {
        state = occupancyApplyClear({
          state,
          source: 'hold',
          id: holdId,
          nowMs: args.nowMs,
        });
      }
      store.put(state);
      return occupancyDayToRecord(state);
    },
    revision(key) {
      return store.get(key)?.revision ?? 0;
    },
  };
}

export const HoldOccupancyProjection = createHoldOccupancyProjectionService();
