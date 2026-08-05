/**
 * Phase 3A — Pure daily-adjustment application engine.
 *
 * Precedence (documented):
 * Adjustments are applied in chronological order by (CreatedAt ASC, AdjustmentID ASC).
 * Type semantics during the walk:
 *   CLOSE_DAY        → clear working windows
 *   REPLACE_WINDOWS  → replace working windows with this record's windows
 *   ADD_WINDOW       → union/merge into working windows
 *   BLOCK_WINDOW     → accumulate blocked intervals (applied against final windows)
 *
 * This yields:
 *   CLOSE then ADD/REPLACE → day can reopen
 *   ADD then CLOSE         → day closed
 *   ADD then REPLACE       → only replace remains
 *   REPLACE then ADD       → replace + adds
 *   multiple REPLACE       → last wins
 *   all BLOCK              → applied after final working set
 *
 * Legacy overrides are applied by the resolver *before* this engine.
 * Attendance Absent is enforced by the resolver and is not reopenable here.
 */

import type { DayPlanWindow } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDailyAdjustment } from '@/lib/availability/dailyAdjustments';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/businessDate';

export type AppliedBlockedInterval = {
  startMs: number;
  endMs: number;
  reason?: string;
  adjustmentId?: number;
};

export type ApplyDailyAdjustmentsResult = {
  effectiveWindows: DayPlanWindow[];
  blockedIntervals: AppliedBlockedInterval[];
  appliedAdjustments: EmployeeDailyAdjustment[];
  warnings: string[];
  closedByAdjustment: boolean;
  replacedByAdjustment: boolean;
  extendedByAdjustment: boolean;
  blockedByAdjustment: boolean;
};

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function msToHhmm(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function windowFromMs(
  businessDate: string,
  startMs: number,
  endMs: number,
  timezone: string,
): DayPlanWindow | null {
  if (!(endMs > startMs)) return null;
  const start = msToHhmm(startMs, timezone);
  const end = msToHhmm(endMs, timezone);
  const sameDayEnd = salonDateTimeToMs(businessDate, end, timezone);
  const endDayOffset: 0 | 1 = endMs > sameDayEnd + 60_000 ? 1 : endMs > sameDayEnd ? 1 : 0;
  // Prefer explicit overnight detection via calendar next-day ms
  const nextDayStart = salonDateTimeToMs(nextDate(businessDate), '00:00', timezone);
  const offset: 0 | 1 = endMs >= nextDayStart ? 1 : 0;
  return {
    start,
    end,
    endDayOffset: offset,
    startMs,
    endMs,
  };
}

/** Merge overlapping/adjacent working windows (half-open, adjacent within 1ms). */
export function mergeWorkingWindows(
  windows: DayPlanWindow[],
  businessDate: string,
  timezone = SALON_TZ,
): DayPlanWindow[] {
  const sorted = [...windows]
    .filter((w) => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!sorted.length) return [];
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (!last || w.startMs > last.endMs) {
      merged.push({ startMs: w.startMs, endMs: w.endMs });
    } else {
      last.endMs = Math.max(last.endMs, w.endMs);
    }
  }
  return merged
    .map((m) => windowFromMs(businessDate, m.startMs, m.endMs, timezone))
    .filter((w): w is DayPlanWindow => !!w);
}

export function mergeBlockedIntervals(
  blocks: AppliedBlockedInterval[],
): AppliedBlockedInterval[] {
  const sorted = [...blocks]
    .filter((b) => b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!sorted.length) return [];
  const out: AppliedBlockedInterval[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (!last || b.startMs > last.endMs) {
      out.push({ ...b });
    } else {
      last.endMs = Math.max(last.endMs, b.endMs);
      if (b.reason && !last.reason) last.reason = b.reason;
      if (b.adjustmentId != null && last.adjustmentId == null) {
        last.adjustmentId = b.adjustmentId;
      }
    }
  }
  return out;
}

function sortAdjustments(adjustments: EmployeeDailyAdjustment[]): EmployeeDailyAdjustment[] {
  return [...adjustments].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    if (a.adjustmentId !== b.adjustmentId) return a.adjustmentId - b.adjustmentId;
    return a.version - b.version;
  });
}

function adjWindowsToDayPlan(windows: EmployeeDailyAdjustment['windows']): DayPlanWindow[] {
  return windows.map((w) => ({
    start: w.start,
    end: w.end,
    endDayOffset: w.endDayOffset,
    startMs: w.startMs,
    endMs: w.endMs,
  }));
}

/**
 * Apply canonical daily adjustments on top of legacy-resolved base windows/blocks.
 */
export function applyDailyAdjustments(args: {
  employeeId: number;
  businessDate: string;
  baseWindows: DayPlanWindow[];
  baseBlockedIntervals: AppliedBlockedInterval[];
  adjustments: EmployeeDailyAdjustment[];
  timezone?: string;
}): ApplyDailyAdjustmentsResult {
  const timezone = args.timezone || SALON_TZ;
  const warnings: string[] = [];
  const applied = sortAdjustments(args.adjustments);
  let working = [...args.baseWindows];
  const pendingBlocks: AppliedBlockedInterval[] = [...args.baseBlockedIntervals];

  let closedByAdjustment = false;
  let replacedByAdjustment = false;
  let extendedByAdjustment = false;
  let blockedByAdjustment = false;

  for (const adj of applied) {
    switch (adj.adjustmentType) {
      case 'CLOSE_DAY': {
        working = [];
        closedByAdjustment = true;
        replacedByAdjustment = false;
        extendedByAdjustment = false;
        break;
      }
      case 'REPLACE_WINDOWS': {
        working = mergeWorkingWindows(
          adjWindowsToDayPlan(adj.windows),
          args.businessDate,
          timezone,
        );
        closedByAdjustment = false;
        replacedByAdjustment = true;
        extendedByAdjustment = false;
        if (!working.length) {
          warnings.push('REPLACE_WINDOWS produced no usable windows');
        }
        break;
      }
      case 'ADD_WINDOW': {
        working = mergeWorkingWindows(
          [...working, ...adjWindowsToDayPlan(adj.windows)],
          args.businessDate,
          timezone,
        );
        closedByAdjustment = false;
        extendedByAdjustment = true;
        break;
      }
      case 'BLOCK_WINDOW': {
        blockedByAdjustment = true;
        for (const w of adj.windows) {
          pendingBlocks.push({
            startMs: w.startMs,
            endMs: w.endMs,
            reason: adj.reasonText ?? adj.reasonCode ?? 'تعديل يومي',
            adjustmentId: adj.adjustmentId,
          });
        }
        break;
      }
      default:
        warnings.push(`Unknown adjustment type ignored: ${(adj as EmployeeDailyAdjustment).adjustmentType}`);
    }
  }

  const effectiveWindows = mergeWorkingWindows(working, args.businessDate, timezone);
  const blockedIntervals = mergeBlockedIntervals(pendingBlocks);

  return {
    effectiveWindows,
    blockedIntervals,
    appliedAdjustments: applied,
    warnings,
    closedByAdjustment,
    replacedByAdjustment,
    extendedByAdjustment,
    blockedByAdjustment,
  };
}

/** True when every millisecond of every window is covered by blocks (no bookable residual). */
export function isFullyBlockedByIntervals(
  windows: DayPlanWindow[],
  blocks: AppliedBlockedInterval[],
): boolean {
  if (!windows.length) return true;
  for (const w of windows) {
    let cursor = w.startMs;
    const covering = blocks
      .filter((b) => b.startMs < w.endMs && b.endMs > w.startMs)
      .sort((a, b) => a.startMs - b.startMs);
    for (const b of covering) {
      if (b.startMs > cursor) return false;
      cursor = Math.max(cursor, b.endMs);
      if (cursor >= w.endMs) break;
    }
    if (cursor < w.endMs) return false;
  }
  return true;
}
