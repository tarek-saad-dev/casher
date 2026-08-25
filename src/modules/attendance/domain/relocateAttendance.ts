/**
 * CLOSED-only attendance BranchID relocation (transfer / HR relocate).
 * Does not apply OPEN policy. Does not merge destination collisions.
 */

export type RelocateClosedAttendanceFromBranchInput = {
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
};

export type RelocateClosedAttendanceTowardDestinationInput = {
  empId: number;
  workDate: string;
  toBranchId: number;
};
