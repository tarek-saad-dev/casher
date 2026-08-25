import { viewMatchesOperational } from '@/lib/operations/viewOperationalState';

export type ShiftWriteGateReason =
  | 'ready'
  | 'loading'
  | 'unauthenticated'
  | 'no_day'
  | 'no_shift'
  | 'handoff_required';

export type ShiftWriteGateInput = {
  loading: boolean;
  isAuthenticated: boolean;
  hasActiveDay: boolean;
  hasOpenShift: boolean;
  viewBranchId: number | null | undefined;
  operationalBranchId: number | null | undefined;
};

/** Classify whether a SHIFT-scoped write can proceed on the viewed branch. */
export function classifyShiftWriteGate(input: ShiftWriteGateInput): ShiftWriteGateReason {
  if (input.loading) return 'loading';
  if (!input.isAuthenticated) return 'unauthenticated';

  const matches = viewMatchesOperational(input.viewBranchId, input.operationalBranchId);

  if (matches && input.hasOpenShift && input.hasActiveDay) {
    return 'ready';
  }

  if (input.hasOpenShift && !matches) {
    return 'handoff_required';
  }

  if (!input.hasActiveDay) {
    return 'no_day';
  }

  return 'no_shift';
}

export function shiftWriteReady(reason: ShiftWriteGateReason): boolean {
  return reason === 'ready';
}
