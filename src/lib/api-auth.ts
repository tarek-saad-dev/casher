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

export interface AuthResult {
  ok: true;
  userId: number;
  userName: string;
  userLevel: string;
  roles: string[];
  isSuperAdmin: boolean;
  activeBranchId: number;
  activeBranchCode: string;
}

export type AuthFailure = NextResponse;

export type SystemJobAuthResult = AuthResult & {
  via: 'cron_bearer' | 'session';
};

/** Authenticate the current request. Returns AuthResult or a NextResponse 401/403. */
export async function authenticate(): Promise<AuthResult | NextResponse> {
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
  return {
    ok: true,
    userId: session.UserID,
    userName: session.UserName,
    userLevel: session.UserLevel,
    roles: access.roles,
    isSuperAdmin: access.isSuperAdmin,
    activeBranchId: session.ActiveBranchID,
    activeBranchCode: session.ActiveBranchCode,
  };
}

/** Alias: any authenticated POS session. */
export async function requireSession(): Promise<AuthResult | NextResponse> {
  return authenticate();
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
export function isAuthResult(v: AuthResult | NextResponse): v is AuthResult {
  return (v as AuthResult).ok === true;
}

export function isSystemJobAuthResult(
  v: SystemJobAuthResult | NextResponse,
): v is SystemJobAuthResult {
  return (v as SystemJobAuthResult).ok === true;
}

// Re-export for callers that already import bearer helpers via api-auth
export { extractBearerToken, isCronBearerAuthorized };
