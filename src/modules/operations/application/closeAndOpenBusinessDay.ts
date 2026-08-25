import 'server-only';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import {
  executeCloseAndOpenBusinessDay,
  type CloseAndOpenBusinessDayResult,
} from '../infra/businessDayMutationTx';

export async function closeAndOpenBusinessDaySession(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean; openDate?: string },
): Promise<CloseAndOpenBusinessDayResult> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }
  return executeCloseAndOpenBusinessDay(branchContext, options);
}
