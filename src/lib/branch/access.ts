import 'server-only';
import {
  branchNow,
  countUserValidDefaults,
  getUserBranchAccess,
  getUserDefaultBranch,
  isValidUserBranchAccess,
  listUserValidBranchAccess,
} from './repository';
import { BranchDomainError, type UserBranchAccessRecord } from './types';

export async function validateUserBranchAccess(
  userId: number,
  branchId: number,
  at: Date = branchNow(),
): Promise<UserBranchAccessRecord> {
  const row = await getUserBranchAccess(userId, branchId);
  if (!row) {
    throw new BranchDomainError(
      'NO_BRANCH_ACCESS',
      'لا يوجد ربط فرع صالح لهذا المستخدم',
      403,
    );
  }
  if (!row.isActive) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_INACTIVE',
      'صلاحية الفرع غير نشطة',
      403,
    );
  }
  if (row.validFrom.getTime() > at.getTime()) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_NOT_STARTED',
      'صلاحية الفرع لم تبدأ بعد',
      403,
    );
  }
  if (row.validTo != null && row.validTo.getTime() <= at.getTime()) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_EXPIRED',
      'صلاحية الفرع منتهية',
      403,
    );
  }
  if (!row.branchIsActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 403);
  }
  if (!isValidUserBranchAccess(row, at)) {
    throw new BranchDomainError('NO_BRANCH_ACCESS', 'صلاحية الفرع غير صالحة', 403);
  }
  return row;
}

export async function resolveLoginDefaultBranch(
  userId: number,
  at: Date = branchNow(),
): Promise<UserBranchAccessRecord> {
  const defaultCount = await countUserValidDefaults(userId, at);
  if (defaultCount === 0) {
    throw new BranchDomainError(
      'NO_DEFAULT_BRANCH',
      'لا يوجد فرع افتراضي صالح — يلزم ربط المستخدم بفرع',
      403,
    );
  }
  if (defaultCount > 1) {
    throw new BranchDomainError(
      'MULTIPLE_DEFAULT_BRANCHES',
      'يوجد أكثر من فرع افتراضي صالح — راجع صلاحيات الفروع',
      403,
    );
  }
  const row = await getUserDefaultBranch(userId, at);
  if (!row) {
    throw new BranchDomainError('NO_DEFAULT_BRANCH', 'لا يوجد فرع افتراضي صالح', 403);
  }
  return row;
}

export { listUserValidBranchAccess };
