import 'server-only';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import { executeOpenBusinessDay } from '../infra/businessDayMutationTx';

export async function openBusinessDaySession(
  branchContext: ActiveBranchContext,
  date?: string,
): Promise<BusinessDayRecord> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }
  return executeOpenBusinessDay(branchContext, date);
}
