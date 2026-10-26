import 'server-only';
import { NextResponse } from 'next/server';
import { authenticateTenantShell, isAuthResult } from '@/lib/api-auth';

/** Billing must stay accessible after trial expiry; never bypass tenant identity or admin RBAC. */
export async function requireTenantBillingAdmin() {
  const auth = await authenticateTenantShell();
  if (!isAuthResult(auth)) return auth;
  if (auth.userLevel !== 'admin' && !auth.isSuperAdmin &&
      !auth.roles.some((r) => r === 'admin' || r === 'super_admin')) {
    return NextResponse.json({ error: 'هذه الصفحة لمدير المنشأة فقط', code: 'ADMIN_REQUIRED' }, { status: 403 });
  }
  return auth;
}
