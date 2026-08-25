import 'server-only';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import { executeOpenOrHandoffShift } from '../infra/shiftMutationTx';
import { ensureBusinessDayCurrent } from './reconcileBusinessDay';
import type { ShiftMoveRecord } from '../infra/shiftMoveRecord';

/**
 * Open a shift on the caller's active branch.
 * If the user already has an OPEN shift on another branch, atomically hands off.
 * After the rollover window, STRICT catch-up must land on today's BusinessDay first.
 */
export async function openShiftSession(
  branchContext: ActiveBranchContext,
  userId: number,
  shiftId: number,
): Promise<ShiftMoveRecord> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  await ensureBusinessDayCurrent(branchContext.branchId, {
    mode: 'STRICT',
    trigger: 'STRICT_CATCH_UP',
  });

  return executeOpenOrHandoffShift({
    userId,
    targetBranchId: branchContext.branchId,
    shiftId,
    mode: 'open',
  });
}
