import { NextResponse } from 'next/server';
import { authenticateTenantShell, isAuthResult, isPlatformOperatorUser } from '@/lib/api-auth';
import { loadTenantShellSnapshot } from '@/platform/tenant/tenantShellSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tenant/context — read-only tenant shell state for the signed-in staff member:
 * brand profile, installed apps and subscription state. Answers even when the subscription is
 * inactive so the shell can render the blocked state; it exposes no business data.
 */
export async function GET() {
  const auth = await authenticateTenantShell();
  if (!isAuthResult(auth)) return auth;

  try {
    const snapshot = await loadTenantShellSnapshot({
      tenantId: auth.tenantId,
      tenantCode: auth.tenant.tenantCode,
      evaluation: auth.subscription,
      isPlatformOperator: await isPlatformOperatorUser(auth.userId, auth.roles),
    });
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/tenant/context] GET error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تحميل بيانات المنشأة' }, { status: 500 });
  }
}
