/**
 * Pure helpers for Phase 1C multi-branch barber availability (safe for unit tests).
 */

export function humanizeBranchCode(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function buildBarberAvailabilitySlotId(args: {
  empId: number;
  branchCode: string;
  date: string;
  time: string;
  dayOffset: 0 | 1;
}): string {
  return `${args.empId}:${args.branchCode}:${args.date}:${args.time}:${args.dayOffset}`;
}

/** Stable chronological sort for aggregated slots (absolute start, then branchCode). */
export function sortBarberAvailabilitySlotsByAbsoluteStart<
  T extends { startDateTime: string; branchCode: string },
>(slots: T[]): T[] {
  return [...slots].sort((a, b) => {
    const aMs = new Date(a.startDateTime).getTime();
    const bMs = new Date(b.startDateTime).getTime();
    if (aMs !== bMs) return aMs - bMs;
    return a.branchCode.localeCompare(b.branchCode);
  });
}

export const MAX_BARBER_AVAILABILITY_DAYS = 31;
export const MAX_BARBER_AVAILABILITY_SERVICES = 12;
export const BRANCH_EVAL_CONCURRENCY = 2;
