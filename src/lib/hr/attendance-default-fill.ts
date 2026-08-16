/**
 * Attendance D / N time fill — shared by HR board and nightly close.
 * D = fill missing times from employee DefaultCheckIn/Out.
 */

import { calcLateMinutes, calcEarlyLeaveMinutes } from '@/lib/timeUtils';

export interface AttendanceTimeFillRow {
  CheckInTime: string | null;
  CheckOutTime: string | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
  Status: string;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
}

const MANUAL_STATUSES = ['Absent', 'DayOff', 'Excused'];

/** After overnight scheduled end, wait this long before inventing Default checkout. */
export const OVERNIGHT_CHECKOUT_FILL_GRACE_HOURS = 4;

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function toMinutes(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const m = String(value).trim().match(TIME_RE);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Overnight when end clock is ≤ start (e.g. 16:00 → 02:00). */
export function isOvernightShiftTimes(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s == null || e == null) return false;
  return e <= s;
}

/**
 * True when DefaultFill must NOT invent checkout yet for overnight OT.
 * Example: workDate 2026-08-13, schedule 16:00–02:00, now 02:40 next morning
 * → still inside grace → wait for real punch (or later close after grace).
 */
export function shouldDeferOvernightDefaultCheckoutFill(params: {
  checkOutTime: string | null | undefined;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
  defaultCheckIn: string | null | undefined;
  defaultCheckOut: string | null | undefined;
  workDate: string;
  now?: Date;
  graceHours?: number;
}): boolean {
  if (params.checkOutTime) return false;
  if (!params.workDate || !/^\d{4}-\d{2}-\d{2}$/.test(params.workDate)) return false;

  const start = params.scheduledStart || params.defaultCheckIn || null;
  const end = params.scheduledEnd || params.defaultCheckOut || null;
  if (!isOvernightShiftTimes(start, end)) return false;

  const endMins = toMinutes(end);
  if (endMins == null) return false;

  const [y, m, d] = params.workDate.split('-').map(Number);
  // Overnight end is on the next calendar day after workDate.
  const endAbs = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  endAbs.setUTCDate(endAbs.getUTCDate() + 1);
  endAbs.setUTCHours(Math.floor(endMins / 60), endMins % 60, 0, 0);

  const graceHours = params.graceHours ?? OVERNIGHT_CHECKOUT_FILL_GRACE_HOURS;
  const graceEnd = new Date(endAbs.getTime() + graceHours * 60 * 60 * 1000);

  const now = params.now ?? new Date();
  const cairoParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    cairoParts.find((p) => p.type === type)?.value ?? '0';
  const nowCairoAsUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    0,
  );

  return nowCairoAsUtc < graceEnd.getTime();
}

/** D — fill missing times from employee defaults (HR attendance board button). */
export function applyDefaultTimesToRow<T extends AttendanceTimeFillRow>(row: T): T {
  // Never invent clock times for manual statuses (DayOff / Absent / Excused).
  if (MANUAL_STATUSES.includes(row.Status)) {
    return { ...row };
  }

  const updated = { ...row };

  if (!row.CheckInTime && row.DefaultCheckInTime) {
    updated.CheckInTime = row.DefaultCheckInTime;
    const late = calcLateMinutes(row.DefaultCheckInTime, row.ScheduledStartTime);
    updated.LateMinutes = late;
    updated.Status = late > 0 ? 'Late' : 'Present';
  }

  if (!row.CheckOutTime && row.DefaultCheckOutTime) {
    updated.CheckOutTime = row.DefaultCheckOutTime;
    if (updated.CheckInTime && row.ScheduledEndTime) {
      const earlyLeave = calcEarlyLeaveMinutes(
        row.DefaultCheckOutTime,
        row.ScheduledEndTime,
      );
      updated.EarlyLeaveMinutes = earlyLeave > 0 ? earlyLeave : 0;
      if (earlyLeave > 0) {
        updated.Status = 'EarlyLeave';
      }
    }
  }

  return updated;
}

/** N — fill missing times with current clock time (HR attendance board button). */
export function applyNowTimesToRow<T extends AttendanceTimeFillRow>(row: T, now: string): T {
  if (MANUAL_STATUSES.includes(row.Status)) {
    return { ...row };
  }

  const updated = { ...row };

  if (!row.CheckInTime) {
    updated.CheckInTime = now;
    const late = calcLateMinutes(now, row.ScheduledStartTime);
    updated.LateMinutes = late;
    updated.Status = late > 0 ? 'Late' : 'Present';
  }

  if (!row.CheckOutTime) {
    updated.CheckOutTime = now;
    if (updated.CheckInTime && row.ScheduledEndTime) {
      const earlyLeave = calcEarlyLeaveMinutes(now, row.ScheduledEndTime);
      updated.EarlyLeaveMinutes = earlyLeave > 0 ? earlyLeave : 0;
      if (earlyLeave > 0) {
        updated.Status = 'EarlyLeave';
      }
    }
  }

  return updated;
}
