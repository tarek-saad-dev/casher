/**
 * Booking V2 B5 — BookingOccupancyProjection
 *
 * Key: EmpID + BusinessDate (global EmpID — any Branch occupies the same timeline).
 * Occupancy mask bit=1 ⇒ occupied by a confirmed/active booking.
 *
 * Rebuildable from SoT intervals. Incremental create/cancel/reschedule supported
 * with safe recompute on clear. Cache/projection is NOT source of truth.
 */

import {
  createEmptyOccupancyDay,
  createOccupancyMemoryStore,
  occupancyApplyClear,
  occupancyApplyReschedule,
  occupancyApplySet,
  occupancyDayToRecord,
  rebuildOccupancyDayFromIntervals,
  type OccupancyDayRecord,
  type OccupancyDayState,
  type OccupancyMemoryStore,
  type OccupancyOverlapWarning,
} from '@/lib/booking/projection/OccupancyDayState';
import {
  parseOccupancyDayKey,
  type AbsoluteOccupancyInterval,
  type OccupancyDayKey,
} from '@/lib/booking/projection/OccupancyTimeline';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';

export type BookingOccupancyProjectionService = {
  /** Full rebuild from SoT booking intervals for one Emp×BusinessDate. */
  rebuild(args: {
    key: OccupancyDayKey;
    intervals: AbsoluteOccupancyInterval[];
    nowMs?: number;
  }): OccupancyDayRecord;
  get(key: OccupancyDayKey): OccupancyDayRecord | null;
  /** Booking created → set occupied range. */
  onBookingCreated(args: {
    key: OccupancyDayKey;
    interval: AbsoluteOccupancyInterval;
    nowMs?: number;
  }): OccupancyDayRecord;
  /** Booking cancelled → safe clear/recompute. */
  onBookingCancelled(args: {
    key: OccupancyDayKey;
    bookingId: number;
    nowMs?: number;
  }): OccupancyDayRecord | null;
  /** Reschedule → remove old + add new. */
  onBookingRescheduled(args: {
    key: OccupancyDayKey;
    oldBookingId: number;
    newInterval: AbsoluteOccupancyInterval;
    nowMs?: number;
  }): OccupancyDayRecord;
  /** Pure: paint intervals without touching store. */
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

export function createBookingOccupancyProjectionService(opts?: {
  store?: OccupancyMemoryStore;
}): BookingOccupancyProjectionService {
  const store = opts?.store ?? createOccupancyMemoryStore();

  return {
    store,
    buildMask(intervals, key) {
      return rebuildOccupancyDayFromIntervals({
        key,
        source: 'booking',
        intervals,
      }).mask;
    },
    rebuild(args) {
      const state = rebuildOccupancyDayFromIntervals({
        key: args.key,
        source: 'booking',
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
    onBookingCreated(args) {
      const base = ensureState(store, args.key, args.nowMs);
      const { state } = occupancyApplySet({
        state: base,
        source: 'booking',
        interval: args.interval,
        nowMs: args.nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    onBookingCancelled(args) {
      const base = store.get(args.key);
      if (!base) return null;
      const state = occupancyApplyClear({
        state: base,
        source: 'booking',
        id: args.bookingId,
        nowMs: args.nowMs,
      });
      store.put(state);
      return occupancyDayToRecord(state);
    },
    onBookingRescheduled(args) {
      const base = ensureState(store, args.key, args.nowMs);
      const state = occupancyApplyReschedule({
        state: base,
        source: 'booking',
        oldId: args.oldBookingId,
        newInterval: args.newInterval,
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

export type { OccupancyOverlapWarning, OccupancyDayRecord };
export const BookingOccupancyProjection = createBookingOccupancyProjectionService();
