/**
 * Booking V2 — Weekly baseline types & pure helpers.
 *
 * Logical key: EmpID + BranchID + DayOfWeek
 * EmpID remains global identity; BranchID is work-location context only.
 *
 * Baseline answers: "when is this employee expected to be bookable on a normal
 * weekly day at this branch?" — weekly schedule ∩ regular branch hours only.
 */

import {
  AvailabilityBitmap,
  type AvailabilityFreeRange,
} from '@/lib/booking/domain/AvailabilityBitmap';
import { hhmmToMinutes, parseHhmm } from '@/lib/booking/domain/BusinessDate';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WeeklyBaselineKey = {
  employeeId: number;
  branchId: number;
  dayOfWeek: DayOfWeek;
};

export type WeeklyBaselineClockInput = {
  startHhmm: string;
  endHhmm: string;
  /** Explicit overnight flag; inferred from end<=start when omitted. */
  endDayOffset?: 0 | 1;
};

export type WeeklyBaselineWindow = {
  startHhmm: string;
  endHhmm: string;
  endDayOffset: 0 | 1;
  startMin: number;
  endMin: number;
};

export type WeeklyBaselineSourceInputs = {
  key: WeeklyBaselineKey;
  /** Employee weekly cells for this DOW (supports multiple windows). */
  employeeWindows: WeeklyBaselineClockInput[];
  isEmployeeWorkingDay: boolean;
  /** Regular branch open hours (not exceptional / close_day). */
  branchHours: WeeklyBaselineClockInput | null;
  branchIsOpen: boolean;
};

export type NormalizedWeeklyBaselinePlan = {
  key: WeeklyBaselineKey;
  isWorking: boolean;
  windows: WeeklyBaselineWindow[];
  employeeWindows: WeeklyBaselineWindow[];
  branchWindow: WeeklyBaselineWindow | null;
  denyReason:
    | 'DAY_OFF'
    | 'BRANCH_CLOSED'
    | 'SCHEDULE_EMPTY'
    | 'NO_OVERLAP'
    | null;
};

export type WeeklyBaselineProjectionRecord = {
  key: WeeklyBaselineKey;
  revision: number;
  sourceFingerprint: string;
  bitmap: AvailabilityBitmap;
  freeRanges: AvailabilityFreeRange[];
  plan: NormalizedWeeklyBaselinePlan;
  builtAtMs: number;
};

export function parseDayOfWeek(value: unknown): DayOfWeek {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error(`INVALID_DAY_OF_WEEK:${String(value)}`);
  }
  return n as DayOfWeek;
}

export function weeklyBaselineKeyString(key: WeeklyBaselineKey): string {
  return `emp:${key.employeeId}:branch:${key.branchId}:dow:${key.dayOfWeek}`;
}

export function parseWeeklyBaselineKey(key: WeeklyBaselineKey): WeeklyBaselineKey {
  const employeeId = Number(key.employeeId);
  const branchId = Number(key.branchId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error(`INVALID_EMPLOYEE_ID:${String(key.employeeId)}`);
  }
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new Error(`INVALID_BRANCH_ID:${String(key.branchId)}`);
  }
  return {
    employeeId,
    branchId,
    dayOfWeek: parseDayOfWeek(key.dayOfWeek),
  };
}

function minutesToHhmm(totalMin: number): string {
  const dayMin = ((totalMin % 1440) + 1440) % 1440;
  const h = Math.floor(dayMin / 60);
  const m = dayMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Expand a clock window onto the continuous business-day minute timeline. */
export function expandWeeklyClockWindow(
  input: WeeklyBaselineClockInput,
): WeeklyBaselineWindow {
  const startHhmm = parseHhmm(input.startHhmm);
  const endHhmm = parseHhmm(input.endHhmm);
  const startMin = hhmmToMinutes(startHhmm);
  const endClock = hhmmToMinutes(endHhmm);
  const inferredOffset: 0 | 1 =
    input.endDayOffset === 0 || input.endDayOffset === 1
      ? input.endDayOffset
      : endClock <= startMin
        ? 1
        : 0;
  const endMin = inferredOffset === 1 ? endClock + 1440 : endClock;
  if (endMin <= startMin) {
    throw new Error(`INVALID_WEEKLY_WINDOW:${startHhmm}-${endHhmm}`);
  }
  return {
    startHhmm,
    endHhmm,
    endDayOffset: inferredOffset,
    startMin,
    endMin,
  };
}

function intersectMinuteRanges(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): { startMin: number; endMin: number } | null {
  const startMin = Math.max(a.startMin, b.startMin);
  const endMin = Math.min(a.endMin, b.endMin);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

function windowFromMinutes(startMin: number, endMin: number): WeeklyBaselineWindow {
  // endDayOffset=1 when the exclusive end sits on / past the next calendar day.
  const crosses = endMin > 1440;
  return {
    startHhmm: minutesToHhmm(startMin),
    endHhmm: minutesToHhmm(endMin),
    endDayOffset: crosses ? 1 : 0,
    startMin,
    endMin,
  };
}

/** Merge overlapping/adjacent half-open ranges. */
export function mergeMinuteRanges(
  ranges: Array<{ startMin: number; endMin: number }>,
): Array<{ startMin: number; endMin: number }> {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((x, y) => x.startMin - y.startMin);
  const out: Array<{ startMin: number; endMin: number }> = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.startMin <= cur.endMin) {
      cur.endMin = Math.max(cur.endMin, n.endMin);
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Normalize weekly baseline plan: employee weekly windows ∩ regular branch hours.
 * Does NOT apply bookings, holds, late_start, early_leave, block_range, close_day,
 * or auto absence.
 */
export function normalizeWeeklyBaselinePlan(
  inputs: WeeklyBaselineSourceInputs,
): NormalizedWeeklyBaselinePlan {
  const key = parseWeeklyBaselineKey(inputs.key);
  const employeeWindows = inputs.isEmployeeWorkingDay
    ? inputs.employeeWindows.map(expandWeeklyClockWindow)
    : [];

  if (!inputs.isEmployeeWorkingDay) {
    return {
      key,
      isWorking: false,
      windows: [],
      employeeWindows: [],
      branchWindow: null,
      denyReason: 'DAY_OFF',
    };
  }

  if (!inputs.branchIsOpen) {
    return {
      key,
      isWorking: false,
      windows: [],
      employeeWindows,
      branchWindow: null,
      denyReason: 'BRANCH_CLOSED',
    };
  }

  if (!employeeWindows.length) {
    return {
      key,
      isWorking: false,
      windows: [],
      employeeWindows: [],
      branchWindow: inputs.branchHours
        ? expandWeeklyClockWindow(inputs.branchHours)
        : null,
      denyReason: 'SCHEDULE_EMPTY',
    };
  }

  const branchWindow = inputs.branchHours
    ? expandWeeklyClockWindow(inputs.branchHours)
    : null;

  let intersected: Array<{ startMin: number; endMin: number }>;
  if (branchWindow) {
    intersected = [];
    for (const ew of employeeWindows) {
      const hit = intersectMinuteRanges(ew, branchWindow);
      if (hit) intersected.push(hit);
    }
  } else {
    intersected = employeeWindows.map((w) => ({
      startMin: w.startMin,
      endMin: w.endMin,
    }));
  }

  const merged = mergeMinuteRanges(intersected);
  if (!merged.length) {
    return {
      key,
      isWorking: false,
      windows: [],
      employeeWindows,
      branchWindow,
      denyReason: 'NO_OVERLAP',
    };
  }

  return {
    key,
    isWorking: true,
    windows: merged.map((r) => windowFromMinutes(r.startMin, r.endMin)),
    employeeWindows,
    branchWindow,
    denyReason: null,
  };
}

/** Paint normalized weekly windows into a 5-minute availability bitmap. */
export function bitmapFromNormalizedWeeklyPlan(
  plan: NormalizedWeeklyBaselinePlan,
): AvailabilityBitmap {
  const bm = AvailabilityBitmap.empty();
  for (const w of plan.windows) {
    bm.setRange(w.startMin, w.endMin);
  }
  return bm;
}

/** Stable fingerprint of SoT inputs used to build a baseline (rebuild detection). */
export function weeklyBaselineSourceFingerprint(
  inputs: WeeklyBaselineSourceInputs,
): string {
  const key = parseWeeklyBaselineKey(inputs.key);
  const emp = inputs.employeeWindows
    .map((w) => `${w.startHhmm}-${w.endHhmm}:${w.endDayOffset ?? ''}`)
    .sort()
    .join('|');
  const br = inputs.branchHours
    ? `${inputs.branchHours.startHhmm}-${inputs.branchHours.endHhmm}:${inputs.branchHours.endDayOffset ?? ''}`
    : '';
  const raw = [
    key.employeeId,
    key.branchId,
    key.dayOfWeek,
    inputs.isEmployeeWorkingDay ? 1 : 0,
    inputs.branchIsOpen ? 1 : 0,
    emp,
    br,
  ].join(';');
  // FNV-1a 32-bit — isomorphic, no crypto dependency.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a_${(h >>> 0).toString(16).padStart(8, '0')}`;
}
