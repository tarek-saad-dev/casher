/**
 * Work-on-day-off — current production semantics (Phase B5).
 * Dedicated punch command. No OPEN guard. DUAL_OPEN possible.
 * Runtime Behavior Changes: NONE
 */

export const WORK_ON_DAY_OFF_DEFAULT_REASON = 'نزل يشتغل يوم إجازته';

export const WORK_ON_DAY_OFF_SOURCE_TAG = 'work-on-day-off';

export type WorkOnDayOffInput = {
  empId: number;
  date: string;
  branchId: number;
  reason?: string | null;
  sourceTag?: string;
};

export type WorkOnDayOffResult = {
  ok: true;
  message: string;
  checkInTime: string;
  branchId: number;
  dayOffOverridesCleared: number;
  dayOffRowsCleared: number;
  customHours: { start: string; end: string };
};
