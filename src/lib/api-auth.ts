// ── Server-side API authorization helpers ────────────────────────────────────
// Use these in API route handlers to enforce role/permission checks.
// Proxy checks are defense-in-depth only — handlers remain authoritative.

import { NextRequest, NextResponse } from 'next/server';
import { destroySession, getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';
import { getUserActiveStatus } from '@/lib/branch/repository';
import {
  extractBearerToken,
  isCronBearerAuthorized,
} from '@/lib/proxyPublicRoutes';
import type { SessionUser } from '@/lib/session-types';
import {
  assertLegacyUserInTenant,
  isTenantContextError,
  resolveStaffTenantContextForRequest,
  type StaffTenantContext,
} from '@/platform/tenant/tenantContext';
import { resolveLegacyBootstrapTenantId } from '@/platform/tenant/legacyBootstrapSeam';
import {
  assertRouteAppEntitlement,
  assertTenantAppInstalled,
  assertTenantSubscriptionActive,
  evaluateTenantSubscriptionGate,
  TenantAccessDeniedError,
} from '@/platform/commercial/tenantAccessGate';
import type { AppRegistryCode } from '@/platform/registry/constants';
import type { SubscriptionEvaluation } from '@/platform/commercial/types';

export interface AuthResult {
  ok: true;
  userId: number;
  userName: string;
  userLevel: string;
  roles: string[];
  isSuperAdmin: boolean;
  activeBranchId: number;
  activeBranchCode: string;
  /** DRVO-013 authoritative tenant (membership -> tenant -> active location). Never defaulted. */
  tenantId: string;
  membershipId: string;
  tenant: StaffTenantContext;
}

export type AuthFailure = NextResponse;

/** Machine callers have no staff tenant; tenant-owned work must carry TenantId explicitly. */
export type SystemJobAuthResult = Omit<AuthResult, 'tenantId' | 'membershipId' | 'tenant'> & {
  tenantId: string | null;
  membershipId: string | null;
  tenant: StaffTenantContext | null;
  via: 'cron_bearer' | 'session';
};

/** Platform operator identity — deliberately carries no tenant/active-branch context. */
export interface PlatformOperatorAuth {
  ok: true;
  kind: 'platform_operator';
  userId: number;
  userName: string;
  roles: string[];
}

type IdentityResult = {
  session: SessionUser;
  roles: string[];
  isSuperAdmin: boolean;
};

async function authenticateIdentity(): Promise<IdentityResult | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'غير مصرح — يرجى تسجيل الدخول', code: 'SESSION_REQUIRED' },
      { status: 401 },
    );
  }

  if (
    session.ActiveBranchID == null ||
    !session.ActiveBranchCode ||
    session.BranchSessionVersion !== 1
  ) {
    await destroySession();
    return NextResponse.json(
      {
        error: 'يلزم إعادة تسجيل الدخول لتحديث جلسة الفرع',
        code: 'SESSION_UPGRADE_REQUIRED',
      },
      { status: 401 },
    );
  }

  const userStatus = await getUserActiveStatus(session.UserID);
  if (!userStatus.exists || userStatus.isDeleted) {
    await destroySession();
    return NextResponse.json(
      { error: 'تم تعطيل الحساب أو لم يعد موجوداً', code: 'USER_DELETED' },
      { status: 401 },
    );
  }

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  return { session, roles: access.roles, isSuperAdmin: access.isSuperAdmin };
}

/** Fail-closed mapping for tenant resolution / commercial gate denials. */
export async function tenantDenialResponse(
  err: unknown,
  details: Record<string, unknown>,
): Promise<NextResponse | null> {
  if (isTenantContextError(err)) {
    logSecurityEvent('tenant_context_denied', { ...details, code: err.code, detail: err.detail });
    if (err.code === 'TENANT_MEMBERSHIP_MISMATCH' || err.code === 'LOCATION_NOT_IN_TENANT') {
      await destroySession();
      return NextResponse.json(
        { error: 'يلزم إعادة تسجيل الدخول', code: 'SESSION_TENANT_INVALID' },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: err.publicMessage, code: err.publicCode }, { status: err.status });
  }
  if (err instanceof TenantAccessDeniedError) {
    logSecurityEvent('tenant_access_denied', { ...details, code: err.code, reason: err.reason });
    return NextResponse.json(
      { error: err.message, code: err.code, ...(err.reason ? { reason: err.reason } : {}) },
      { status: err.status },
    );
  }
  return null;
}

/**
 * Authenticate a staff request. Tenant identity is authoritative:
 * user -> TenantMembership -> Tenant -> active Location (session branch), plus the DRVO-012
 * subscription gate evaluated for that tenant. Any failure is fail-closed.
 */
export async function authenticate(): Promise<AuthResult | NextResponse> {
  const identity = await authenticateIdentity();
  if (identity instanceof NextResponse) return identity;
  const { session } = identity;

  let tenant: StaffTenantContext;
  try {
    tenant = await resolveStaffTenantContextForRequest({
      userId: session.UserID,
      activeBranchId: session.ActiveBranchID,
      preferredTenantId: session.TenantId ?? null,
    });
    await assertTenantSubscriptionActive(tenant.tenantId);
    await assertRouteAppEntitlement(tenant.tenantId);
  } catch (err) {
    const denied = await tenantDenialResponse(err, {
      userId: session.UserID,
      activeBranchId: session.ActiveBranchID,
    });
    if (denied) return denied;
    throw err;
  }

  return {
    ok: true,
    userId: session.UserID,
    userName: session.UserName,
    userLevel: session.UserLevel,
    roles: identity.roles,
    isSuperAdmin: identity.isSuperAdmin,
    activeBranchId: session.ActiveBranchID,
    activeBranchCode: session.ActiveBranchCode,
    tenantId: tenant.tenantId,
    membershipId: tenant.membershipId,
    tenant,
  };
}

/**
 * Tenant-owned product routes for an installable app: authoritative tenant first, then the
 * DRVO-012 installed-app check for THAT tenant.
 */
export async function requireTenantApp(appCode: AppRegistryCode): Promise<AuthResult | NextResponse> {
  return withTenantApp(appCode, authenticate());
}

/**
 * App entitlement for any tenant-checked auth result (AuthResult, ActiveBranchContext, ...):
 * `await withTenantApp('payroll', requireRole([...]))`. A result without an authoritative
 * tenant (cron bearer) is denied — system jobs fan out per tenant instead.
 */
export async function withTenantApp<T extends { tenantId: string | null }>(
  appCode: AppRegistryCode,
  pending: Promise<T | NextResponse>,
): Promise<T | NextResponse> {
  const auth = await pending;
  if (auth instanceof NextResponse) return auth;
  if (!auth.tenantId) {
    return NextResponse.json(
      { error: 'تعذر تحديد المنشأة لهذا الطلب', code: 'TENANT_CONTEXT_REQUIRED' },
      { status: 403 },
    );
  }
  try {
    await assertTenantAppInstalled(auth.tenantId, appCode);
  } catch (err) {
    const denied = await tenantDenialResponse(err, { tenantId: auth.tenantId, appCode });
    if (denied) return denied;
    throw err;
  }
  return auth;
}

/** Alias: any authenticated POS session. */
export async function requireSession(): Promise<AuthResult | NextResponse> {
  return authenticate();
}

/** Session shape whose tenant binding has been re-verified by `authenticate()`. */
export type TenantSessionUser = SessionUser & { TenantId: string; MembershipId: string };

function toTenantSessionUser(auth: AuthResult): TenantSessionUser {
  return {
    UserID: auth.userId,
    UserName: auth.userName,
    UserLevel: auth.userLevel === 'admin' ? 'admin' : 'user',
    ActiveBranchID: auth.activeBranchId,
    ActiveBranchCode: auth.activeBranchCode,
    BranchSessionVersion: 1,
    TenantId: auth.tenantId,
    MembershipId: auth.membershipId,
  };
}

/**
 * Tenant-checked replacement for `getSession()` in staff handlers: membership, tenant, active
 * location, subscription and route-family app gates all pass before the session is returned.
 * `app` additionally requires that installable app for the session tenant.
 */
export async function requireTenantSession(
  opts: { app?: AppRegistryCode } = {},
): Promise<TenantSessionUser | NextResponse> {
  const auth = opts.app ? await requireTenantApp(opts.app) : await authenticate();
  if (!isAuthResult(auth)) return auth;
  return toTenantSessionUser(auth);
}

/**
 * Features backed by global legacy tables that have neither TenantId nor BranchID stay limited to
 * the CASHER_BOOT tenant (named seam) until their data is tenant-owned. Other tenants get a
 * non-disclosing 404.
 */
export async function requireLegacyGlobalDataSession(
  feature: string,
): Promise<TenantSessionUser | NextResponse> {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;
  const legacyTenantId = await resolveLegacyBootstrapTenantId('legacy-global-data');
  if (auth.tenantId !== legacyTenantId) {
    logSecurityEvent('legacy_global_data_denied', { userId: auth.userId, tenantId: auth.tenantId, feature });
    return NextResponse.json({ error: 'غير موجود', code: 'NOT_FOUND' }, { status: 404 });
  }
  return toTenantSessionUser(auth);
}

/** Require the caller to have at least one of the given roles. */
export async function requireRole(
  allowedRoles: string[]
): Promise<AuthResult | NextResponse> {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth; // 401

  if (auth.isSuperAdmin) return auth;

  const hasRole = auth.roles.some(r => allowedRoles.includes(r));
  if (!hasRole) {
    return NextResponse.json(
      { error: `غير مصرح — هذه العملية تتطلب أحد الأدوار: ${allowedRoles.join(', ')}` },
      { status: 403 }
    );
  }
  return auth;
}

async function isPlatformOwnerMember(userId: number): Promise<boolean> {
  try {
    const platformTenantId = await resolveLegacyBootstrapTenantId('platform-operator-tenant');
    await assertLegacyUserInTenant(platformTenantId, userId);
    return true;
  } catch (err) {
    if (isTenantContextError(err)) return false;
    throw err;
  }
}

/** Same rule as requirePlatformOperator, as a boolean for UI shells (never a substitute for the gate). */
export async function isPlatformOperatorUser(userId: number, roles: readonly string[]): Promise<boolean> {
  if (!roles.includes('super_admin')) return false;
  return isPlatformOwnerMember(userId);
}

export type TenantShellAuthResult = AuthResult & { subscription: SubscriptionEvaluation };

/**
 * Tenant shell read: authoritative tenant (membership + active location) WITHOUT the subscription
 * gate, so a blocked tenant can still be told why it is blocked. Only for read-only shell
 * endpoints; every product route keeps using authenticate().
 */
export async function authenticateTenantShell(): Promise<TenantShellAuthResult | NextResponse> {
  const identity = await authenticateIdentity();
  if (identity instanceof NextResponse) return identity;
  const { session } = identity;

  let tenant: StaffTenantContext;
  let subscription: SubscriptionEvaluation;
  try {
    tenant = await resolveStaffTenantContextForRequest({
      userId: session.UserID,
      activeBranchId: session.ActiveBranchID,
      preferredTenantId: session.TenantId ?? null,
    });
    subscription = await evaluateTenantSubscriptionGate(tenant.tenantId);
  } catch (err) {
    const denied = await tenantDenialResponse(err, {
      userId: session.UserID,
      activeBranchId: session.ActiveBranchID,
    });
    if (denied) return denied;
    throw err;
  }

  return {
    ok: true,
    userId: session.UserID,
    userName: session.UserName,
    userLevel: session.UserLevel,
    roles: identity.roles,
    isSuperAdmin: identity.isSuperAdmin,
    activeBranchId: session.ActiveBranchID,
    activeBranchCode: session.ActiveBranchCode,
    tenantId: tenant.tenantId,
    membershipId: tenant.membershipId,
    tenant,
    subscription,
  };
}

/**
 * Platform operator gate for control-plane routes. Separate from tenant staff semantics:
 * requires super_admin AND membership in the platform-owner tenant (CASHER_BOOT seam), so a
 * tenant admin granted super_admin inside their own tenant is not a platform operator.
 * The result carries no tenant / active-branch context.
 */
export async function requirePlatformOperator(): Promise<PlatformOperatorAuth | NextResponse> {
  const identity = await authenticateIdentity();
  if (identity instanceof NextResponse) return identity;
  const { session } = identity;

  const deny = (reason: string) => {
    logSecurityEvent('platform_operator_denied', {
      userId: session.UserID,
      userName: session.UserName,
      roles: identity.roles,
      reason,
    });
    return NextResponse.json(
      { error: 'غير مصرح — هذه العملية تتطلب صلاحية مشغل المنصة (super_admin)' },
      { status: 403 },
    );
  };

  if (!(identity.isSuperAdmin || identity.roles.includes('super_admin'))) {
    return deny('not_super_admin');
  }
  if (!(await isPlatformOwnerMember(session.UserID))) {
    return deny('not_platform_owner_member');
  }

  return {
    ok: true,
    kind: 'platform_operator',
    userId: session.UserID,
    userName: session.UserName,
    roles: identity.roles,
  };
}

/** Require admin or super_admin role (or legacy UserLevel admin). */
export async function requireAdmin(): Promise<AuthResult | NextResponse> {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  if (auth.isSuperAdmin) return auth;
  if (auth.userLevel === 'admin') return auth;
  if (auth.roles.some((r) => r === 'admin' || r === 'super_admin')) return auth;

  return NextResponse.json(
    { error: 'غير مصرح — هذه العملية تتطلب صلاحية مدير' },
    { status: 403 },
  );
}

/** Require authenticated user with access to a specific page path. */
export async function requirePageAccess(
  pagePath: string,
): Promise<AuthResult | NextResponse> {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  if (auth.isSuperAdmin) return auth;

  const { canAccessPath } = await import('@/lib/permissions-server');
  const allowed = await canAccessPath(auth.userId, auth.userName, auth.userLevel, pagePath);
  if (!allowed) {
    return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية الوصول لهذه الصفحة' }, { status: 403 });
  }
  return auth;
}

/**
 * Workforce availability page + daily adjustments (CLOSE_DAY, etc.).
 * Prefer `/admin/workforce/availability`; fall back to `/admin` for legacy admins.
 */
export async function requireWorkforceAvailabilityAccess(): Promise<
  AuthResult | NextResponse
> {
  let auth = await requirePageAccess('/admin/workforce/availability');
  if (!isAuthResult(auth)) {
    auth = await requirePageAccess('/admin');
  }
  return auth;
}

/**
 * Temporary branch transfer (ops modal + HR full page).
 * Accepts `/admin/hr/branch-transfer`, `/admin/hr`, or `/operations`.
 */
export async function requireTemporaryTransferAccess(): Promise<
  AuthResult | NextResponse
> {
  let auth = await requirePageAccess('/admin/hr/branch-transfer');
  if (isAuthResult(auth)) return auth;
  auth = await requirePageAccess('/admin/hr');
  if (isAuthResult(auth)) return auth;
  return requirePageAccess('/operations');
}

/**
 * Development-only admin utilities.
 * Returns 404 in production (hide existence); admin session required in development.
 */
export async function requireDevelopmentAdmin(
  env: { NODE_ENV?: string } = process.env,
): Promise<AuthResult | NextResponse> {
  if (env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  return requireAdmin();
}

/**
 * Scheduled / machine callers: Bearer CRON_SECRET, or an authenticated admin session.
 * Never anonymously open when CRON_SECRET is unset in production.
 */
export async function requireSystemJobAuth(
  req: NextRequest,
  env: { CRON_SECRET?: string; NODE_ENV?: string } = process.env,
): Promise<SystemJobAuthResult | NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (isCronBearerAuthorized(authHeader, env)) {
    return {
      ok: true,
      userId: 0,
      userName: 'system-job',
      userLevel: 'admin',
      roles: ['system_job'],
      isSuperAdmin: true,
      activeBranchId: 0,
      activeBranchCode: 'SYSTEM',
      tenantId: null,
      membershipId: null,
      tenant: null,
      via: 'cron_bearer',
    };
  }

  const auth = await requireAdmin();
  if (!isAuthResult(auth)) {
    return NextResponse.json(
      { error: 'غير مصرح — CRON_SECRET (Bearer) أو جلسة مدير مطلوبة' },
      { status: 401 },
    );
  }
  return { ...auth, via: 'session' };
}

/** Best-effort security event log (console). Does not alter business tables. */
export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      type: 'SECURITY_EVENT',
      event,
      at: new Date().toISOString(),
      ...details,
    }),
  );
}

/** Type guard */
export function isAuthResult<T extends { ok: true }>(v: T | NextResponse): v is T {
  return !(v instanceof NextResponse) && (v as T).ok === true;
}

export function isSystemJobAuthResult(
  v: SystemJobAuthResult | NextResponse,
): v is SystemJobAuthResult {
  return (v as SystemJobAuthResult).ok === true;
}

// Re-export for callers that already import bearer helpers via api-auth
export { extractBearerToken, isCronBearerAuthorized };
