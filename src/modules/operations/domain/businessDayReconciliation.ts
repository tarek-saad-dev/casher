/**
 * Pure reconciliation plan. Mutations live in businessDayMutationTx.
 *
 * After the branch-local rollover window, converge to exactly one OPEN
 * BusinessDay whose date equals BusinessClock.expectedDate. Do not
 * synthesize skipped intermediate days.
 */
export type ReconcilePlanAction = 'NO_OP' | 'ROLLED_OVER' | 'OPENED_MISSING_DAY';

export type BusinessDayCatchUpMode = 'STRICT' | 'BEST_EFFORT';

export function planBusinessDayReconciliation(args: {
  openDayDate: string | null;
  expectedDate: string;
  pastRolloverWindow: boolean;
}): ReconcilePlanAction {
  if (args.openDayDate === args.expectedDate) return 'NO_OP';
  if (args.openDayDate && args.openDayDate > args.expectedDate) return 'NO_OP';
  if (args.openDayDate && args.openDayDate < args.expectedDate) {
    return args.pastRolloverWindow ? 'ROLLED_OVER' : 'NO_OP';
  }
  return 'OPENED_MISSING_DAY';
}

/** True when the planner says the OPEN day is not the expected current day. */
export function isCatchUpMutationRequired(plan: ReconcilePlanAction): boolean {
  return plan !== 'NO_OP';
}
