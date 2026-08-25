import 'server-only';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import { executeCloseOwnOpenShift, executeCloseShiftById } from '../infra/shiftMutationTx';
import type { ShiftMoveRecord } from '../infra/shiftMoveRecord';

export async function closeShiftSession(
  branchContext: ActiveBranchContext,
  shiftMoveId: number,
): Promise<ShiftMoveRecord> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  return executeCloseShiftById({
    shiftMoveId,
    expectedBranchId: branchContext.branchId,
  });
}

export async function closeOwnOpenShiftSession(userId: number): Promise<ShiftMoveRecord> {
  return executeCloseOwnOpenShift(userId);
}
