/**
 * Booking V2 B4 — Effective Day Projection (pure domain).
 *
 * WeeklyBaselineMask
 *        ↓
 * Apply date-specific rules
 *        ↓
 * EffectiveDayMask
 *
 * Key: EmpID × BranchID × BusinessDate
 * Does NOT include bookings or holds.
 * ChangeMask is diagnostic only — not a correctness mechanism.
 */

import {
  AvailabilityBitmap,
  type AvailabilityFreeRange,
} from '@/lib/booking/domain/AvailabilityBitmap';
import {
  expandWeeklyClockWindow,
  type NormalizedWeeklyBaselinePlan,
  type WeeklyBaselineClockInput,
  type WeeklyBaselineWindow,
} from '@/lib/booking/domain/WeeklyBaseline';
import {
  parseBusinessDate,
  type BusinessDateString,
} from '@/lib/booking/domain/BusinessDate';

export type EffectiveDayKey = {
  employeeId: number;
  branchId: number;
  businessDate: BusinessDateString | string;
};

export const EFFECTIVE_DAY_CHANGE_FLAGS = [
  'late_start',
  'early_leave',
  'block_range',
  'close_day',
  'attendance_absent',
  'present_on_day_off',
  'freelancer_unlock',
  'branch_exception',
  'daily_replace_windows',
  'daily_add_window',
  'daily_block_window',
  'assignment_day_rule',
] as const;

export type EffectiveDayChangeFlag = (typeof EFFECTIVE_DAY_CHANGE_FLAGS)[number];

export type EffectiveDayChangeMask = ReadonlySet<EffectiveDayChangeFlag>;

export type EffectiveDayClockWindow = WeeklyBaselineClockInput;

export type EffectiveDayDailyAdjustmentLayer = {
  type: 'CLOSE_DAY' | 'REPLACE_WINDOWS' | 'ADD_WINDOW' | 'BLOCK_WINDOW';
  windows?: EffectiveDayClockWindow[];
};

/**
 * Date-specific layers applied ON TOP of weekly baseline.
 * Empty / default → normal day (baseline reuse).
 */
export type EffectiveDayLayerInputs = {
  lateStartHhmm?: string | null;
  earlyLeaveHhmm?: string | null;
  blockRanges?: EffectiveDayClockWindow[];
  /** Legacy ops close / day_off for the date. */
  closeDay?: boolean;
  /** Attendance Absent / auto absence. */
  absent?: boolean;
  /**
   * present-on-day-off / restore-present unlocks a weekly-off day
   * (ops custom_hours on day_off).
   */
  presentOnDayOff?: EffectiveDayClockWindow | null;
  /** Freelancer / part-time planned unlock for the date. */
  freelancerUnlock?: EffectiveDayClockWindow | null;
  /** Exceptional branch hours for this BusinessDate (not weekly defaults). */
  branchException?: {
    isClosed: boolean;
    openHhmm?: string | null;
    closeHhmm?: string | null;
    endDayOffset?: 0 | 1;
  } | null;
  /** Canonical daily adjustments (CLOSE / REPLACE / ADD / BLOCK). */
  dailyAdjustments?: EffectiveDayDailyAdjustmentLayer[];
  /** Temporary transfer / assignment day-specific rule that clears or replaces. */
  assignmentDayRule?: {
    kind: 'not_assigned' | 'transferred_away' | 'transferred_in';
    windows?: EffectiveDayClockWindow[];
  } | null;
};

export type EffectiveDayBuildResult = {
  key: EffectiveDayKey;
  bitmap: AvailabilityBitmap;
  freeRanges: AvailabilityFreeRange[];
  changeMask: EffectiveDayChangeMask;
  /** True when no date-specific difference — callers must NOT persist a new row. */
  reusedBaseline: boolean;
  isWorking: boolean;
  sourceFingerprint: string;
  baselineFingerprint: string;
};

export type EffectiveDayProjectionRecord = {
  key: EffectiveDayKey;
  /** Weekly baseline revision observed at build time. */
  sourceRevision: number;
  /** Date-scoped projection revision. */
  projectionRevision: number;
  changeMask: EffectiveDayChangeFlag[];
  reusedBaseline: boolean;
  bitmap: AvailabilityBitmap | null;
  freeRanges: AvailabilityFreeRange[];
  isWorking: boolean;
  sourceFingerprint: string;
  baselineFingerprint: string;
  builtAtMs: number;
};

export function effectiveDayKeyString(key: EffectiveDayKey): string {
  const businessDate = String(parseBusinessDate(key.businessDate));
  return `emp:${key.employeeId}:branch:${key.branchId}:date:${businessDate}`;
}

export function parseEffectiveDayKey(key: EffectiveDayKey): EffectiveDayKey {
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
    businessDate: parseBusinessDate(key.businessDate),
  };
}

function fnv1a(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function expandWin(w: EffectiveDayClockWindow): WeeklyBaselineWindow {
  return expandWeeklyClockWindow(w);
}

function paintWindows(windows: WeeklyBaselineWindow[]): AvailabilityBitmap {
  const bm = AvailabilityBitmap.empty();
  for (const w of windows) bm.setRange(w.startMin, w.endMin);
  return bm;
}

function intersectWithBranchHours(
  bm: AvailabilityBitmap,
  openHhmm: string,
  closeHhmm: string,
  endDayOffset?: 0 | 1,
): AvailabilityBitmap {
  const win = expandWeeklyClockWindow({
    startHhmm: openHhmm,
    endHhmm: closeHhmm,
    endDayOffset,
  });
  const mask = AvailabilityBitmap.empty().setRange(win.startMin, win.endMin);
  return bm.and(mask);
}

/** True when any date-specific layer is present (even if net bitmap equals baseline). */
export function hasDateSpecificLayers(layers: EffectiveDayLayerInputs): boolean {
  if (layers.closeDay) return true;
  if (layers.absent) return true;
  if (layers.lateStartHhmm) return true;
  if (layers.earlyLeaveHhmm) return true;
  if (layers.blockRanges?.length) return true;
  if (layers.presentOnDayOff) return true;
  if (layers.freelancerUnlock) return true;
  if (layers.branchException) return true;
  if (layers.dailyAdjustments?.length) return true;
  if (layers.assignmentDayRule) return true;
  return false;
}

export function effectiveDayLayersFingerprint(layers: EffectiveDayLayerInputs): string {
  const raw = JSON.stringify({
    lateStartHhmm: layers.lateStartHhmm ?? null,
    earlyLeaveHhmm: layers.earlyLeaveHhmm ?? null,
    blockRanges: layers.blockRanges ?? [],
    closeDay: !!layers.closeDay,
    absent: !!layers.absent,
    presentOnDayOff: layers.presentOnDayOff ?? null,
    freelancerUnlock: layers.freelancerUnlock ?? null,
    branchException: layers.branchException ?? null,
    dailyAdjustments: layers.dailyAdjustments ?? [],
    assignmentDayRule: layers.assignmentDayRule ?? null,
  });
  return fnv1a(raw);
}

/**
 * Apply date-specific layers on a weekly baseline bitmap/plan.
 * Order (documented):
 * 1. assignment day rule
 * 2. attendance absent
 * 3. close_day (legacy + daily CLOSE)
 * 4. branch exceptional hours
 * 5. present-on-day-off / freelancer unlock (can reopen empty baseline)
 * 6. daily REPLACE / ADD
 * 7. late_start / early_leave
 * 8. block_range + daily BLOCK
 */
export function applyEffectiveDayLayers(args: {
  key: EffectiveDayKey;
  baselinePlan: NormalizedWeeklyBaselinePlan;
  baselineBitmap: AvailabilityBitmap;
  baselineFingerprint: string;
  layers: EffectiveDayLayerInputs;
}): EffectiveDayBuildResult {
  const key = parseEffectiveDayKey(args.key);
  const change = new Set<EffectiveDayChangeFlag>();

  if (!hasDateSpecificLayers(args.layers)) {
    return {
      key,
      bitmap: args.baselineBitmap.clone(),
      freeRanges: args.baselineBitmap.toFreeRanges(),
      changeMask: change,
      reusedBaseline: true,
      isWorking: args.baselinePlan.isWorking && !args.baselineBitmap.isEmpty(),
      sourceFingerprint: fnv1a(`${args.baselineFingerprint}|none`),
      baselineFingerprint: args.baselineFingerprint,
    };
  }

  let bm = args.baselineBitmap.clone();
  const layers = args.layers;

  // 1. Assignment day rule
  if (layers.assignmentDayRule) {
    change.add('assignment_day_rule');
    const kind = layers.assignmentDayRule.kind;
    if (kind === 'not_assigned' || kind === 'transferred_away') {
      bm = AvailabilityBitmap.empty();
    } else if (kind === 'transferred_in' && layers.assignmentDayRule.windows?.length) {
      bm = paintWindows(layers.assignmentDayRule.windows.map(expandWin));
    }
  }

  // 2. Attendance absent
  if (layers.absent) {
    change.add('attendance_absent');
    bm = AvailabilityBitmap.empty();
  }

  // 3a. Legacy close_day
  if (layers.closeDay) {
    change.add('close_day');
    bm = AvailabilityBitmap.empty();
  }

  // 3b. Daily CLOSE_DAY (in chronological list — still applied here if any CLOSE present early)
  const adjustments = layers.dailyAdjustments ?? [];
  for (const adj of adjustments) {
    if (adj.type === 'CLOSE_DAY') {
      change.add('close_day');
      bm = AvailabilityBitmap.empty();
    }
  }

  // 4. Branch exceptional hours
  if (layers.branchException) {
    change.add('branch_exception');
    if (layers.branchException.isClosed) {
      bm = AvailabilityBitmap.empty();
    } else if (layers.branchException.openHhmm && layers.branchException.closeHhmm) {
      bm = intersectWithBranchHours(
        bm,
        layers.branchException.openHhmm,
        layers.branchException.closeHhmm,
        layers.branchException.endDayOffset,
      );
    }
  }

  // 5. Unlock paths (present-on-day-off / freelancer) when we have explicit windows
  if (layers.presentOnDayOff) {
    change.add('present_on_day_off');
    const w = expandWin(layers.presentOnDayOff);
    if (bm.isEmpty()) {
      bm = AvailabilityBitmap.empty().setRange(w.startMin, w.endMin);
    } else {
      bm = bm.or(AvailabilityBitmap.empty().setRange(w.startMin, w.endMin));
    }
  }
  if (layers.freelancerUnlock) {
    change.add('freelancer_unlock');
    const w = expandWin(layers.freelancerUnlock);
    if (bm.isEmpty()) {
      bm = AvailabilityBitmap.empty().setRange(w.startMin, w.endMin);
    } else {
      bm = bm.or(AvailabilityBitmap.empty().setRange(w.startMin, w.endMin));
    }
  }

  // 6. Daily REPLACE / ADD (after CLOSE already applied above; walk again for replace/add)
  for (const adj of adjustments) {
    if (adj.type === 'REPLACE_WINDOWS') {
      change.add('daily_replace_windows');
      const wins = (adj.windows ?? []).map(expandWin);
      bm = paintWindows(wins);
    } else if (adj.type === 'ADD_WINDOW') {
      change.add('daily_add_window');
      for (const w of adj.windows ?? []) {
        const exp = expandWin(w);
        bm = bm.or(AvailabilityBitmap.empty().setRange(exp.startMin, exp.endMin));
      }
    }
  }

  // 7. late_start / early_leave — shrink continuous free mask
  if (layers.lateStartHhmm) {
    change.add('late_start');
    const startMin = expandWeeklyClockWindow({
      startHhmm: layers.lateStartHhmm,
      endHhmm: '23:59',
      endDayOffset: 0,
    }).startMin;
    bm = bm.clone().clearRange(0, startMin);
  }
  if (layers.earlyLeaveHhmm) {
    change.add('early_leave');
    // early leave end clock — if before typical midday on overnight, treat as next-day
    const leave = expandWeeklyClockWindow({
      startHhmm: '00:00',
      endHhmm: layers.earlyLeaveHhmm,
      endDayOffset: args.baselinePlan.windows.some((w) => w.endDayOffset === 1)
        ? layers.earlyLeaveHhmm < (args.baselinePlan.windows[0]?.startHhmm ?? '12:00')
          ? 1
          : 0
        : 0,
    });
    // expandWeeklyClockWindow with start 00:00 and end earlyLeave gives endMin
    const endMin = leave.endMin;
    bm = bm.clone().clearRange(endMin, 48 * 60);
  }

  // 8. Blocks
  for (const br of layers.blockRanges ?? []) {
    change.add('block_range');
    const w = expandWin(br);
    bm = bm.clone().clearRange(w.startMin, w.endMin);
  }
  for (const adj of adjustments) {
    if (adj.type === 'BLOCK_WINDOW') {
      change.add('daily_block_window');
      for (const w of adj.windows ?? []) {
        const exp = expandWin(w);
        bm = bm.clone().clearRange(exp.startMin, exp.endMin);
      }
    }
  }

  const layerFp = effectiveDayLayersFingerprint(layers);
  const equalsBaseline = bm.equals(args.baselineBitmap);
  // Persist only when layers exist AND result differs OR layers force a closed/empty vs working baseline
  // Spec: "الأيام الطبيعية: إذا لا يوجد date-specific difference، لا يلزم تخزين"
  // If layers exist but net equals baseline, still skip storage (reusedBaseline).
  const reusedBaseline = equalsBaseline;

  return {
    key,
    bitmap: bm,
    freeRanges: bm.toFreeRanges(),
    changeMask: change,
    reusedBaseline,
    isWorking: !bm.isEmpty(),
    sourceFingerprint: fnv1a(`${args.baselineFingerprint}|${layerFp}`),
    baselineFingerprint: args.baselineFingerprint,
  };
}

/**
 * Detect confirmed bookings whose interval is no longer fully free on the effective mask.
 * NEVER cancels or mutates bookings — admin follow-up only.
 */
export function findBookingsOutsideEffectiveMask(args: {
  bookings: Array<{
    bookingId: number;
    /** Continuous business-day timeline minutes [start, end). */
    startMin: number;
    endMin: number;
  }>;
  effectiveBitmap: AvailabilityBitmap;
}): Array<{
  bookingId: number;
  reason: 'OUTSIDE_EFFECTIVE_MASK';
  startMin: number;
  endMin: number;
}> {
  const out: Array<{
    bookingId: number;
    reason: 'OUTSIDE_EFFECTIVE_MASK';
    startMin: number;
    endMin: number;
  }> = [];
  for (const b of args.bookings) {
    if (!(b.endMin > b.startMin)) continue;
    const duration = b.endMin - b.startMin;
    if (!args.effectiveBitmap.hasConsecutiveFreeAt(b.startMin, duration)) {
      out.push({
        bookingId: b.bookingId,
        reason: 'OUTSIDE_EFFECTIVE_MASK',
        startMin: b.startMin,
        endMin: b.endMin,
      });
    }
  }
  return out;
}

export function changeMaskToArray(mask: EffectiveDayChangeMask): EffectiveDayChangeFlag[] {
  return EFFECTIVE_DAY_CHANGE_FLAGS.filter((f) => mask.has(f));
}
