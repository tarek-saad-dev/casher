/**
 * Booking V2 B5 — generic Emp×BusinessDate occupancy day state.
 *
 * Bitmap convention for occupancy masks: bit=1 means OCCUPIED.
 * (EffectiveWork / FreeMask keep B3 convention: bit=1 means FREE.)
 *
 * Incremental clear never assumes freedom — affected ranges are safely
 * recomputed from remaining overlapping segments.
 */

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import {
  absoluteIntervalToTimelineMinutes,
  intervalsOverlapMs,
  occupancyDayKeyString,
  parseOccupancyDayKey,
  segmentId,
  type AbsoluteOccupancyInterval,
  type OccupancyDayKey,
} from '@/lib/booking/projection/OccupancyTimeline';
import { BOOKING_TZ } from '@/lib/booking/domain/BusinessDate';

export type OccupancySource = 'booking' | 'hold' | 'queue';

export type OccupancySegment = {
  segmentKey: string;
  source: OccupancySource;
  id: number;
  employeeId: number;
  businessDate: string;
  branchId: number | null;
  startAtMs: number;
  endAtMs: number;
  startMin: number;
  endMin: number;
};

export type OccupancyOverlapWarning = {
  segmentKey: string;
  otherSegmentKey: string;
  startAtMs: number;
  endAtMs: number;
};

export type OccupancyDayRecord = {
  key: { employeeId: number; businessDate: string };
  revision: number;
  /** Occupancy mask: bit=1 occupied. */
  mask: AvailabilityBitmap;
  segments: OccupancySegment[];
  overlapWarnings: OccupancyOverlapWarning[];
  builtAtMs: number;
};

function rebuildMask(segments: Iterable<OccupancySegment>): AvailabilityBitmap {
  const mask = AvailabilityBitmap.empty();
  for (const s of segments) mask.setRange(s.startMin, s.endMin);
  return mask;
}

function detectOverlaps(segments: OccupancySegment[]): OccupancyOverlapWarning[] {
  const warnings: OccupancyOverlapWarning[] = [];
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!;
      if (intervalsOverlapMs(a.startAtMs, a.endAtMs, b.startAtMs, b.endAtMs)) {
        warnings.push({
          segmentKey: a.segmentKey,
          otherSegmentKey: b.segmentKey,
          startAtMs: Math.max(a.startAtMs, b.startAtMs),
          endAtMs: Math.min(a.endAtMs, b.endAtMs),
        });
      }
    }
  }
  return warnings;
}

function toSegment(
  source: OccupancySource,
  key: { employeeId: number; businessDate: string },
  iv: AbsoluteOccupancyInterval,
  timeZone: string,
): OccupancySegment | null {
  const range = absoluteIntervalToTimelineMinutes({
    businessDate: key.businessDate,
    startAtMs: iv.startAtMs,
    endAtMs: iv.endAtMs,
    timeZone,
  });
  if (!range) return null;
  return {
    segmentKey: segmentId(source, iv.id),
    source,
    id: iv.id,
    employeeId: key.employeeId,
    businessDate: key.businessDate,
    branchId: iv.branchId,
    startAtMs: iv.startAtMs,
    endAtMs: iv.endAtMs,
    startMin: range.startMin,
    endMin: range.endMin,
  };
}

export type OccupancyDayState = {
  key: { employeeId: number; businessDate: string };
  revision: number;
  segments: Map<string, OccupancySegment>;
  mask: AvailabilityBitmap;
  overlapWarnings: OccupancyOverlapWarning[];
  builtAtMs: number;
};

export function createEmptyOccupancyDay(
  key: OccupancyDayKey,
  opts?: { revision?: number; nowMs?: number },
): OccupancyDayState {
  const parsed = parseOccupancyDayKey(key);
  return {
    key: { employeeId: parsed.employeeId, businessDate: String(parsed.businessDate) },
    revision: opts?.revision ?? 1,
    segments: new Map(),
    mask: AvailabilityBitmap.empty(),
    overlapWarnings: [],
    builtAtMs: opts?.nowMs ?? Date.now(),
  };
}

export function occupancyDayToRecord(state: OccupancyDayState): OccupancyDayRecord {
  return {
    key: state.key,
    revision: state.revision,
    mask: state.mask.clone(),
    segments: [...state.segments.values()].sort((a, b) => a.startAtMs - b.startAtMs),
    overlapWarnings: [...state.overlapWarnings],
    builtAtMs: state.builtAtMs,
  };
}

/** Full rebuild from absolute intervals (SoT). */
export function rebuildOccupancyDayFromIntervals(args: {
  key: OccupancyDayKey;
  source: OccupancySource;
  intervals: AbsoluteOccupancyInterval[];
  revision?: number;
  nowMs?: number;
  timeZone?: string;
}): OccupancyDayState {
  const state = createEmptyOccupancyDay(args.key, {
    revision: args.revision ?? 1,
    nowMs: args.nowMs,
  });
  const tz = args.timeZone ?? BOOKING_TZ;
  for (const iv of args.intervals) {
    const seg = toSegment(args.source, state.key, iv, tz);
    if (seg) state.segments.set(seg.segmentKey, seg);
  }
  state.mask = rebuildMask(state.segments.values());
  state.overlapWarnings = detectOverlaps([...state.segments.values()]);
  return state;
}

/**
 * Incremental: occupy range for a new segment.
 * Overlaps with existing segments are recorded (legacy collision detection).
 */
export function occupancyApplySet(args: {
  state: OccupancyDayState;
  source: OccupancySource;
  interval: AbsoluteOccupancyInterval;
  timeZone?: string;
  nowMs?: number;
}): { state: OccupancyDayState; overlapWarnings: OccupancyOverlapWarning[] } {
  const tz = args.timeZone ?? BOOKING_TZ;
  const seg = toSegment(args.source, args.state.key, args.interval, tz);
  if (!seg) {
    return { state: args.state, overlapWarnings: [] };
  }
  const next = cloneState(args.state);
  const newWarnings: OccupancyOverlapWarning[] = [];
  for (const other of next.segments.values()) {
    if (other.segmentKey === seg.segmentKey) continue;
    if (intervalsOverlapMs(other.startAtMs, other.endAtMs, seg.startAtMs, seg.endAtMs)) {
      newWarnings.push({
        segmentKey: seg.segmentKey,
        otherSegmentKey: other.segmentKey,
        startAtMs: Math.max(other.startAtMs, seg.startAtMs),
        endAtMs: Math.min(other.endAtMs, seg.endAtMs),
      });
    }
  }
  next.segments.set(seg.segmentKey, seg);
  next.mask.setRange(seg.startMin, seg.endMin);
  next.revision += 1;
  next.builtAtMs = args.nowMs ?? Date.now();
  next.overlapWarnings = detectOverlaps([...next.segments.values()]);
  return { state: next, overlapWarnings: newWarnings };
}

/**
 * Incremental remove with SAFE recompute of the affected timeline range.
 * Never assumes the cleared range is free — other overlapping segments are re-painted.
 */
export function occupancyApplyClear(args: {
  state: OccupancyDayState;
  source: OccupancySource;
  id: number;
  nowMs?: number;
}): OccupancyDayState {
  const key = segmentId(args.source, args.id);
  const existing = args.state.segments.get(key);
  if (!existing) return args.state;

  const next = cloneState(args.state);
  next.segments.delete(key);

  const { startMin, endMin } = existing;
  next.mask.clearRange(startMin, endMin);
  for (const other of next.segments.values()) {
    if (other.startMin < endMin && other.endMin > startMin) {
      next.mask.setRange(other.startMin, other.endMin);
    }
  }

  next.revision += 1;
  next.builtAtMs = args.nowMs ?? Date.now();
  next.overlapWarnings = detectOverlaps([...next.segments.values()]);
  return next;
}

/** Reschedule = clear old id + set new interval (possibly new id). */
export function occupancyApplyReschedule(args: {
  state: OccupancyDayState;
  source: OccupancySource;
  oldId: number;
  newInterval: AbsoluteOccupancyInterval;
  timeZone?: string;
  nowMs?: number;
}): OccupancyDayState {
  const cleared = occupancyApplyClear({
    state: args.state,
    source: args.source,
    id: args.oldId,
    nowMs: args.nowMs,
  });
  return occupancyApplySet({
    state: cleared,
    source: args.source,
    interval: args.newInterval,
    timeZone: args.timeZone,
    nowMs: args.nowMs,
  }).state;
}

function cloneState(state: OccupancyDayState): OccupancyDayState {
  return {
    key: { ...state.key },
    revision: state.revision,
    segments: new Map(state.segments),
    mask: state.mask.clone(),
    overlapWarnings: [...state.overlapWarnings],
    builtAtMs: state.builtAtMs,
  };
}

export type OccupancyMemoryStore = {
  get(key: OccupancyDayKey): OccupancyDayState | null;
  put(state: OccupancyDayState): void;
  delete(key: OccupancyDayKey): void;
  size(): number;
};

export function createOccupancyMemoryStore(): OccupancyMemoryStore {
  const map = new Map<string, OccupancyDayState>();
  return {
    get(key) {
      const hit = map.get(occupancyDayKeyString(parseOccupancyDayKey(key)));
      return hit ? cloneState(hit) : null;
    },
    put(state) {
      map.set(occupancyDayKeyString(state.key), cloneState(state));
    },
    delete(key) {
      map.delete(occupancyDayKeyString(parseOccupancyDayKey(key)));
    },
    size() {
      return map.size;
    },
  };
}
