/**
 * Bulk date-range auto-close for Daily Payroll.
 * Reuses runNightlyClose + closeEmpBranchWorkDay only — no new payroll formulas.
 */

import 'server-only';

import { listActiveBranches } from '@/lib/branch';
import { closeEmpBranchWorkDay } from '@/lib/hr/dailyPayrollClose.service';
import { getEmpBranchWorkDayCloseState } from '@/lib/hr/empBranchWorkDayClose.service';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { runNightlyClose } from '@/lib/hr/nightly-close.service';
import {
  bulkCloseRangeLockKey,
  releaseBulkCloseRangeLock,
  summarizeBulkCloseBranchOutcomes,
  tryAcquireBulkCloseRangeLock,
  validateBulkCloseRangeParams,
  type BulkCloseBranchOutcome,
} from '@/lib/hr/dailyPayrollBulkCloseRange.validation';

export type {
  BulkCloseBranchOutcome,
} from '@/lib/hr/dailyPayrollBulkCloseRange.validation';

export interface BulkCloseBranchResult {
  workDate: string;
  branchId: number;
  branchCode: string;
  branchName: string;
  outcome: BulkCloseBranchOutcome;
  reason: string | null;
}

export interface BulkCloseDayResult {
  workDate: string;
  nightlyOk: boolean;
  nightlyError: string | null;
  branches: BulkCloseBranchResult[];
}

export interface BulkCloseRangeSummary {
  daysProcessed: number;
  branchesProcessed: number;
  closed: number;
  alreadyClosed: number;
  notReady: number;
  failed: number;
}

export interface BulkCloseRangeResult {
  ok: boolean;
  fromDate: string;
  toDate: string;
  daysProcessed: number;
  summary: BulkCloseRangeSummary;
  days: BulkCloseDayResult[];
  error?: string;
}

export type BulkCloseProgressEvent =
  | {
      type: 'start';
      fromDate: string;
      toDate: string;
      totalDays: number;
      branchCount: number;
      branches: Array<{ branchId: number; branchCode: string; branchName: string }>;
    }
  | {
      type: 'day_start';
      workDate: string;
      dayIndex: number;
      totalDays: number;
    }
  | {
      type: 'nightly';
      workDate: string;
      ok: boolean;
      error: string | null;
    }
  | {
      type: 'branch';
      workDate: string;
      branchId: number;
      branchCode: string;
      branchName: string;
      outcome: BulkCloseBranchOutcome;
      reason: string | null;
    }
  | {
      type: 'day_done';
      workDate: string;
      dayIndex: number;
      totalDays: number;
    }
  | {
      type: 'done';
      result: BulkCloseRangeResult;
    };

export type BulkCloseProgressListener = (event: BulkCloseProgressEvent) => void;

function emptyFailureResult(
  fromDate: string,
  toDate: string,
  error: string,
): BulkCloseRangeResult {
  return {
    ok: false,
    fromDate,
    toDate,
    daysProcessed: 0,
    summary: {
      daysProcessed: 0,
      branchesProcessed: 0,
      closed: 0,
      alreadyClosed: 0,
      notReady: 0,
      failed: 0,
    },
    days: [],
    error,
  };
}

export async function runDailyPayrollBulkCloseRange(params: {
  fromDate: string;
  toDate: string;
  actorUserId: number;
  onProgress?: BulkCloseProgressListener;
}): Promise<BulkCloseRangeResult> {
  const emit = params.onProgress ?? (() => undefined);

  const validated = validateBulkCloseRangeParams({
    fromDate: params.fromDate,
    toDate: params.toDate,
  });
  if (!validated.ok) {
    return emptyFailureResult(
      String(params.fromDate ?? ''),
      String(params.toDate ?? ''),
      validated.error,
    );
  }

  const { fromDate, toDate, dates } = validated;
  const lockKey = bulkCloseRangeLockKey(fromDate, toDate);
  if (!tryAcquireBulkCloseRangeLock(lockKey)) {
    return emptyFailureResult(
      fromDate,
      toDate,
      'عملية قفل رينج قيد التنفيذ بالفعل — انتظر انتهائها ثم أعد المحاولة',
    );
  }

  const dayResults: BulkCloseDayResult[] = [];
  const allBranchOutcomes: Array<{ outcome: BulkCloseBranchOutcome }> = [];

  try {
    const activeBranches = await listActiveBranches();

    emit({
      type: 'start',
      fromDate,
      toDate,
      totalDays: dates.length,
      branchCount: activeBranches.length,
      branches: activeBranches.map((b) => ({
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
      })),
    });

    for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
      const workDate = dates[dayIndex]!;
      const dayResult: BulkCloseDayResult = {
        workDate,
        nightlyOk: false,
        nightlyError: null,
        branches: [],
      };

      emit({
        type: 'day_start',
        workDate,
        dayIndex: dayIndex + 1,
        totalDays: dates.length,
      });

      try {
        const nightly = await runNightlyClose({
          workDate,
          dryRun: false,
          skipWhatsApp: true,
        });
        dayResult.nightlyOk = nightly.ok !== false;
        if (!dayResult.nightlyOk) {
          dayResult.nightlyError =
            (Array.isArray(nightly.errors) && nightly.errors[0]) ||
            'فشل قفل اليوم التلقائي لهذا التاريخ';
        }
      } catch (err: unknown) {
        dayResult.nightlyOk = false;
        dayResult.nightlyError =
          err instanceof Error ? err.message : 'فشل قفل اليوم التلقائي لهذا التاريخ';
      }

      emit({
        type: 'nightly',
        workDate,
        ok: dayResult.nightlyOk,
        error: dayResult.nightlyError,
      });

      for (const branch of activeBranches) {
        const branchRow: BulkCloseBranchResult = {
          workDate,
          branchId: branch.branchId,
          branchCode: branch.branchCode,
          branchName: branch.branchName,
          outcome: 'failed',
          reason: null,
        };

        try {
          const closeView = await getEmpBranchWorkDayCloseState(branch.branchId, workDate);
          if (closeView.state === 'CLOSED') {
            branchRow.outcome = 'alreadyClosed';
            branchRow.reason = 'اليوم مقفل بالفعل لهذا الفرع';
          } else {
            await closeEmpBranchWorkDay({
              branchId: branch.branchId,
              workDate,
              actorUserId: params.actorUserId,
            });
            branchRow.outcome = 'closed';
            branchRow.reason = null;
          }
        } catch (err: unknown) {
          if (err instanceof EmpBranchWorkDayCloseError) {
            if (err.code === 'PAYROLL_DAY_CLOSED') {
              branchRow.outcome = 'alreadyClosed';
              branchRow.reason = err.message;
            } else if (err.code === 'NOT_READY_TO_CLOSE') {
              branchRow.outcome = 'notReady';
              branchRow.reason = err.message;
            } else {
              branchRow.outcome = 'failed';
              branchRow.reason = err.message;
            }
          } else {
            branchRow.outcome = 'failed';
            branchRow.reason =
              err instanceof Error ? err.message : 'تعذر إقفال يوم الموظفين لهذا الفرع';
          }
        }

        dayResult.branches.push(branchRow);
        allBranchOutcomes.push({ outcome: branchRow.outcome });
        emit({
          type: 'branch',
          workDate,
          branchId: branchRow.branchId,
          branchCode: branchRow.branchCode,
          branchName: branchRow.branchName,
          outcome: branchRow.outcome,
          reason: branchRow.reason,
        });
      }

      dayResults.push(dayResult);
      emit({
        type: 'day_done',
        workDate,
        dayIndex: dayIndex + 1,
        totalDays: dates.length,
      });
    }

    const branchSummary = summarizeBulkCloseBranchOutcomes(allBranchOutcomes);
    const hasHardFailure =
      dayResults.some((d) => d.nightlyOk === false) || branchSummary.failed > 0;

    const result: BulkCloseRangeResult = {
      ok: !hasHardFailure,
      fromDate,
      toDate,
      daysProcessed: dayResults.length,
      summary: {
        daysProcessed: dayResults.length,
        ...branchSummary,
      },
      days: dayResults,
    };

    emit({ type: 'done', result });
    return result;
  } finally {
    releaseBulkCloseRangeLock(lockKey);
  }
}
