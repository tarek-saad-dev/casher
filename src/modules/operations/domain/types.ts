import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import type { ShiftMoveRecord } from '@/lib/branch/shiftSession';

export type OperationalScope = 'BRANCH' | 'DAY' | 'SHIFT';

/**
 * Server-side operational ownership. IDs are always derived from session access
 * and/or database state — never from a client-supplied BranchID / BusinessDayID /
 * ShiftMoveID.
 */
export type OperationalContext = {
  userId: number;
  branchId: number;
  businessDayId: number | null;
  businessDate: string | null;
  shiftSessionId: number | null;
};

export type RequireOperationalContextArgs = {
  userId: number;
  /** When omitted, BRANCH/DAY use the session ViewBranch cookie. SHIFT derives from the OPEN ShiftSession. */
  branchId?: number;
  scope: OperationalScope;
};

export type OperationalSnapshot = {
  context: OperationalContext;
  day: BusinessDayRecord | null;
  shift: ShiftMoveRecord | null;
};
