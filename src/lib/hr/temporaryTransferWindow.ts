/**
 * Time-window phases for temporary branch transfers (split-day support).
 *
 * Before StartTime → employee stays on the source branch (must not appear at destination).
 * During [StartTime, EndTime) → destination only.
 * After EndTime → neither side is operationally "present" via the transfer.
 *
 * Missing StartTime → legacy all-day transfer at destination (source away all day).
 */
import { getCairoCalendarDate, getCairoTimeStr } from '@/lib/businessDate';

export type TemporaryTransferPhase = 'before' | 'during' | 'after' | 'all_day';

function parseHm(time: string): number {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function isOvernightWindow(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return parseHm(end) <= parseHm(start);
}

/**
 * Resolve where the employee should operationally sit given transfer times.
 * @param workDate YYYY-MM-DD of the transfer
 * @param startTime HH:mm optional destination window start
 * @param endTime HH:mm optional destination window end
 */
export function resolveTemporaryTransferPhase(args: {
  workDate: string;
  startTime?: string | null;
  endTime?: string | null;
  now?: Date;
}): TemporaryTransferPhase {
  const start = args.startTime?.slice(0, 5) || null;
  if (!start) return 'all_day';

  const end = args.endTime?.slice(0, 5) || null;
  const now = args.now ?? new Date();
  const today = getCairoCalendarDate(now);
  const nowHm = getCairoTimeStr(now).slice(0, 5);

  // Past work dates: treat the transfer as having applied for that day
  // (attendance history / day boards for closed days).
  if (args.workDate < today) return 'during';

  // Future work dates: still on source until that day begins.
  if (args.workDate > today) return 'before';

  const nowMin = parseHm(nowHm);
  const startMin = parseHm(start);

  if (nowMin < startMin) return 'before';

  if (!end) return 'during';

  const endMin = parseHm(end);
  if (isOvernightWindow(start, end)) {
    // 17:00 → 12:34 next calendar morning: still "during" after start until end next day.
    // On the WorkDate itself after start → during. End bound is next day — handled when
    // workDate advances; for same WorkDate after start we stay during.
    return 'during';
  }

  if (nowMin < endMin) return 'during';
  return 'after';
}

/** Destination roster/bookings/attendance should show the employee. */
export function isTransferDestinationActive(args: {
  workDate: string;
  startTime?: string | null;
  endTime?: string | null;
  now?: Date;
}): boolean {
  const phase = resolveTemporaryTransferPhase(args);
  return phase === 'during' || phase === 'all_day';
}

/** Source branch should treat the employee as transferred away (not operationally here). */
export function isTransferSourceInactive(args: {
  workDate: string;
  startTime?: string | null;
  endTime?: string | null;
  now?: Date;
}): boolean {
  const phase = resolveTemporaryTransferPhase(args);
  return phase === 'during' || phase === 'all_day' || phase === 'after';
}

export function isFutureWorkDate(workDate: string, now?: Date): boolean {
  return workDate > getCairoCalendarDate(now ?? new Date());
}

/**
 * HR attendance board: future transfers are visible immediately for planning.
 */
export function isAttendanceBoardDestinationVisible(args: {
  workDate: string;
  hasXferIn: boolean;
  startTime?: string | null;
  endTime?: string | null;
  now?: Date;
}): boolean {
  if (!args.hasXferIn) return false;
  if (isFutureWorkDate(args.workDate, args.now)) return true;
  return isTransferDestinationActive(args);
}

/** Hide source-board row when transferred away (unless attendance already recorded). */
export function isAttendanceBoardSourceHidden(args: {
  workDate: string;
  hasXferOut: boolean;
  hasAttendance: boolean;
  startTime?: string | null;
  endTime?: string | null;
  now?: Date;
}): boolean {
  if (!args.hasXferOut || args.hasAttendance) return false;
  if (isFutureWorkDate(args.workDate, args.now)) return true;
  return isTransferSourceInactive(args);
}
