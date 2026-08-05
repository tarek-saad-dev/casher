/**
 * Phase 2.5 / 3C — Effective-window helpers.
 *
 * Runtime eligibility must use interval containment helpers
 * (`findWindowContainingInterval`, `iterateWindowSlotStarts`,
 * `findEarliestFitInWindows`, etc.).
 *
 * `selectPrimaryEffectiveWindow` is display/legacy compatibility only.
 * Do not use it for booking slots, write guards, reschedule, queue ETA,
 * timeline simulation, or available-days probes.
 */

import type { DayPlanWindow } from '@/lib/availability/resolveEmployeeDayPlan';

export type EffectiveWindowSelectionPolicy =
  /** Prefer first window — display/compat only (not runtime eligibility). */
  | 'first'
  /** Prefer the window that contains the given epoch ms (falls back to first). */
  | 'containing'
  /** Prefer the next window that starts at/after the given epoch ms. */
  | 'next';

export type WindowSlotStart = {
  startMs: number;
  endMs: number;
  window: DayPlanWindow;
};

/**
 * Iterate effective windows in chronological order (by startMs).
 * Yields a shallow copy of the sorted list — callers may safely mutate the array.
 */
export function iterateEffectiveWindows(
  windows: readonly DayPlanWindow[] | null | undefined,
): DayPlanWindow[] {
  if (!windows?.length) return [];
  return [...windows].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/**
 * Sort, shallow-copy, drop invalid (end <= start), and dedupe identical ranges.
 * Does not mutate input.
 */
export function normalizeEffectiveWindows(
  windows: readonly DayPlanWindow[] | null | undefined,
): DayPlanWindow[] {
  const ordered = iterateEffectiveWindows(windows);
  const out: DayPlanWindow[] = [];
  for (const w of ordered) {
    if (!(w.endMs > w.startMs)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.startMs === w.startMs && prev.endMs === w.endMs) continue;
    out.push({ ...w });
  }
  return out;
}

/**
 * Find the window that contains `[pointMs, pointMs]` (half-open [start, end)).
 * Returns null when none contain the point.
 */
export function findContainingWindow(
  windows: readonly DayPlanWindow[] | null | undefined,
  pointMs: number,
): DayPlanWindow | null {
  for (const w of normalizeEffectiveWindows(windows)) {
    if (pointMs >= w.startMs && pointMs < w.endMs) return w;
  }
  return null;
}

/** Spec alias — point containment via args object. */
export function findWindowContainingPoint(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  pointMs: number;
}): DayPlanWindow | null {
  return findContainingWindow(args.windows, args.pointMs);
}

/**
 * Find the next window whose start is at or after `fromMs`.
 * If none, returns null.
 */
export function findNextWindow(
  windows: readonly DayPlanWindow[] | null | undefined,
  fromMs: number,
): DayPlanWindow | null {
  for (const w of normalizeEffectiveWindows(windows)) {
    if (w.startMs >= fromMs) return w;
  }
  return null;
}

/**
 * Find one window that fully contains `[startMs, endMs)`.
 * Rejects zero/negative intervals and bridging across windows.
 * Half-open: ending exactly at window.endMs is valid.
 */
export function findWindowContainingInterval(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  startMs: number;
  endMs: number;
}): DayPlanWindow | null {
  const { startMs, endMs } = args;
  if (!(endMs > startMs)) return null;
  for (const w of normalizeEffectiveWindows(args.windows)) {
    if (startMs >= w.startMs && endMs <= w.endMs) return w;
  }
  return null;
}

export function isIntervalInsideAnyEffectiveWindow(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  startMs: number;
  endMs: number;
}): boolean {
  return findWindowContainingInterval(args) != null;
}

/**
 * Next window that still has remaining time after `fromMs`
 * (current window if `fromMs` is inside it, else the next by start).
 */
export function findNextEffectiveWindow(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  fromMs: number;
}): DayPlanWindow | null {
  for (const w of normalizeEffectiveWindows(args.windows)) {
    if (w.endMs > args.fromMs) return w;
  }
  return null;
}

/**
 * Earliest absolute ms >= fromMs that lies inside any effective window.
 * Does not skip blocks/occupancy — only window geometry.
 */
export function findNextAvailablePointInWindows(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  fromMs: number;
}): number | null {
  for (const w of normalizeEffectiveWindows(args.windows)) {
    if (args.fromMs < w.endMs) {
      return Math.max(args.fromMs, w.startMs);
    }
  }
  return null;
}

/**
 * Candidate slot starts across all windows. Duration must fit entirely in one
 * window; gaps are never bridged. Dedupes equal startMs from overlapping
 * normalized windows. Optional `notBeforeMs` skips earlier starts (min notice).
 */
export function iterateWindowSlotStarts(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  durationMinutes: number;
  intervalMinutes: number;
  notBeforeMs?: number;
}): WindowSlotStart[] {
  const durationMs = args.durationMinutes * 60_000;
  const intervalMs = args.intervalMinutes * 60_000;
  if (!(durationMs > 0) || !(intervalMs > 0)) return [];

  const byStart = new Map<number, WindowSlotStart>();
  for (const w of normalizeEffectiveWindows(args.windows)) {
    const lastStart = w.endMs - durationMs;
    if (lastStart < w.startMs) continue;
    let t = w.startMs;
    if (args.notBeforeMs != null && t < args.notBeforeMs) {
      // Align to interval grid from window start, not before notBeforeMs.
      const steps = Math.ceil((args.notBeforeMs - w.startMs) / intervalMs);
      t = w.startMs + Math.max(0, steps) * intervalMs;
    }
    for (; t <= lastStart; t += intervalMs) {
      if (args.notBeforeMs != null && t < args.notBeforeMs) continue;
      if (!byStart.has(t)) {
        byStart.set(t, { startMs: t, endMs: t + durationMs, window: w });
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Earliest start >= fromMs where duration fits in one window and does not
 * intersect occupied half-open intervals. Used by queue / timeline simulation.
 */
export function findEarliestFitInWindows(args: {
  windows: readonly DayPlanWindow[] | null | undefined;
  fromMs: number;
  durationMinutes: number;
  occupied?: Array<{ startMs: number; endMs: number }>;
}): number | null {
  const durationMs = args.durationMinutes * 60_000;
  if (!(durationMs > 0)) return null;
  const occupied = [...(args.occupied ?? [])]
    .filter((iv) => iv.endMs > iv.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  for (const w of normalizeEffectiveWindows(args.windows)) {
    let candidate = Math.max(args.fromMs, w.startMs);
    const lastStart = w.endMs - durationMs;
    let guard = 0;
    while (candidate <= lastStart && guard < 2000) {
      guard += 1;
      const end = candidate + durationMs;
      let bumped = false;
      for (const iv of occupied) {
        if (candidate < iv.endMs && end > iv.startMs) {
          candidate = Math.max(candidate, iv.endMs);
          bumped = true;
          break;
        }
      }
      if (bumped) continue;
      if (end <= w.endMs) return candidate;
      break;
    }
  }
  return null;
}

/**
 * Outer display / occupancy-load bounds (min start / max end).
 * NEVER use for runtime eligibility — gaps would become bookable.
 * Alias: `getEffectiveWindowsOuterBounds`.
 */
export function outerDisplayBounds(
  windows: readonly DayPlanWindow[] | null | undefined,
): { startMs: number; endMs: number } | null {
  const ordered = normalizeEffectiveWindows(windows);
  if (!ordered.length) return null;
  return {
    startMs: ordered[0]!.startMs,
    endMs: ordered[ordered.length - 1]!.endMs,
  };
}

/** Spec name for outer display bounds — not for runtime eligibility. */
export function getEffectiveWindowsOuterBounds(
  windows: readonly DayPlanWindow[] | null | undefined,
): { startMs: number; endMs: number } | null {
  return outerDisplayBounds(windows);
}

/**
 * @deprecated DISPLAY / LEGACY COMPAT ONLY — not for runtime eligibility.
 * Prefer findWindowContainingInterval / iterateWindowSlotStarts / findEarliestFitInWindows.
 *
 * Runtime eligibility must use interval containment helpers.
 * selectPrimaryEffectiveWindow is display/legacy compatibility only.
 */
export function selectPrimaryEffectiveWindow(
  windows: readonly DayPlanWindow[] | null | undefined,
  opts?: {
    policy?: EffectiveWindowSelectionPolicy;
    pointMs?: number;
    fromMs?: number;
  },
): DayPlanWindow | null {
  const policy = opts?.policy ?? 'first';
  const ordered = normalizeEffectiveWindows(windows);
  if (!ordered.length) return null;

  if (policy === 'containing' && opts?.pointMs != null) {
    return findContainingWindow(ordered, opts.pointMs) ?? ordered[0]!;
  }
  if (policy === 'next' && opts?.fromMs != null) {
    return findNextWindow(ordered, opts.fromMs) ?? ordered[0]!;
  }
  return ordered[0]!;
}
