/**
 * Single server-side resolver for operational Branch / Day / Shift ownership.
 * Never trusts client-supplied BranchID, BusinessDayID, or ShiftMoveID.
 */
import 'server-only';
import { getActiveBranchContext } from '@/lib/branch/context';
import { validateUserBranchAccess } from '@/lib/branch/access';
import { getBranchById, getUserActiveStatus } from '@/lib/branch/repository';
import { BranchDomainError } from '@/lib/branch/types';
import { getBusinessDayById, getOpenBusinessDay } from '@/lib/branch/businessDay';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import {
  getUserOpenShift,
  getUserOpenShiftForBranch,
  type ShiftMoveRecord,
} from '@/lib/branch/shiftSession';
import { memoizeInOperationalRequest } from '../requestScope';
import { assertDayShiftOwnership } from '../domain/shiftOwnership';
import { ensureBusinessDayCurrent } from './reconcileBusinessDay';
import type {
  OperationalContext,
  OperationalScope,
  OperationalSnapshot,
  RequireOperationalContextArgs,
} from '../domain/types';

export type { OperationalContext, OperationalScope, OperationalSnapshot, RequireOperationalContextArgs };

async function assertUserCanOperateBranch(userId: number, branchId: number): Promise<void> {
  return memoizeInOperationalRequest(`operate:${userId}:${branchId}`, async () => {
    const user = await getUserActiveStatus(userId);
    if (!user.exists) {
      throw new BranchDomainError('USER_NOT_FOUND', 'المستخدم غير موجود', 401);
    }
    if (user.isDeleted) {
      throw new BranchDomainError('USER_DELETED', 'تم تعطيل الحساب', 401);
    }

    const branch = await getBranchById(branchId);
    if (!branch) {
      throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
    }
    if (!branch.isActive) {
      throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 403);
    }

    const access = await validateUserBranchAccess(userId, branchId);
    if (!access.canOperate) {
      throw new BranchDomainError(
        'OPERATION_NOT_ALLOWED',
        'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
        403,
      );
    }
  });
}

async function resolveSessionBranchId(userId: number): Promise<number> {
  const sessionBranch = await getActiveBranchContext();
  if (!sessionBranch) {
    throw new BranchDomainError(
      'SESSION_UPGRADE_REQUIRED',
      'يلزم إعادة تسجيل الدخول لتحديث جلسة الفرع',
      401,
    );
  }
  if (sessionBranch.userId !== userId) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'عدم تطابق المستخدم مع جلسة الفرع',
      401,
    );
  }
  return sessionBranch.branchId;
}

async function loadOpenDayAndBranchShift(
  userId: number,
  branchId: number,
): Promise<{ day: BusinessDayRecord | null; shift: ShiftMoveRecord | null }> {
  return memoizeInOperationalRequest(`day-shift:${userId}:${branchId}`, async () => {
    const [day, shift] = await Promise.all([
      getOpenBusinessDay(branchId),
      getUserOpenShiftForBranch(userId, branchId),
    ]);
    return { day, shift };
  });
}

async function resolveBranchScope(
  userId: number,
  branchId: number,
): Promise<OperationalSnapshot> {
  await assertUserCanOperateBranch(userId, branchId);
  return {
    context: {
      userId,
      branchId,
      businessDayId: null,
      businessDate: null,
      shiftSessionId: null,
    },
    day: null,
    shift: null,
  };
}

async function resolveDayScope(
  userId: number,
  branchId: number,
): Promise<OperationalSnapshot> {
  await assertUserCanOperateBranch(userId, branchId);
  await ensureBusinessDayCurrent(branchId, { mode: 'STRICT', trigger: 'STRICT_CATCH_UP' });
  const { day, shift } = await loadOpenDayAndBranchShift(userId, branchId);
  if (!day) {
    throw new BranchDomainError(
      'NO_OPEN_DAY',
      'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً',
      400,
    );
  }
  assertDayShiftOwnership(branchId, day, shift);
  return {
    context: {
      userId,
      branchId,
      businessDayId: day.id,
      businessDate: day.newDay,
      shiftSessionId: shift?.id ?? null,
    },
    day,
    shift,
  };
}

async function resolveShiftScope(
  userId: number,
  requestedBranchId: number | undefined,
): Promise<OperationalSnapshot> {
  const preview = await getUserOpenShift(userId);
  if (!preview || !preview.status) {
    throw new BranchDomainError(
      'NO_OPEN_SHIFT',
      'لا توجد وردية مفتوحة لهذا المستخدم',
      400,
    );
  }

  if (requestedBranchId != null && preview.branchId !== requestedBranchId) {
    throw new BranchDomainError(
      'SHIFT_BRANCH_MISMATCH',
      'الوردية لا تنتمي للفرع النشط',
      400,
    );
  }

  await ensureBusinessDayCurrent(preview.branchId, {
    mode: 'STRICT',
    trigger: 'STRICT_CATCH_UP',
  });

  const shift = await getUserOpenShift(userId);
  if (!shift || !shift.status) {
    throw new BranchDomainError(
      'NO_OPEN_SHIFT',
      'لا توجد وردية مفتوحة لهذا المستخدم',
      400,
    );
  }

  const [day] = await Promise.all([
    getBusinessDayById(shift.businessDayId),
    assertUserCanOperateBranch(userId, shift.branchId),
  ]);
  if (!day) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'يوم العمل المرتبط بالوردية غير موجود',
      400,
    );
  }
  assertDayShiftOwnership(shift.branchId, day, shift);

  return {
    context: {
      userId,
      branchId: shift.branchId,
      businessDayId: day.id,
      businessDate: day.newDay,
      shiftSessionId: shift.id,
    },
    day,
    shift,
  };
}

export async function requireOperationalSnapshot(
  args: RequireOperationalContextArgs,
): Promise<OperationalSnapshot> {
  const { userId, scope } = args;
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new BranchDomainError('USER_NOT_FOUND', 'المستخدم غير موجود', 401);
  }

  const memoKey = `snapshot:${scope}:${userId}:${args.branchId ?? 'session'}`;
  return memoizeInOperationalRequest(memoKey, async () => {
    if (scope === 'SHIFT') {
      return resolveShiftScope(userId, args.branchId);
    }

    const branchId =
      args.branchId != null ? args.branchId : await resolveSessionBranchId(userId);

    if (scope === 'BRANCH') {
      return resolveBranchScope(userId, branchId);
    }
    return resolveDayScope(userId, branchId);
  });
}

export async function requireOperationalContext(
  args: RequireOperationalContextArgs,
): Promise<OperationalContext> {
  const snapshot = await requireOperationalSnapshot(args);
  return snapshot.context;
}

export const OperationalContextService = {
  require: requireOperationalContext,
  requireSnapshot: requireOperationalSnapshot,
};
