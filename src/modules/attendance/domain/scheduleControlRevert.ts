/**
 * Schedule-control override DELETE → revert tagged Absent (Phase B6).
 * Only EmpID + WorkDate + Notes tag — no BranchID filter (current production).
 * Best-effort. Runtime Behavior Changes: NONE
 */

export const SCHEDULE_CONTROL_DAY_OFF_REVERT_SOURCE = 'schedule-control day_off';

export type RevertScheduleControlDayOffAttendanceInput = {
  empId: number;
  workDate: string;
  /** Notes prefix, currently "schedule-control day_off" */
  sourceTag?: string;
};

export type RevertScheduleControlDayOffAttendanceResult = {
  attendanceReverted: boolean;
};
