import 'server-only';
import { getUserActiveStatus, getBranchById } from '@/lib/branch/repository';
import { validateUserBranchAccess } from '@/lib/branch/access';
import { BranchDomainError } from '@/lib/branch/types';
import { executeOpenOrHandoffShift } from '../infra/shiftMutationTx';
import { ensureBusinessDayCurrent } from './reconcileBusinessDay';
import type { ShiftMoveRecord } from '../infra/shiftMoveRecord';

export type HandoffShiftArgs = {
  userId: number;
  targetBranchId: number;
  shiftId: number;
};

/**
 * Atomically close the user's current OPEN shift (any branch) and open a new
 * one on targetBranchId. If none is open, this is a first open on the target.
 *
 * Invariant: at most one OPEN shift per user globally.
 */
export async function handoffShift(args: HandoffShiftArgs): Promise<ShiftMoveRecord> {
  const user = await getUserActiveStatus(args.userId);
  if (!user.exists) {
    throw new BranchDomainError('USER_NOT_FOUND', 'المستخدم غير موجود', 401);
  }
  if (user.isDeleted) {
    throw new BranchDomainError('USER_DELETED', 'تم تعطيل الحساب', 401);
  }

  const branch = await getBranchById(args.targetBranchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }
  if (!branch.isActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 403);
  }

  const access = await validateUserBranchAccess(args.userId, args.targetBranchId);
  if (!access.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  await ensureBusinessDayCurrent(args.targetBranchId, {
    mode: 'STRICT',
    trigger: 'STRICT_CATCH_UP',
  });

  return executeOpenOrHandoffShift({
    userId: args.userId,
    targetBranchId: args.targetBranchId,
    shiftId: args.shiftId,
    mode: 'handoff',
  });
}
