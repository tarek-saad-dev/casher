import 'server-only';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import {
  executeCloseBusinessDay,
  executeForceCloseBranchShifts,
  type CloseBusinessDayResult,
} from '../infra/businessDayMutationTx';

export async function closeBusinessDaySession(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean },
): Promise<CloseBusinessDayResult> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }
  return executeCloseBusinessDay(branchContext, options);
}

export async function forceCloseBranchShiftsSession(
  branchContext: ActiveBranchContext,
  reason: string,
): Promise<number> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }
  return executeForceCloseBranchShifts(branchContext, reason);
}
