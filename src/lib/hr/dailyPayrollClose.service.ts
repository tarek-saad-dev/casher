/**
 * Phase 4 — Close / reopen orchestration for BranchID + WorkDate.
 * Keeps readiness evaluation out of empBranchWorkDayClose.service (no circular import).
 */
import 'server-only';

import { evaluateDailyPayrollReadiness } from '@/lib/hr/dailyPayrollReadiness.service';
import type { DailyPayrollReadinessResult } from '@/lib/hr/dailyPayrollReadiness.types';
import {
  persistEmpBranchWorkDayClosed,
  reopenEmpBranchWorkDay as reopenEmpBranchWorkDayRow,
} from '@/lib/hr/empBranchWorkDayClose.service';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import type { EmpBranchWorkDayCloseView } from '@/lib/hr/empBranchWorkDayClose.types';

export interface CloseEmpBranchWorkDayResult {
  view: EmpBranchWorkDayCloseView;
  readiness: DailyPayrollReadinessResult;
}

/**
 * Close after re-running readiness inside the mutation.
 * Rejects unless still READY_TO_CLOSE; concurrent close → PAYROLL_DAY_CLOSED.
 */
export async function closeEmpBranchWorkDay(args: {
  branchId: number;
  workDate: string;
  actorUserId: number;
}): Promise<CloseEmpBranchWorkDayResult> {
  const readiness = await evaluateDailyPayrollReadiness({
    branchId: args.branchId,
    workDate: args.workDate,
  });

  if (readiness.persistedState === 'CLOSED') {
    throw new EmpBranchWorkDayCloseError(
      'PAYROLL_DAY_CLOSED',
      'يوم الموظفين مقفل بالفعل لهذا الفرع والتاريخ',
    );
  }

  if (!readiness.readyToClose || readiness.recommendedState !== 'READY_TO_CLOSE') {
    throw new EmpBranchWorkDayCloseError(
      'NOT_READY_TO_CLOSE',
      readiness.summary.blockerCount > 0
        ? `اليوم غير جاهز للإقفال — ${readiness.summary.blockerCount} مشاكل`
        : 'اليوم غير جاهز للإقفال',
    );
  }

  const view = await persistEmpBranchWorkDayClosed({
    branchId: args.branchId,
    workDate: args.workDate,
    actorUserId: args.actorUserId,
  });

  return { view, readiness };
}

export async function reopenEmpBranchWorkDay(args: {
  branchId: number;
  workDate: string;
  actorUserId: number;
  reopenReason: string;
}): Promise<EmpBranchWorkDayCloseView> {
  return reopenEmpBranchWorkDayRow(args);
}
