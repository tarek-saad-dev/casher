/**
 * Auto-absence attendance mutation contract.
 * KNOWN LEGACY BRANCH-SCOPE BUG: EmpID + WorkDate without BranchID.
 */

export const AUTO_ABSENCE_INSERT_NOTES =
  'AUTO_ABSENCE after scheduled start + threshold' as const;

export const AUTO_ABSENCE_UPDATE_NOTES_SUFFIX = ' | AUTO_ABSENCE' as const;

export type MarkAutoAbsenceAttendanceInput = {
  empId: number;
  branchId: number;
  workDate: string;
};
