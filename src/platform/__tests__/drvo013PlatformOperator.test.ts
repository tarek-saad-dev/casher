/**
 * DRVO-013 — platform-operator context is separate from tenant staff context.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const PLATFORM_TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  roles: [] as string[],
  isSuperAdmin: false,
  /** userId -> tenants the user is a member of */
  memberships: {} as Record<number, string[]>,
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => state.session),
  destroySession: vi.fn(async () => undefined),
}));
vi.mock('@/lib/branch/repository', () => ({
  getUserActiveStatus: vi.fn(async () => ({ exists: true, isDeleted: false, userName: 'u', userLevel: 'admin' })),
}));
vi.mock('@/lib/permissions-server', () => ({
  getUserAccess: vi.fn(async () => ({ roles: state.roles, isSuperAdmin: state.isSuperAdmin, pages: [] })),
}));
vi.mock('@/platform/tenant/legacyBootstrapSeam', () => ({
  resolveLegacyBootstrapTenantId: vi.fn(async (seam: string) => {
    if (seam !== 'platform-operator-tenant') throw new Error(`unexpected seam ${seam}`);
    return PLATFORM_TENANT;
  }),
}));
vi.mock('@/platform/tenant/tenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/tenant/tenantContext')>();
  return {
    ...actual,
    assertLegacyUserInTenant: vi.fn(async (tenantId: string, userId: number) => {
      if (!(state.memberships[userId] ?? []).includes(tenantId)) {
        throw new actual.TenantContextError('USER_NOT_IN_TENANT', 'not a member');
      }
      return `m-${userId}`;
    }),
  };
});

import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';

function sessionFor(userId: number, tenantId: string) {
  return {
    UserID: userId,
    UserName: `user${userId}`,
    UserLevel: 'admin',
    ActiveBranchID: 1,
    ActiveBranchCode: 'B1',
    BranchSessionVersion: 1,
    TenantId: tenantId,
    MembershipId: `m-${userId}`,
  };
}

beforeEach(() => {
  state.session = null;
  state.roles = [];
  state.isSuperAdmin = false;
  state.memberships = {};
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('DRVO-013 platform operator separation', () => {
  it('a super_admin of the platform-owner tenant is a platform operator with no tenant context', async () => {
    state.session = sessionFor(1, PLATFORM_TENANT);
    state.roles = ['super_admin'];
    state.isSuperAdmin = true;
    state.memberships = { 1: [PLATFORM_TENANT] };

    const result = await requirePlatformOperator();
    expect(isAuthResult(result)).toBe(true);
    expect(result).toEqual({
      ok: true,
      kind: 'platform_operator',
      userId: 1,
      userName: 'user1',
      roles: ['super_admin'],
    });
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('activeBranchId');
  });

  it('a tenant admin with super_admin inside their own tenant is NOT a platform operator', async () => {
    state.session = sessionFor(2, TENANT_B);
    state.roles = ['super_admin'];
    state.isSuperAdmin = true;
    state.memberships = { 2: [TENANT_B] };

    const result = await requirePlatformOperator();
    expect(isAuthResult(result)).toBe(false);
    expect((result as NextResponse).status).toBe(403);
  });

  it('platform-owner membership without super_admin is not enough', async () => {
    state.session = sessionFor(3, PLATFORM_TENANT);
    state.roles = ['admin'];
    state.memberships = { 3: [PLATFORM_TENANT] };

    const result = await requirePlatformOperator();
    expect((result as NextResponse).status).toBe(403);
  });

  it('anonymous callers are rejected before any tenant lookup', async () => {
    const result = await requirePlatformOperator();
    expect((result as NextResponse).status).toBe(401);
  });
});
