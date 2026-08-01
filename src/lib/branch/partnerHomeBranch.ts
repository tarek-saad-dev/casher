import 'server-only';
import { getPool, sql } from '@/lib/db';
import { PARTNER_ROLE_KEY } from '@/lib/partnerAccess';
import { grantUserBranchAccess } from './bootstrap';
import { getBranchById, listAllBranches, listUserBranchAccessRows } from './repository';
import { BranchDomainError } from './types';

export type PartnerUserBranchRow = {
  userId: number;
  userName: string;
  loginName: string;
  isDeleted: boolean;
  defaultBranchId: number | null;
  defaultBranchCode: string | null;
  defaultBranchName: string | null;
  canViewReports: boolean;
  branches: Array<{
    branchId: number;
    branchCode: string;
    branchName: string;
    isDefault: boolean;
    canViewReports: boolean;
    isActive: boolean;
  }>;
};

async function assertUserHasPartnerRole(userId: number): Promise<void> {
  const db = await getPool();
  const res = await db
    .request()
    .input('userId', sql.Int, userId)
    .input('roleKey', sql.NVarChar(50), PARTNER_ROLE_KEY)
    .query(`
      SELECT TOP 1 1 AS Ok
      FROM dbo.TblUserRoles ur
      INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
      WHERE ur.UserID = @userId
        AND r.RoleKey = @roleKey
        AND r.IsActive = 1
    `);
  if (!res.recordset[0]) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'المستخدم ليس لديه دور شريك',
      400,
    );
  }
}

/**
 * List login users with the partner role and their branch links.
 */
export async function listPartnerUsersWithBranches(): Promise<PartnerUserBranchRow[]> {
  const db = await getPool();
  const users = await db
    .request()
    .input('roleKey', sql.NVarChar(50), PARTNER_ROLE_KEY)
    .query(`
      SELECT u.UserID, u.UserName, u.loginName, ISNULL(u.isDeleted, 0) AS isDeleted
      FROM dbo.TblUser u
      INNER JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
      INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = @roleKey AND r.IsActive = 1
      ORDER BY u.UserName
    `);

  const rows: PartnerUserBranchRow[] = [];
  for (const u of users.recordset) {
    const userId = Number(u.UserID);
    const access = await listUserBranchAccessRows(userId);
    const active = access.filter((a) => a.isActive);
    const def = active.find((a) => a.isDefault) ?? null;
    rows.push({
      userId,
      userName: String(u.UserName),
      loginName: String(u.loginName),
      isDeleted: Boolean(u.isDeleted),
      defaultBranchId: def?.branchId ?? null,
      defaultBranchCode: def?.branchCode ?? null,
      defaultBranchName: def?.branchName ?? null,
      canViewReports: def?.canViewReports ?? false,
      branches: active.map((a) => ({
        branchId: a.branchId,
        branchCode: a.branchCode,
        branchName: a.branchName,
        isDefault: a.isDefault,
        canViewReports: a.canViewReports,
        isActive: a.isActive,
      })),
    });
  }
  return rows;
}

export type AssignPartnerHomeBranchResult = {
  userId: number;
  branchId: number;
  branchCode: string;
  branchName: string;
  accessId: number;
};

/**
 * Bind a partner login to a home branch:
 * - ensures TblUserBranchAccess with CanViewReports=1
 * - sets that row as the sole IsDefault (required for login)
 */
export async function assignPartnerHomeBranch(input: {
  userId: number;
  branchId: number;
  actorUserId: number;
}): Promise<AssignPartnerHomeBranchResult> {
  await assertUserHasPartnerRole(input.userId);

  const branch = await getBranchById(input.branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }

  const grant = await grantUserBranchAccess({
    userId: input.userId,
    branchId: input.branchId,
    canOperate: false,
    canViewReports: true,
    canSwitch: false,
    grantedByUserId: input.actorUserId,
    grantReason: 'partner-home-branch',
  });

  const db = await getPool();

  // Clear other defaults, then mark this branch as the sole default + report viewer.
  await db
    .request()
    .input('userId', sql.Int, input.userId)
    .input('branchId', sql.Int, input.branchId)
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
    .input('userId', sql.Int, input.userId)
    .input('branchId', sql.Int, input.branchId)
    .query(`
      UPDATE dbo.TblUserBranchAccess
      SET IsDefault = 1,
          CanViewReports = 1,
          IsActive = 1,
          ValidTo = NULL,
          UpdatedAt = SYSUTCDATETIME()
      WHERE UserID = @userId
        AND BranchID = @branchId
    `);

  return {
    userId: input.userId,
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    accessId: grant.accessId,
  };
}

export async function listBranchesForPartnerAssignment() {
  const branches = await listAllBranches();
  return branches.map((b) => ({
    branchId: b.branchId,
    branchCode: b.branchCode,
    branchName: b.branchName,
    shortName: b.shortName,
    isActive: b.isActive,
    lifecycleStatus: b.lifecycleStatus,
  }));
}
