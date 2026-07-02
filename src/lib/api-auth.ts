// ── Server-side API authorization helpers ────────────────────────────────────
// Use these in API route handlers to enforce role/permission checks.

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export interface AuthResult {
  ok: true;
  userId: number;
  userName: string;
  userLevel: string;
  roles: string[];
  isSuperAdmin: boolean;
}

export type AuthFailure = NextResponse;

/** Authenticate the current request. Returns AuthResult or a NextResponse 401/403. */
export async function authenticate(): Promise<AuthResult | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'غير مصرح — يرجى تسجيل الدخول' }, { status: 401 });
  }
  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  return {
    ok: true,
    userId: session.UserID,
    userName: session.UserName,
    userLevel: session.UserLevel,
    roles: access.roles,
    isSuperAdmin: access.isSuperAdmin,
  };
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

/** Type guard */
export function isAuthResult(v: AuthResult | NextResponse): v is AuthResult {
  return (v as AuthResult).ok === true;
}
