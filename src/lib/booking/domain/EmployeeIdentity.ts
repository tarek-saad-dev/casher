/**
 * Booking V2 — global employee identity across branches.
 *
 * Same EmpID in GLEEM and CAMP_CAESAR is intentional: one human resource.
 * Collision / lock / busy logic must key by employeeId (optionally + absolute
 * interval), never by (branchId, empId) as separate resources.
 */

export type GlobalEmployeeId = number & { readonly __brand: 'GlobalEmployeeId' };

export function parseGlobalEmployeeId(value: unknown): GlobalEmployeeId {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`INVALID_EMPLOYEE_ID:${String(value)}`);
  }
  return n as GlobalEmployeeId;
}

/**
 * Canonical resource key for concurrency / busy / hold collision.
 * Branch context is scheduling context only — not part of the resource identity.
 */
export function globalEmployeeResourceKey(employeeId: number): string {
  const id = parseGlobalEmployeeId(employeeId);
  return `emp:${id}`;
}

/**
 * Interval lock resource spanning all branches for one employee.
 * Matches the spirit of existing `booking:emp:{id}:…` locks.
 */
export function globalEmployeeIntervalResourceKey(args: {
  employeeId: number;
  startAtMs: number;
  endAtMs: number;
}): string {
  return `${globalEmployeeResourceKey(args.employeeId)}:${args.startAtMs}:${args.endAtMs}`;
}

export type EmployeeBranchAssignmentContext = {
  employeeId: number;
  /** Branch where the booking / day-plan is evaluated. */
  branchId: number;
  /** Other branches where the same EmpID may also be assigned (informational). */
  otherBranchIds?: number[];
};

/**
 * Multi-branch safety check: assignments of the same EmpID are one resource.
 * Does not invent collisions by itself — callers supply overlapping intervals.
 */
export function assertSingleGlobalEmployeeResource(args: {
  employeeId: number;
  /** Intervals already held / booked for this EmpID in ANY branch. */
  overlappingIntervalsInAnyBranch: Array<{
    branchId: number | null;
    startAtMs: number;
    endAtMs: number;
  }>;
  candidate: { startAtMs: number; endAtMs: number };
}): { ok: true } | { ok: false; conflictBranchId: number | null } {
  const { startAtMs, endAtMs } = args.candidate;
  for (const iv of args.overlappingIntervalsInAnyBranch) {
    if (iv.startAtMs < endAtMs && iv.endAtMs > startAtMs) {
      return { ok: false, conflictBranchId: iv.branchId };
    }
  }
  return { ok: true };
}
