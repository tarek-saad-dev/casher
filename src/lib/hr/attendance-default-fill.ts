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

/** D — fill missing times from employee defaults (HR attendance board button). */
export function applyDefaultTimesToRow<T extends AttendanceTimeFillRow>(row: T): T {
  const updated = { ...row };

  if (!row.CheckInTime && row.DefaultCheckInTime) {
    updated.CheckInTime = row.DefaultCheckInTime;
    if (!MANUAL_STATUSES.includes(updated.Status)) {
      const late = calcLateMinutes(row.DefaultCheckInTime, row.ScheduledStartTime);
      updated.LateMinutes = late;
      updated.Status = late > 0 ? 'Late' : 'Present';
    }
  }

  if (!row.CheckOutTime && row.DefaultCheckOutTime) {
    updated.CheckOutTime = row.DefaultCheckOutTime;
    if (updated.CheckInTime && row.ScheduledEndTime) {
      // calcEarlyLeaveMinutes(checkOut, scheduledEnd)
      const earlyLeave = calcEarlyLeaveMinutes(
        row.DefaultCheckOutTime,
        row.ScheduledEndTime,
      );
      updated.EarlyLeaveMinutes = earlyLeave > 0 ? earlyLeave : 0;
      if (!MANUAL_STATUSES.includes(updated.Status) && earlyLeave > 0) {
        updated.Status = 'EarlyLeave';
      }
    }
  }

  return updated;
}

/** N — fill missing times with current clock time (HR attendance board button). */
export function applyNowTimesToRow<T extends AttendanceTimeFillRow>(row: T, now: string): T {
  const updated = { ...row };

  if (!row.CheckInTime) {
    updated.CheckInTime = now;
    if (!MANUAL_STATUSES.includes(updated.Status)) {
      const late = calcLateMinutes(now, row.ScheduledStartTime);
      updated.LateMinutes = late;
      updated.Status = late > 0 ? 'Late' : 'Present';
    }
  }

  if (!row.CheckOutTime) {
    updated.CheckOutTime = now;
    if (updated.CheckInTime && row.ScheduledEndTime) {
      const earlyLeave = calcEarlyLeaveMinutes(now, row.ScheduledEndTime);
      updated.EarlyLeaveMinutes = earlyLeave > 0 ? earlyLeave : 0;
      if (!MANUAL_STATUSES.includes(updated.Status) && earlyLeave > 0) {
        updated.Status = 'EarlyLeave';
      }
    }
  }

  return updated;
}
