/**
 * Compatibility re-export — implementation lives in Attendance module infra.
 */
export {
  ensureAttendanceBreakTimeSchema,
  replaceAttendanceBreakTimes,
  loadBreakTimesByAttendanceIds,
} from '@/modules/attendance/infra/attendanceBreakTimeDb';
