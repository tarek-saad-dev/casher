import { vi } from 'vitest';
import { NextResponse } from 'next/server';

export const TEST_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * Route tests that model auth through a mocked `getSession()` (no TenantMembership tables):
 * `requireTenantSession` / `requireLegacyGlobalDataSession` resolve the tenant from that session.
 *
 * vi.mock('@/lib/api-auth', async (importOriginal) =>
 *   (await import('./helpers/tenantSessionAuthMock')).tenantSessionAuthMock(await importOriginal()));
 */
export function tenantSessionAuthMock<T extends object>(actual: T) {
  const fromSession = async () => {
    const { getSession } = await import('@/lib/session');
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'غير مصرح — يرجى تسجيل الدخول', code: 'SESSION_REQUIRED' },
        { status: 401 },
      );
    }
    return {
      ...session,
      TenantId: session.TenantId ?? TEST_TENANT_ID,
      MembershipId: 'test-membership',
    };
  };
  return {
    ...actual,
    requireTenantSession: vi.fn(fromSession),
    requireLegacyGlobalDataSession: vi.fn(fromSession),
  };
}
