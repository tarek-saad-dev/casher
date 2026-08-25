/**
 * Compatibility re-export — implementation lives in Attendance module infra.
 * Legacy checkIn/checkOut + eligibility helpers (no live HTTP writers).
 */
export {
  AttendanceDomainError,
  assertEmployeeEligibleForBranchAttendance,
  checkInEmployee,
  checkOutEmployee,
  getBranchAttendanceByEmpDate,
  getOpenAttendanceForEmployee,
  loadAttendanceOwnedByBranch,
  resolveAttendanceWorkDate,
  type AttendanceRow,
} from '@/modules/attendance/infra/legacyBranchAttendance';
