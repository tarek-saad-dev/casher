/**
 * Phase A — thin adapter. Implementation: legacyBranchAttendance (Attendance-owned).
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
} from './legacyBranchAttendance';
