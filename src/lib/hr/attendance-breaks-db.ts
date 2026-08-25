/**
 * Compatibility re-export — implementation lives in Attendance module infra.
 */
export {
  ensureAttendanceBreakSchema,
  replaceAttendanceBreaks,
  resolveBreaksFromBody,
  loadBreaksByAttendanceIds,
  loadBreaksByEmpIdsOnWorkDate,
} from '@/modules/attendance/infra/attendanceBreaksDb';
