/**
 * Pure transfer blocker policy (safe for client + unit tests).
 * Keep in sync with preview/create in temporaryBranchTransfer.ts.
 */

/** Soft blockers — emergency transfer may proceed when operator acknowledges force. */
export const FORCEABLE_TRANSFER_BLOCKER_CODES = new Set([
  'EMPLOYEE_NOT_ASSIGNED_TO_BRANCH',
  'EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED',
  'EMPLOYEE_BOOKING_SERVICES_REQUIRED',
  'TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS',
]);

/**
 * Past-date / correction blockers — only forceable together with relocateAttendance
 * (moves attendance + non-posted payroll to destination).
 */
export const RELOCATABLE_TRANSFER_BLOCKER_CODES = new Set([
  'TRANSFER_ATTENDANCE_COMPLETED',
  'TRANSFER_PAYROLL_ALREADY_GENERATED',
]);

export function splitTransferBlockers(
  blockers: Array<{ code: string; message: string }>,
  opts?: { relocateAttendance?: boolean },
): {
  hard: Array<{ code: string; message: string }>;
  soft: Array<{ code: string; message: string }>;
  relocatable: Array<{ code: string; message: string }>;
} {
  const hard: Array<{ code: string; message: string }> = [];
  const soft: Array<{ code: string; message: string }> = [];
  const relocatable: Array<{ code: string; message: string }> = [];
  const allowRelocate = opts?.relocateAttendance === true;
  for (const b of blockers) {
    if (FORCEABLE_TRANSFER_BLOCKER_CODES.has(b.code)) {
      soft.push(b);
    } else if (RELOCATABLE_TRANSFER_BLOCKER_CODES.has(b.code)) {
      relocatable.push(b);
      if (allowRelocate) soft.push(b);
      else hard.push(b);
    } else {
      hard.push(b);
    }
  }
  return { hard, soft, relocatable };
}
