import 'server-only';
import { getBranchById, listActiveBranches } from '@/lib/branch/repository';
import { getOpenBusinessDay } from '@/lib/branch/businessDay';
import type { BranchRecord } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import { memoizeInOperationalRequest } from '../requestScope';
import {
  isPastRolloverWindow,
  now as businessClockNow,
  resolveBusinessDate,
} from '../clock/BusinessClock';
import {
  isCatchUpMutationRequired,
  planBusinessDayReconciliation,
  type BusinessDayCatchUpMode,
} from '../domain/businessDayReconciliation';
import { BUSINESS_DAY_RECONCILE_USER_MESSAGE } from '../domain/invariants';
import {
  executeReconcileBusinessDay,
  type ReconcileBusinessDayResult,
  type ReconcileTrigger,
} from '../infra/businessDayMutationTx';

export type { ReconcileBusinessDayResult, ReconcileTrigger, BusinessDayCatchUpMode };

export type ReconcileAllBusinessDaysResult = {
  ok: boolean;
  trigger: ReconcileTrigger;
  results: ReconcileBusinessDayResult[];
};

export type EnsureBusinessDayCurrentArgs = {
  now?: Date;
  mode?: BusinessDayCatchUpMode;
  trigger?: ReconcileTrigger;
};

function sqlLeak(message: string): boolean {
  return /GETDATE|ECONNREFUSED|TCP Provider|Login failed|mssql|timeout|invalid object|syntax/i.test(
    message,
  );
}

function logReconcile(payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    type: 'BUSINESS_DAY_RECONCILE',
    persistedCloseReason: false,
    ...payload,
  });
  if (payload.success === false) {
    console.error(line);
  } else {
    console.warn(line);
  }
}

function snapshotFromPeek(args: {
  branchId: number;
  openDay: BusinessDayRecord | null;
  expectedDate: string;
  plan: ReturnType<typeof planBusinessDayReconciliation>;
}): Pick<
  ReconcileBusinessDayResult,
  | 'stale'
  | 'expectedBusinessDate'
  | 'openBusinessDayId'
  | 'openBusinessDate'
  | 'previousBusinessDayId'
  | 'previousBusinessDate'
> {
  return {
    stale: isCatchUpMutationRequired(args.plan),
    expectedBusinessDate: args.expectedDate,
    openBusinessDayId: args.openDay?.id,
    openBusinessDate: args.openDay?.newDay,
    previousBusinessDayId: args.openDay?.id,
    previousBusinessDate: args.openDay?.newDay,
  };
}

async function peekPlan(
  branch: Pick<BranchRecord, 'branchId' | 'timeZone' | 'businessDayCutoffTime'>,
  at: Date,
) {
  const openDay = await getOpenBusinessDay(branch.branchId);
  const expectedDate = resolveBusinessDate(branch, at);
  const pastRolloverWindow = isPastRolloverWindow(branch, at);
  const plan = planBusinessDayReconciliation({
    openDayDate: openDay?.newDay ?? null,
    expectedDate,
    pastRolloverWindow,
  });
  return { openDay, expectedDate, pastRolloverWindow, plan };
}

/**
 * Cheap peek first. Enters a mutation TX only when the planner is not NO_OP.
 */
export async function reconcileBusinessDay(args: {
  branchId: number;
  now?: Date;
  trigger?: ReconcileTrigger;
}): Promise<ReconcileBusinessDayResult> {
  const trigger = args.trigger ?? 'BEST_EFFORT_CATCH_UP';
  const at = args.now ?? businessClockNow();
  const branch = await getBranchById(args.branchId);
  if (!branch) {
    const failed: ReconcileBusinessDayResult = {
      branchId: args.branchId,
      action: 'FAILED',
      stale: true,
      errorCode: 'BRANCH_NOT_FOUND',
      error: 'BRANCH_NOT_FOUND',
    };
    logReconcile({
      trigger,
      timestamp: at.toISOString(),
      success: false,
      ...failed,
    });
    return failed;
  }
  if (!branch.isActive) {
    return {
      branchId: args.branchId,
      action: 'NO_OP',
      stale: false,
      closedShiftCount: 0,
    };
  }

  const peeked = await peekPlan(branch, at);
  if (peeked.plan === 'NO_OP') {
    const result: ReconcileBusinessDayResult = {
      branchId: branch.branchId,
      action: 'NO_OP',
      currentBusinessDayId: peeked.openDay?.id,
      currentBusinessDate: peeked.openDay?.newDay,
      closedShiftCount: 0,
      ...snapshotFromPeek({
        branchId: branch.branchId,
        openDay: peeked.openDay,
        expectedDate: peeked.expectedDate,
        plan: peeked.plan,
      }),
    };
    return result;
  }

  try {
    const result = await executeReconcileBusinessDay({
      branchId: branch.branchId,
      timeZone: branch.timeZone,
      businessDayCutoffTime: branch.businessDayCutoffTime,
      now: at,
      trigger,
    });
    const enriched: ReconcileBusinessDayResult = {
      ...result,
      stale: false,
      expectedBusinessDate: peeked.expectedDate,
      openBusinessDayId: result.currentBusinessDayId ?? peeked.openDay?.id,
      openBusinessDate: result.currentBusinessDate ?? peeked.openDay?.newDay,
    };
    logReconcile({
      trigger,
      timestamp: at.toISOString(),
      success: true,
      branchId: enriched.branchId,
      previousBusinessDayId: enriched.previousBusinessDayId,
      previousBusinessDate: enriched.previousBusinessDate,
      newBusinessDayId: enriched.currentBusinessDayId,
      newBusinessDate: enriched.currentBusinessDate,
      openBusinessDayId: peeked.openDay?.id,
      openBusinessDate: peeked.openDay?.newDay,
      expectedBusinessDate: peeked.expectedDate,
      closedShiftCount: enriched.closedShiftCount,
      action: enriched.action,
    });
    return enriched;
  } catch (err) {
    const internal = err instanceof Error ? err.message : String(err);
    const failed: ReconcileBusinessDayResult = {
      branchId: args.branchId,
      action: 'FAILED',
      errorCode: 'BUSINESS_DAY_RECONCILIATION_FAILED',
      error: sqlLeak(internal) ? 'BUSINESS_DAY_RECONCILIATION_FAILED' : internal,
      ...snapshotFromPeek({
        branchId: args.branchId,
        openDay: peeked.openDay,
        expectedDate: peeked.expectedDate,
        plan: peeked.plan,
      }),
    };
    logReconcile({
      trigger,
      timestamp: at.toISOString(),
      success: false,
      branchId: failed.branchId,
      openBusinessDayId: peeked.openDay?.id,
      openBusinessDate: peeked.openDay?.newDay,
      expectedBusinessDate: peeked.expectedDate,
      errorCode: failed.errorCode,
      error: internal,
      action: 'FAILED',
    });
    return failed;
  }
}

function throwIfStrictRequired(result: ReconcileBusinessDayResult): void {
  if (result.action === 'FAILED' || result.stale) {
    throw new BranchDomainError(
      result.action === 'FAILED' ? 'BUSINESS_DAY_RECONCILIATION_FAILED' : 'BUSINESS_DAY_STALE',
      BUSINESS_DAY_RECONCILE_USER_MESSAGE,
      result.action === 'FAILED' ? 503 : 409,
    );
  }
}

/**
 * Cheap peek first. Mutates only when the plan is not NO_OP.
 * STRICT throws if the day is stale after the rollover window and catch-up fails.
 * BEST_EFFORT returns FAILED/stale state without pretending the day is current.
 */
export async function ensureBusinessDayCurrent(
  branchId: number,
  args?: EnsureBusinessDayCurrentArgs,
): Promise<ReconcileBusinessDayResult> {
  const mode: BusinessDayCatchUpMode = args?.mode ?? 'BEST_EFFORT';
  const trigger: ReconcileTrigger =
    args?.trigger ?? (mode === 'STRICT' ? 'STRICT_CATCH_UP' : 'BEST_EFFORT_CATCH_UP');

  const result = await memoizeInOperationalRequest(
    `ensure-business-day:${branchId}`,
    async () => {
      try {
        return await reconcileBusinessDay({ branchId, now: args?.now, trigger });
      } catch (err) {
        const failed: ReconcileBusinessDayResult = {
          branchId,
          action: 'FAILED',
          stale: true,
          errorCode: 'BUSINESS_DAY_RECONCILIATION_FAILED',
          error: err instanceof Error ? err.message : String(err),
        };
        return failed;
      }
    },
  );

  if (mode === 'STRICT') {
    throwIfStrictRequired(result);
  }
  return result;
}

export async function reconcileAllBusinessDays(args?: {
  now?: Date;
  trigger?: ReconcileTrigger;
}): Promise<ReconcileAllBusinessDaysResult> {
  const trigger = args?.trigger ?? 'SCHEDULED';
  const at = args?.now ?? businessClockNow();
  const branches = await listActiveBranches();
  const results: ReconcileBusinessDayResult[] = [];

  for (const branch of branches) {
    try {
      results.push(
        await reconcileBusinessDay({
          branchId: branch.branchId,
          now: at,
          trigger,
        }),
      );
    } catch (err) {
      const failed: ReconcileBusinessDayResult = {
        branchId: branch.branchId,
        action: 'FAILED',
        stale: true,
        errorCode: 'BUSINESS_DAY_RECONCILIATION_FAILED',
        error: err instanceof Error ? err.message : String(err),
      };
      logReconcile({
        trigger,
        timestamp: at.toISOString(),
        success: false,
        branchId: branch.branchId,
        errorCode: failed.errorCode,
        error: failed.error,
        action: 'FAILED',
      });
      results.push(failed);
    }
  }

  return {
    ok: results.every((r) => r.action !== 'FAILED'),
    trigger,
    results,
  };
}
