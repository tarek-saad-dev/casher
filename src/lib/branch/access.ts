import 'server-only';
import {
  branchNow,
  getUserBranchAccess,
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

/**
 * Pick a branch for the login session.
 * Prefers IsDefault when present, otherwise any valid operable branch.
 * Does not fail on missing/multiple defaults — only when the user has no
 * valid branch access at all.
 */
export async function resolveLoginDefaultBranch(
  userId: number,
  at: Date = branchNow(),
): Promise<UserBranchAccessRecord> {
  const valid = await listUserValidBranchAccess(userId, at);
  if (valid.length === 0) {
    throw new BranchDomainError(
      'NO_BRANCH_ACCESS',
      'لا توجد صلاحية فرع لهذا المستخدم — راجع المدير',
      403,
    );
  }

  const defaults = valid.filter((r) => r.isDefault);
  if (defaults.length >= 1) {
    return pickPreferredAccess(defaults);
  }

  const operable = valid.filter((r) => r.canOperate);
  if (operable.length >= 1) {
    return pickPreferredAccess(operable);
  }

  return pickPreferredAccess(valid);
}

function pickPreferredAccess(rows: UserBranchAccessRecord[]): UserBranchAccessRecord {
  return [...rows].sort((a, b) => a.branchId - b.branchId)[0]!;
}

export { listUserValidBranchAccess };
