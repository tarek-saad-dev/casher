/**
 * Booking V2 B5/B7A — Queue occupancy (independent layer).
 *
 * DECISION (B7A): bookingAvailabilityEngine DOES include live QueueTickets in
 * public/ops availability busy intervals for today (and tomorrow when overnight).
 * Future public calendar days skip queue loads. Therefore FreeMask parity requires:
 *
 *   FreeMask = EffectiveWork ∧ ¬Booking ∧ ¬Hold ∧ ¬Queue
 *
 * Queue is NOT folded into BookingOccupancy — keep it separate for classification.
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

export type QueueOccupancyProjectionService = {
  rebuild(args: {
    key: OccupancyDayKey;
    intervals: AbsoluteOccupancyInterval[];
    nowMs?: number;
  }): OccupancyDayRecord;
  get(key: OccupancyDayKey): OccupancyDayRecord | null;
  onQueueSet(args: {
    key: OccupancyDayKey;
    interval: AbsoluteOccupancyInterval;
    nowMs?: number;
  }): OccupancyDayRecord;
  onQueueCleared(args: {
    key: OccupancyDayKey;
    queueTicketId: number;
    nowMs?: number;
  }): OccupancyDayRecord | null;
  buildMask(intervals: AbsoluteOccupancyInterval[], key: OccupancyDayKey): AvailabilityBitmap;
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

export function createQueueOccupancyProjectionService(opts?: {
  store?: OccupancyMemoryStore;
}): QueueOccupancyProjectionService {
  const store = opts?.store ?? createOccupancyMemoryStore();

  return {
    store,
    buildMask(intervals, key) {
      return rebuildOccupancyDayFromIntervals({
        key,
        source: 'queue',
        intervals,
      }).mask;
    },
    rebuild(args) {
      const state = rebuildOccupancyDayFromIntervals({
        key: args.key,
        source: 'queue',
        intervals: args.intervals,
        nowMs: args.nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    get(key) {
      const state = store.get(parseOccupancyDayKey(key));
      return state ? occupancyDayToRecord(state) : null;
    },
    onQueueSet(args) {
      const base = ensureState(store, args.key, args.nowMs);
      const { state } = occupancyApplySet({
        state: base,
        source: 'queue',
        interval: args.interval,
        nowMs: args.nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    onQueueCleared(args) {
      const base = store.get(args.key);
      if (!base) return null;
      const state = occupancyApplyClear({
        state: base,
        source: 'queue',
        id: args.queueTicketId,
        nowMs: args.nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    revision(key) {
      return store.get(key)?.revision ?? 0;
    },
  };
}

export const QueueOccupancyProjection = createQueueOccupancyProjectionService();

/** Documented decision constant for tests / ops. */
export const QUEUE_IN_PUBLIC_AVAILABILITY = true as const;
export const QUEUE_OCCUPANCY_DECISION =
  'INCLUDE_QUEUE_OCCUPANCY_FOR_PARITY_WITH_LIVE_ENGINE' as const;
