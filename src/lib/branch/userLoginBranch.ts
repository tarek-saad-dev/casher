import 'server-only';
import { getPool, sql } from '@/lib/db';
import { grantUserBranchAccess } from './bootstrap';
import { getBranchById, listActiveBranches } from './repository';
import { BranchDomainError } from './types';

export type AssignUserLoginBranchResult = {
  userId: number;
  branchId: number;
  branchCode: string;
  branchName: string;
  accessId: number;
  grantedBranchIds: number[];
};

async function setSoleDefaultBranch(userId: number, branchId: number): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('userId', sql.Int, userId)
    .input('branchId', sql.Int, branchId)
    .query(`
      UPDATE dbo.TblUserBranchAccess
      SET IsDefault = 0,
          UpdatedAt = SYSUTCDATETIME()
      WHERE UserID = @userId
        AND BranchID <> @branchId
        AND IsDefault = 1
    `);

  await db
    .request()
    .input('userId', sql.Int, userId)
    .input('branchId', sql.Int, branchId)
    .query(`
      UPDATE dbo.TblUserBranchAccess
      SET IsDefault = 1,
          IsActive = 1,
          ValidTo = NULL,
          UpdatedAt = SYSUTCDATETIME()
      WHERE UserID = @userId
        AND BranchID = @branchId
    `);
}

/**
 * Ensure a login user can operate a branch and mark it as the sole IsDefault
 * (starting session branch). Switching still works via other CanOperate rows.
 */
export async function assignUserLoginBranch(input: {
  userId: number;
  branchId: number;
  actorUserId: number;
  canOperate?: boolean;
  canViewReports?: boolean;
  canSwitch?: boolean;
  grantReason?: string;
}): Promise<AssignUserLoginBranchResult> {
  const branch = await getBranchById(input.branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }
  if (!branch.isActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 400);
  }

  const grant = await grantUserBranchAccess({
    userId: input.userId,
    branchId: input.branchId,
    canOperate: input.canOperate !== false,
    canViewReports: input.canViewReports !== false,
    canSwitch: input.canSwitch !== false,
    grantedByUserId: input.actorUserId,
    grantReason: input.grantReason ?? 'user-login-default-branch',
  });

  await setSoleDefaultBranch(input.userId, input.branchId);

  return {
    userId: input.userId,
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    accessId: grant.accessId,
    grantedBranchIds: [branch.branchId],
  };
}

/**
 * Grant CanOperate on every active branch so staff can switch freely,
 * then set preferredBranchId (or the first active branch) as session start.
 */
export async function grantStaffAccessToAllActiveBranches(input: {
  userId: number;
  actorUserId: number;
  preferredBranchId?: number | null;
  grantReason?: string;
}): Promise<AssignUserLoginBranchResult> {
  const branches = await listActiveBranches();
  if (branches.length === 0) {
    throw new BranchDomainError(
      'BRANCH_NOT_FOUND',
      'لا يوجد فرع نشط لربط المستخدم به',
      400,
    );
  }

  const preferred =
    input.preferredBranchId &&
    branches.some((b) => b.branchId === input.preferredBranchId)
      ? input.preferredBranchId
      : branches[0]!.branchId;

  const grantedBranchIds: number[] = [];
  let preferredAccessId = 0;

  for (const branch of branches) {
    const grant = await grantUserBranchAccess({
      userId: input.userId,
      branchId: branch.branchId,
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
      grantedByUserId: input.actorUserId,
      grantReason: input.grantReason ?? 'user-create-all-active-branches',
    });
    grantedBranchIds.push(branch.branchId);
    if (branch.branchId === preferred) {
      preferredAccessId = grant.accessId;
    }
  }

  await setSoleDefaultBranch(input.userId, preferred);

  const start = branches.find((b) => b.branchId === preferred)!;
  return {
    userId: input.userId,
    branchId: start.branchId,
    branchCode: start.branchCode,
    branchName: start.branchName,
    accessId: preferredAccessId,
    grantedBranchIds,
  };
}
