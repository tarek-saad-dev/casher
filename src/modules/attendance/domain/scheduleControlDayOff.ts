/**
 * Schedule-control day_off → attendance Absent (Phase B6).
 * Best-effort side effect of override apply. No OPEN guard.
 * Runtime Behavior Changes: NONE
 */

export const SCHEDULE_CONTROL_DAY_OFF_SOURCE = 'schedule-control day_off';

export type ApplyScheduleControlDayOffAttendanceInput = {
  empId: number;
  workDate: string;
  branchId: number;
  reason?: string | null;
};

export type ApplyScheduleControlDayOffAttendanceResult = {
  /** Always true when the command was invoked; SQL failures are swallowed by caller. */
  attempted: true;
};
