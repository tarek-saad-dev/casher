import 'server-only';
import { NextResponse } from 'next/server';
import { getSessionPayload } from '@/lib/session';
import {
  branchNow,
  getBranchById,
  getUserActiveStatus,
  getUserBranchAccess,
} from './repository';
import { validateUserBranchAccess } from './access';
import {
  assertLegacyBranchInTenant,
  isTenantContextError,
  resolveStaffTenantContextForRequest,
} from '@/platform/tenant/tenantContext';
import {
  assertTenantSubscriptionActive,
  TenantAccessDeniedError,
} from '@/platform/commercial/tenantAccessGate';
import {
  BRANCH_SESSION_VERSION,
  BranchDomainError,
  type ActiveBranchContext,
} from './types';

function isBranchDomainError(err: unknown): err is BranchDomainError {
  if (err instanceof BranchDomainError) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'BranchDomainError' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

type RequestStore = {
  contextPromise?: Promise<ActiveBranchContext>;
};

const requestStores = new WeakMap<object, RequestStore>();

function getRequestStore(key: object): RequestStore {
  let store = requestStores.get(key);
  if (!store) {
    store = {};
    requestStores.set(key, store);
  }
  return store;
}

/** Optional request-scoped memoization key (e.g. the NextRequest object). */
let currentRequestKey: object | null = null;

export function withBranchRequestScope<T>(key: object, fn: () => Promise<T>): Promise<T> {
  const prev = currentRequestKey;
  currentRequestKey = key;
  return fn().finally(() => {
    currentRequestKey = prev;
  });
}

function toContext(
  userId: number,
  branch: NonNullable<Awaited<ReturnType<typeof getBranchById>>>,
  access: Awaited<ReturnType<typeof validateUserBranchAccess>>,
): ActiveBranchContext {
  return {
    userId,
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
    timeZone: branch.timeZone,
    businessDayCutoffTime: branch.businessDayCutoffTime,
    canOperate: access.canOperate,
    canViewReports: access.canViewReports,
    canSwitch: access.canSwitch,
  };
}

export async function getActiveBranchContext(
  at: Date = branchNow(),
): Promise<ActiveBranchContext | null> {
  if (currentRequestKey) {
    const store = getRequestStore(currentRequestKey);
    if (!store.contextPromise) {
      store.contextPromise = resolveActiveBranchContext(at).catch((err) => {
        store.contextPromise = undefined;
        throw err;
      });
    }
    try {
      return await store.contextPromise;
    } catch {
      return null;
    }
  }
  try {
    return await resolveActiveBranchContext(at);
  } catch {
    return null;
  }
}

async function resolveActiveBranchContext(at: Date): Promise<ActiveBranchContext> {
  const payload = await getSessionPayload();
  if (!payload) {
    throw new BranchDomainError('SESSION_UPGRADE_REQUIRED', 'يلزم إعادة تسجيل الدخول', 401);
  }
  if (payload.BranchSessionVersion !== BRANCH_SESSION_VERSION) {
    // Do not delete cookies here — callers in Route Handlers clear via destroySession.
    throw new BranchDomainError(
      'UNSUPPORTED_BRANCH_SESSION_VERSION',
      'يلزم إعادة تسجيل الدخول لتحديث جلسة الفرع',
      401,
    );
  }

  const user = await getUserActiveStatus(payload.UserID);
  if (!user.exists) {
    throw new BranchDomainError('USER_NOT_FOUND', 'المستخدم غير موجود', 401);
  }
  if (user.isDeleted) {
    throw new BranchDomainError('USER_DELETED', 'تم تعطيل الحساب', 401);
  }

  const branch = await getBranchById(payload.ActiveBranchID);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }
  if (!branch.isActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 403);
  }
  if (branch.branchCode !== payload.ActiveBranchCode) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'رمز الفرع في الجلسة غير متطابق',
      401,
    );
  }

  const access = await validateUserBranchAccess(payload.UserID, payload.ActiveBranchID, at);
  if (access.branchId !== payload.ActiveBranchID) {
    throw new BranchDomainError('BRANCH_ACCESS_MISMATCH', 'عدم تطابق صلاحية الفرع', 403);
  }

  const tenantId = await verifySessionTenantBinding(payload);
  return { ...toContext(payload.UserID, branch, access), tenantId };
}

/**
 * DRVO-013: the signed session carries the tenant resolved at login/switch; re-verify that the
 * membership and tenant are still active, that the active branch is still a Location of that
 * tenant, and that the tenant's DRVO-012 subscription allows access.
 */
async function verifySessionTenantBinding(payload: {
  UserID: number;
  ActiveBranchID: number;
  TenantId?: string;
}): Promise<string> {
  if (!payload.TenantId) {
    throw new BranchDomainError('SESSION_UPGRADE_REQUIRED', 'يلزم إعادة تسجيل الدخول', 401);
  }
  let tenantId: string;
  try {
    const tenant = await resolveStaffTenantContextForRequest({
      userId: payload.UserID,
      activeBranchId: payload.ActiveBranchID,
      preferredTenantId: payload.TenantId,
    });
    tenantId = tenant.tenantId;
  } catch (err) {
    if (isTenantContextError(err)) {
      throw new BranchDomainError('BRANCH_ACCESS_MISMATCH', 'يلزم إعادة تسجيل الدخول', 401);
    }
    throw err;
  }
  try {
    await assertTenantSubscriptionActive(tenantId);
  } catch (err) {
    if (err instanceof TenantAccessDeniedError) {
      throw new BranchDomainError('SUBSCRIPTION_INACTIVE', err.message, err.status);
    }
    throw err;
  }
  return tenantId;
}

export async function requireActiveBranchContext(
  at: Date = branchNow(),
): Promise<ActiveBranchContext | NextResponse> {
  try {
    if (currentRequestKey) {
      const store = getRequestStore(currentRequestKey);
      if (!store.contextPromise) {
        store.contextPromise = resolveActiveBranchContext(at);
      }
      return await store.contextPromise;
    }
    return await resolveActiveBranchContext(at);
  } catch (err) {
    if (isBranchDomainError(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    throw err;
  }
}

export async function requireBranchOperationAccess(
  at: Date = branchNow(),
): Promise<ActiveBranchContext | NextResponse> {
  const ctx = await requireActiveBranchContext(at);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.canOperate) {
    return NextResponse.json(
      { error: 'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع', code: 'OPERATION_NOT_ALLOWED' },
      { status: 403 },
    );
  }
  return ctx;
}

export async function requireBranchReportAccess(
  at: Date = branchNow(),
): Promise<ActiveBranchContext | NextResponse> {
  const ctx = await requireActiveBranchContext(at);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.canViewReports) {
    return NextResponse.json(
      { error: 'غير مصرح — لا تملك صلاحية تقارير هذا الفرع', code: 'REPORT_NOT_ALLOWED' },
      { status: 403 },
    );
  }
  return ctx;
}

/**
 * Phase 1M — high-level branch administration (provision / lifecycle / smoke).
 * Requires authenticated admin (requireAdmin) PLUS valid active branch context
 * when an operating branch is needed; provisioning itself uses admin only.
 */
export async function requireBranchAdminAccess(): Promise<
  | { userId: number; role: 'admin'; tenantId: string }
  | NextResponse
> {
  const { requireAdmin, isAuthResult } = await import('@/lib/api-auth');
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  return { userId: auth.userId, role: 'admin', tenantId: auth.tenantId };
}

/**
 * DRVO-013: branch administration by id is limited to Locations of the admin's tenant.
 * Returns a non-disclosing 404 for branches of other tenants (same as an unknown id).
 */
export async function branchAdminTenantScopeResponse(
  admin: { tenantId: string },
  branchId: number,
): Promise<NextResponse | null> {
  try {
    await assertLegacyBranchInTenant(admin.tenantId, branchId);
    return null;
  } catch (err) {
    if (isTenantContextError(err)) {
      return NextResponse.json(
        { ok: false, error: 'الفرع غير موجود', code: 'BRANCH_NOT_FOUND' },
        { status: 404 },
      );
    }
    throw err;
  }
}

export async function validateSessionBranch(
  userId: number,
  branchId: number,
  branchCode: string,
  at: Date = branchNow(),
): Promise<ActiveBranchContext> {
  const user = await getUserActiveStatus(userId);
  if (!user.exists) {
    throw new BranchDomainError('USER_NOT_FOUND', 'المستخدم غير موجود', 401);
  }
  if (user.isDeleted) {
    throw new BranchDomainError('USER_DELETED', 'تم تعطيل الحساب', 401);
  }
  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 403);
  }
  if (branch.branchCode !== branchCode) {
    throw new BranchDomainError('BRANCH_ACCESS_MISMATCH', 'عدم تطابق رمز الفرع', 401);
  }
  const accessRow = await getUserBranchAccess(userId, branchId);
  if (!accessRow) {
    throw new BranchDomainError('NO_BRANCH_ACCESS', 'لا يوجد ربط فرع', 403);
  }
  const access = await validateUserBranchAccess(userId, branchId, at);
  return toContext(userId, branch, access);
}

export function isActiveBranchContext(
  v: ActiveBranchContext | NextResponse,
): v is ActiveBranchContext {
  return !(v instanceof NextResponse) && typeof (v as ActiveBranchContext).branchId === 'number';
}
