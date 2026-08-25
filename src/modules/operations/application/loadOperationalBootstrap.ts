import 'server-only';
import { destroySession, getSession, verifySessionCookie } from '@/lib/session';
import type { SessionUser } from '@/lib/session-types';
import { getPermissions } from '@/lib/permissions';
import {
  getDefaultLandingPath,
  isPartnerOnlyUser,
} from '@/lib/partnerAccess';
import { isValidUserBranchAccess } from '@/lib/branch/repository';
import { branchNow } from '@/lib/branch/repository';
import {
  isPastRolloverWindow,
  resolveBusinessDate,
} from '../clock/BusinessClock';
import { planBusinessDayReconciliation } from '../domain/businessDayReconciliation';
import {
  buildOperationalRevision,
  type BootstrapAccess,
  type BootstrapActiveBranch,
  type BootstrapBusinessDay,
  type BootstrapErrorCode,
  type BootstrapShift,
  type OperationalBootstrap,
} from '../domain/bootstrapTypes';
import { ensureBusinessDayCurrent } from './reconcileBusinessDay';
import { memoizeInOperationalRequest } from '../requestScope';
import { withOperationalRequestScope } from '../requestScope';
import {
  loadOperationalBootstrapSnapshot,
  type BootstrapAccessRow,
  type BootstrapActiveBranchRow,
  type OperationalBootstrapSnapshot,
} from '../infra/operationalBootstrapRepository';
import type { ShiftMoveRecord } from '../infra/shiftMoveRecord';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';

export type LoadOperationalBootstrapResult =
  | { ok: true; data: OperationalBootstrap }
  | {
      ok: false;
      status: number;
      code: BootstrapErrorCode;
      message: string;
    };

function toActiveBranch(row: BootstrapActiveBranchRow): BootstrapActiveBranch {
  return {
    branchId: row.branchId,
    branchCode: row.branchCode,
    branchName: row.branchName,
    shortName: row.shortName,
    timeZone: row.timeZone,
    businessDayCutoffTime: row.businessDayCutoffTime,
    canOperate: row.canOperate,
    canViewReports: row.canViewReports,
    canSwitch: row.canSwitch,
  };
}

function toDay(day: BusinessDayRecord | null): BootstrapBusinessDay | null {
  if (!day) return null;
  return {
    id: day.id,
    branchId: day.branchId,
    businessDate: day.newDay,
    status: day.status,
  };
}

function toShift(shift: ShiftMoveRecord | null): BootstrapShift | null {
  if (!shift) return null;
  return {
    id: shift.id,
    branchId: shift.branchId,
    businessDayId: shift.businessDayId,
    newDay: shift.newDay,
    userId: shift.userId,
    shiftId: shift.shiftId,
    startTime: shift.startTime,
    status: shift.status,
    userName: shift.userName ?? null,
    shiftName: shift.shiftName ?? null,
  };
}

function toActiveBranchFromAccess(
  row: BootstrapAccessRow,
  fallback: BootstrapActiveBranch,
): BootstrapActiveBranch {
  return {
    branchId: row.branchId,
    branchCode: row.branchCode,
    branchName: row.branchName,
    shortName: row.shortName,
    timeZone: row.timeZone || fallback.timeZone,
    businessDayCutoffTime: row.businessDayCutoffTime || fallback.businessDayCutoffTime,
    canOperate: row.canOperate,
    canViewReports: row.canViewReports,
    canSwitch: row.canSwitch,
  };
}

function operationalDayFromShift(shift: BootstrapShift): BootstrapBusinessDay {
  return {
    id: shift.businessDayId,
    branchId: shift.branchId,
    businessDate: shift.newDay,
    status: true,
  };
}

function hasValidAccess(row: BootstrapActiveBranchRow, at: Date): boolean {
  if (!row.branchIsActive || !row.accessIsActive) return false;
  if (row.validFrom && row.validFrom.getTime() > at.getTime()) return false;
  if (row.validTo != null && row.validTo.getTime() <= at.getTime()) return false;
  return true;
}

function filterValidAccess(rows: BootstrapAccessRow[], at: Date) {
  return rows.filter((row) =>
    isValidUserBranchAccess(
      {
        id: 0,
        userId: 0,
        branchId: row.branchId,
        branchCode: row.branchCode,
        branchName: row.branchName,
        shortName: row.shortName,
        isDefault: row.isDefault,
        canOperate: row.canOperate,
        canViewReports: row.canViewReports,
        canSwitch: row.canSwitch,
        isActive: row.isActive,
        validFrom: row.validFrom,
        validTo: row.validTo,
        branchIsActive: row.branchIsActive,
      },
      at,
    ),
  );
}

function buildAccess(
  user: { userId: number; userName: string; userLevel: string },
  snapshot: OperationalBootstrapSnapshot,
): { permissions: string[]; access: BootstrapAccess } {
  const roles = snapshot.roles;
  const isSuperAdmin = roles.includes('super_admin');
  const isPartnerOnly = isPartnerOnlyUser(roles);
  const isAuthAdmin =
    isSuperAdmin ||
    user.userLevel === 'admin' ||
    roles.includes('admin') ||
    roles.includes('super_admin');

  let allowedPagePaths: string[] = [];
  let allowedPageKeys: string[] = [];
  if (isSuperAdmin) {
    allowedPagePaths = [...new Set(snapshot.allPages.map((p) => p.pagePath))];
    allowedPageKeys = [...new Set(snapshot.allPages.map((p) => p.pageKey))];
  } else if (isPartnerOnly) {
    allowedPagePaths = [...new Set(snapshot.rolePages.map((p) => p.pagePath))];
    allowedPageKeys = [...new Set(snapshot.rolePages.map((p) => p.pageKey))];
  } else {
    const combined = [...snapshot.allAccessPages, ...snapshot.rolePages];
    allowedPagePaths = [...new Set(combined.map((p) => p.pagePath))];
    allowedPageKeys = [...new Set(combined.map((p) => p.pageKey))];
  }

  const access: BootstrapAccess = {
    roles,
    isSuperAdmin,
    isPartnerOnly,
    defaultLandingPath: getDefaultLandingPath({ roles, isSuperAdmin }),
    allowedPagePaths,
    allowedPageKeys,
  };

  const legacy = getPermissions(isAuthAdmin ? 'admin' : 'user');
  const permissions = isPartnerOnly
    ? [...allowedPageKeys]
    : [...new Set([...legacy, ...allowedPageKeys])];

  return { permissions, access };
}

function composeDto(args: {
  snapshot: OperationalBootstrapSnapshot;
  userLevel: 'admin' | 'user';
  stale: boolean;
  needsRollover: boolean;
  expectedBusinessDate: string | null;
  reconciliationError: string | null;
  reconciliationAction: string | null;
  dbRoundTrips: number;
  at: Date;
}): OperationalBootstrap {
  const { snapshot } = args;
  const user = snapshot.user!;
  const viewBranch = toActiveBranch(snapshot.activeBranch!);
  const viewDay = toDay(snapshot.openDay);
  const anyShift = toShift(snapshot.userOpenShift);

  let operationalBranch: BootstrapActiveBranch | null = null;
  if (anyShift) {
    if (anyShift.branchId === viewBranch.branchId) {
      operationalBranch = viewBranch;
    } else {
      const accessRow = snapshot.accessRows.find((row) => row.branchId === anyShift.branchId);
      operationalBranch = accessRow
        ? toActiveBranchFromAccess(accessRow, viewBranch)
        : {
            ...viewBranch,
            branchId: anyShift.branchId,
            branchCode: `BRANCH_${anyShift.branchId}`,
            branchName: `فرع ${anyShift.branchId}`,
            shortName: null,
          };
    }
  }

  const operationalDay =
    anyShift && operationalBranch ? operationalDayFromShift(anyShift) : null;
  const shiftOnOther =
    anyShift && operationalBranch && anyShift.branchId !== viewBranch.branchId
      ? anyShift
      : null;

  const { permissions, access } = buildAccess(
    { userId: user.userId, userName: user.userName, userLevel: args.userLevel },
    snapshot,
  );
  const validBranches = filterValidAccess(snapshot.accessRows, args.at).filter(
    (row) => row.canOperate,
  );

  return {
    user: {
      userId: user.userId,
      userName: user.userName,
      userLevel: args.userLevel,
      defaultShiftId: user.defaultShiftId,
    },
    permissions,
    access,
    branches: validBranches.map((row) => ({
      branchId: row.branchId,
      branchCode: row.branchCode,
      branchName: row.branchName,
      shortName: row.shortName,
      isCurrent: row.branchId === viewBranch.branchId,
      canOperate: row.canOperate,
    })),
    activeBranch: viewBranch,
    view: {
      branch: viewBranch,
      businessDay: viewDay,
    },
    operational: {
      branch: operationalBranch,
      businessDay: operationalDay,
      shift: anyShift,
      shiftOnOtherBranch: shiftOnOther,
    },
    activeBranchState: {
      businessDay: viewDay,
      openShiftCount: snapshot.openShiftCount,
    },
    stale: args.stale,
    needsRollover: args.needsRollover,
    expectedBusinessDate: args.expectedBusinessDate,
    reconciliationError: args.reconciliationError,
    reconciliationAction: args.reconciliationAction,
    revision: buildOperationalRevision({
      viewBranchId: viewBranch.branchId,
      operationalBranchId: operationalBranch?.branchId ?? null,
      businessDayId: viewDay?.id ?? null,
      businessDayStatus: viewDay?.status ?? null,
      shiftId: anyShift?.id ?? null,
      shiftStatus: anyShift?.status ?? null,
      stale: args.stale,
    }),
    dbRoundTrips: args.dbRoundTrips,
  };
}

async function resolveUser(preloaded?: SessionUser): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; status: number; code: BootstrapErrorCode; message: string }
> {
  if (preloaded) return { ok: true, user: preloaded };

  const verified = await verifySessionCookie();
  if (!verified.ok) {
    if (verified.reason !== 'missing') {
      await destroySession().catch(() => undefined);
    }
    return {
      ok: false,
      status: 401,
      code: verified.reason === 'missing' ? 'UNAUTHENTICATED' : 'SESSION_UPGRADE_REQUIRED',
      message:
        verified.reason === 'missing'
          ? 'غير مصرح'
          : 'يلزم إعادة تسجيل الدخول لتحديث جلسة الفرع',
    };
  }

  const user = await getSession();
  if (!user) {
    await destroySession().catch(() => undefined);
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'غير مصرح' };
  }
  return { ok: true, user };
}

/**
 * Authoritative operational shell read.
 * ViewBranch comes from the session cookie; OperationalBranch comes only from
 * the user's OPEN ShiftSession. BusinessClock + BEST_EFFORT catch-up run on
 * the viewed branch. Does not call requireOperationalContext.
 */
async function loadBootstrapUnscoped(args?: {
  user?: SessionUser;
}): Promise<LoadOperationalBootstrapResult> {
  const auth = await resolveUser(args?.user);
  if (!auth.ok) return auth;

  const user = auth.user;
  const at = branchNow();
  let roundTrips = 0;

  try {
    let snapshot = await loadOperationalBootstrapSnapshot({
      userId: user.UserID,
      branchId: user.ActiveBranchID,
    });
    roundTrips += 1;

    if (!snapshot.user) {
      await destroySession().catch(() => undefined);
      return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'غير مصرح' };
    }
    if (snapshot.user.isDeleted) {
      await destroySession().catch(() => undefined);
      return { ok: false, status: 401, code: 'USER_DELETED', message: 'تم تعطيل الحساب' };
    }
    if (!snapshot.activeBranch || !hasValidAccess(snapshot.activeBranch, at)) {
      return {
        ok: false,
        status: 403,
        code: 'NO_BRANCH_ACCESS',
        message: 'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      };
    }

    const clockBranch = {
      timeZone: snapshot.activeBranch.timeZone,
      businessDayCutoffTime: snapshot.activeBranch.businessDayCutoffTime,
    };
    const expectedBusinessDate = resolveBusinessDate(clockBranch, at);
    const pastRolloverWindow = isPastRolloverWindow(clockBranch, at);
    const plan = planBusinessDayReconciliation({
      openDayDate: snapshot.openDay?.newDay ?? null,
      expectedDate: expectedBusinessDate,
      pastRolloverWindow,
    });

    let stale = false;
    let reconciliationError: string | null = null;
    let reconciliationAction: string | null = plan;
    let needsRollover = plan === 'ROLLED_OVER';

    if (plan !== 'NO_OP') {
      const catchUp = await ensureBusinessDayCurrent(user.ActiveBranchID, {
        mode: 'BEST_EFFORT',
        trigger: 'BEST_EFFORT_CATCH_UP',
        now: at,
      });
      if (catchUp.action === 'FAILED' || catchUp.stale) {
        stale = true;
        needsRollover = true;
        reconciliationError = catchUp.error ?? 'STALE_DAY_RECONCILIATION_FAILED';
        reconciliationAction = catchUp.action;
      } else if (catchUp.action !== 'NO_OP') {
        snapshot = await loadOperationalBootstrapSnapshot({
          userId: user.UserID,
          branchId: user.ActiveBranchID,
        });
        roundTrips += 1;
        needsRollover = false;
        stale = false;
        reconciliationAction = catchUp.action;
      }
    }

    const userLevel = snapshot.user.userLevel === 'admin' ? 'admin' : 'user';
    return {
      ok: true,
      data: composeDto({
        snapshot,
        userLevel,
        stale,
        needsRollover,
        expectedBusinessDate,
        reconciliationError,
        reconciliationAction,
        dbRoundTrips: roundTrips,
        at,
      }),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'OPERATIONAL_BOOTSTRAP',
        success: false,
        errorCode: 'TEMPORARY_OPERATIONAL_READ_FAILURE',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    return {
      ok: false,
      status: 503,
      code: 'TEMPORARY_OPERATIONAL_READ_FAILURE',
      message: 'تعذر تحميل حالة التشغيل. حاول مرة أخرى.',
    };
  }
}

export async function loadOperationalBootstrap(args?: {
  user?: SessionUser;
}): Promise<LoadOperationalBootstrapResult> {
  return withOperationalRequestScope(() =>
    memoizeInOperationalRequest('operational-bootstrap', () => loadBootstrapUnscoped(args)),
  );
}

export function toLegacySessionPayload(data: OperationalBootstrap) {
  const day = data.view.businessDay ?? data.activeBranchState.businessDay;
  const shift = data.operational.shift;
  return {
    user: {
      UserID: data.user.userId,
      UserName: data.user.userName,
      UserLevel: data.user.userLevel,
      ActiveBranchID: data.view.branch.branchId,
      ActiveBranchCode: data.view.branch.branchCode,
      BranchSessionVersion: 1 as const,
    },
    day: day
      ? {
          ID: day.id,
          NewDay: day.businessDate,
          Status: day.status,
          BranchID: day.branchId,
        }
      : null,
    shift: shift
      ? {
          ID: shift.id,
          NewDay: shift.newDay,
          UserID: shift.userId,
          ShiftID: shift.shiftId,
          StartDate: shift.newDay,
          StartTime: shift.startTime,
          EndDate: null,
          EndTime: null,
          Status: shift.status,
          UserName: shift.userName,
          ShiftName: shift.shiftName,
          BranchID: shift.branchId,
          BusinessDayID: shift.businessDayId,
        }
      : null,
    permissions: data.permissions,
    roles: data.access.roles,
    allowedPagePaths: data.access.allowedPagePaths,
    defaultShiftId: data.user.defaultShiftId,
    activeBranch: {
      BranchID: data.activeBranch.branchId,
      BranchCode: data.activeBranch.branchCode,
      BranchName: data.activeBranch.branchName,
      ShortName: data.activeBranch.shortName,
      TimeZone: data.activeBranch.timeZone,
      BusinessDayCutoffTime: data.activeBranch.businessDayCutoffTime,
      CanOperate: data.activeBranch.canOperate,
      CanViewReports: data.activeBranch.canViewReports,
      CanSwitch: data.activeBranch.canSwitch,
    },
    stale: data.stale,
    needsRollover: data.needsRollover,
    revision: data.revision,
  };
}
