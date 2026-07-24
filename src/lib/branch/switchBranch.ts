/**
 * Phase 1H — secure active-branch session switching.
 * Access rule: effective CanOperate on an active branch (no admin bypass).
 * Does not mutate IsDefault. Does not add CanSwitch gating.
 */
import 'server-only';
import { getBranchById, getUserActiveStatus, listUserValidBranchAccess } from './repository';
import { validateUserBranchAccess } from './access';
import { writeSensitiveAuditEvent } from '@/lib/sensitiveActionAudit';
import {
  createSession,
  getSession,
  verifySessionCookie,
} from '@/lib/session';
import type { SessionUser } from '@/lib/session-types';
import { BRANCH_SESSION_VERSION, BranchDomainError } from '@/lib/branch/types';

export type SwitchableBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isCurrent: boolean;
};

export type ActiveBranchSafe = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
};

export type SwitchBranchResult =
  | {
      ok: true;
      changed: boolean;
      activeBranch: ActiveBranchSafe;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

function toSafe(branch: {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
}): ActiveBranchSafe {
  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
  };
}

/**
 * Branches the authenticated user may switch the session to.
 * Requires: user not deleted, branch active, access active/effective, CanOperate=1.
 */
export async function listSwitchableBranchesForUser(
  userId: number,
  currentBranchId: number,
): Promise<SwitchableBranch[]> {
  const status = await getUserActiveStatus(userId);
  if (!status.exists || status.isDeleted) {
    throw new BranchDomainError('USER_DELETED', 'تم تعطيل الحساب', 401);
  }

  const rows = await listUserValidBranchAccess(userId);
  const operable = rows.filter((r) => r.canOperate && r.branchIsActive && r.isActive);

  const mapped: SwitchableBranch[] = operable.map((r) => ({
    branchId: r.branchId,
    branchCode: r.branchCode,
    branchName: r.branchName,
    shortName: r.shortName,
    isCurrent: r.branchId === currentBranchId,
  }));

  mapped.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.branchCode.localeCompare(b.branchCode);
  });

  return mapped;
}

async function auditSwitch(args: {
  user: SessionUser;
  request?: Request;
  success: boolean;
  reasonCode?: string;
  oldBranchId: number;
  oldBranchCode: string;
  newBranchId: number | null;
  newBranchCode: string | null;
}): Promise<void> {
  try {
    await writeSensitiveAuditEvent({
      actionType: args.success ? 'BRANCH_SESSION_SWITCH' : 'BRANCH_SESSION_SWITCH_DENIED',
      user: args.user,
      request: args.request,
      actionMethod: 'POST',
      endpointPath: '/api/auth/switch-branch',
      entityType: 'TblBranch',
      entityId: args.newBranchId != null ? String(args.newBranchId) : String(args.oldBranchId),
      executionStatus: args.success ? 'success' : 'failed',
      errorMessage: args.success ? null : args.reasonCode ?? 'DENIED',
      reason: args.reasonCode ?? null,
      oldData: {
        ActiveBranchID: args.oldBranchId,
        ActiveBranchCode: args.oldBranchCode,
      },
      newData: args.success
        ? {
            ActiveBranchID: args.newBranchId,
            ActiveBranchCode: args.newBranchCode,
          }
        : {
            reasonCode: args.reasonCode,
            requestedBranchId: args.newBranchId,
          },
      changedFields: args.success ? ['ActiveBranchID', 'ActiveBranchCode'] : null,
    });
  } catch (err) {
    console.error('[switch-branch] audit write failed', err);
  }
}

/**
 * Switch the authenticated session's ActiveBranch* claims.
 * Reissues the signed cookie. Never updates IsDefault.
 */
export async function switchActiveBranch(args: {
  branchId: number;
  request?: Request;
}): Promise<SwitchBranchResult> {
  const verified = await verifySessionCookie();
  if (!verified.ok) {
    return {
      ok: false,
      status: 401,
      code: 'SESSION_INVALID',
      message: 'يلزم إعادة تسجيل الدخول',
    };
  }

  const sessionUser = await getSession();
  if (!sessionUser) {
    return {
      ok: false,
      status: 401,
      code: 'SESSION_INVALID',
      message: 'يلزم إعادة تسجيل الدخول',
    };
  }

  const oldBranchId = sessionUser.ActiveBranchID;
  const oldBranchCode = sessionUser.ActiveBranchCode;

  const status = await getUserActiveStatus(sessionUser.UserID);
  if (!status.exists || status.isDeleted) {
    return {
      ok: false,
      status: 401,
      code: 'USER_DELETED',
      message: 'تم تعطيل الحساب',
    };
  }

  if (!Number.isFinite(args.branchId) || args.branchId <= 0) {
    await auditSwitch({
      user: sessionUser,
      request: args.request,
      success: false,
      reasonCode: 'INVALID_BRANCH',
      oldBranchId,
      oldBranchCode,
      newBranchId: null,
      newBranchCode: null,
    });
    return {
      ok: false,
      status: 400,
      code: 'INVALID_BRANCH',
      message: 'معرّف الفرع غير صالح',
    };
  }

  // Same branch — idempotent success (no default-row mutation, no forced cookie churn)
  if (args.branchId === oldBranchId) {
    const current = await getBranchById(oldBranchId);
    if (!current || !current.isActive) {
      return {
        ok: false,
        status: 404,
        code: 'BRANCH_NOT_FOUND',
        message: 'الفرع غير متاح',
      };
    }
    return {
      ok: true,
      changed: false,
      activeBranch: toSafe(current),
    };
  }

  const target = await getBranchById(args.branchId);
  // Non-disclosing: unknown or inactive → same 404
  if (!target || !target.isActive) {
    await auditSwitch({
      user: sessionUser,
      request: args.request,
      success: false,
      reasonCode: !target ? 'INVALID_BRANCH' : 'INACTIVE_BRANCH',
      oldBranchId,
      oldBranchCode,
      newBranchId: args.branchId,
      newBranchCode: target?.branchCode ?? null,
    });
    return {
      ok: false,
      status: 404,
      code: 'BRANCH_NOT_FOUND',
      message: 'الفرع غير متاح',
    };
  }

  let access;
  try {
    access = await validateUserBranchAccess(sessionUser.UserID, target.branchId);
  } catch (err) {
    const code =
      err instanceof BranchDomainError
        ? err.code === 'BRANCH_INACTIVE'
          ? 'INACTIVE_BRANCH'
          : err.code === 'BRANCH_ACCESS_EXPIRED' || err.code === 'BRANCH_ACCESS_NOT_STARTED'
            ? 'NO_ACCESS'
            : 'NO_ACCESS'
        : 'NO_ACCESS';
    await auditSwitch({
      user: sessionUser,
      request: args.request,
      success: false,
      reasonCode: code,
      oldBranchId,
      oldBranchCode,
      newBranchId: target.branchId,
      newBranchCode: target.branchCode,
    });
    // Preserve current valid session — do not clear cookie
    return {
      ok: false,
      status: 403,
      code: 'BRANCH_ACCESS_DENIED',
      message: 'ليس لديك صلاحية تشغيل هذا الفرع',
    };
  }

  // Phase 1H rule: CanOperate required (admin UserLevel is not a bypass)
  if (!access.canOperate) {
    await auditSwitch({
      user: sessionUser,
      request: args.request,
      success: false,
      reasonCode: 'NO_ACCESS',
      oldBranchId,
      oldBranchCode,
      newBranchId: target.branchId,
      newBranchCode: target.branchCode,
    });
    return {
      ok: false,
      status: 403,
      code: 'BRANCH_ACCESS_DENIED',
      message: 'ليس لديك صلاحية تشغيل هذا الفرع',
    };
  }

  // Reissue session cookie with new active branch; preserve identity + version.
  // Never touch TblUserBranchAccess.IsDefault.
  try {
    await createSession({
      UserID: sessionUser.UserID,
      UserName: sessionUser.UserName,
      UserLevel: sessionUser.UserLevel,
      ActiveBranchID: target.branchId,
      ActiveBranchCode: target.branchCode,
      BranchSessionVersion: BRANCH_SESSION_VERSION,
    });
  } catch {
    await auditSwitch({
      user: sessionUser,
      request: args.request,
      success: false,
      reasonCode: 'SESSION_INVALID',
      oldBranchId,
      oldBranchCode,
      newBranchId: target.branchId,
      newBranchCode: target.branchCode,
    });
    return { ok: false, status: 500, code: 'SESSION_INVALID', message: 'تعذر تحديث الجلسة' };
  }

  await auditSwitch({
    user: sessionUser,
    request: args.request,
    success: true,
    oldBranchId,
    oldBranchCode,
    newBranchId: target.branchId,
    newBranchCode: target.branchCode,
  });

  return {
    ok: true,
    changed: true,
    activeBranch: toSafe(target),
  };
}

export { resolvePostSwitchNavigationPath } from './postSwitchNavigation';
