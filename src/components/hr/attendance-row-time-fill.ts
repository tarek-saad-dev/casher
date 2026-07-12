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

/** D — fill missing times from employee defaults (same as legacy /admin/attendance). */
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
      const earlyLeave = calcEarlyLeaveMinutes(row.ScheduledEndTime, row.DefaultCheckOutTime);
      updated.EarlyLeaveMinutes = earlyLeave > 0 ? earlyLeave : 0;
      if (!MANUAL_STATUSES.includes(updated.Status) && earlyLeave > 0) {
        updated.Status = 'EarlyLeave';
      }
    }
  }

  return updated;
}

/** N — fill missing times with current clock time (same as legacy /admin/attendance). */
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
      const earlyLeave = calcEarlyLeaveMinutes(row.ScheduledEndTime, now);
      updated.EarlyLeaveMinutes = earlyLeave > 0 ? earlyLeave : 0;
      if (!MANUAL_STATUSES.includes(updated.Status) && earlyLeave > 0) {
        updated.Status = 'EarlyLeave';
      }
    }
  }

  return updated;
}
