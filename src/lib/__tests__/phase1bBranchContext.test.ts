import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { BranchDomainError } from '@/lib/branch/types';

vi.mock('server-only', () => ({}));

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantBranches: Record<string, number[]> = { [TENANT_A]: [1] };
const subscriptionActive: Record<string, boolean> = {};

describe('Phase 1B branch context', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    subscriptionActive[TENANT_A] = true;
    vi.doMock('@/platform/tenant/tenantContext', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/platform/tenant/tenantContext')>();
      return {
        ...actual,
        resolveStaffTenantContextForRequest: vi.fn(
          async (input: { userId: number; activeBranchId: number; preferredTenantId?: string | null }) => {
            const tenantId = String(input.preferredTenantId);
            if (!(tenantBranches[tenantId] ?? []).includes(input.activeBranchId)) {
              throw new actual.TenantContextError('LOCATION_NOT_IN_TENANT', 'cross-tenant');
            }
            return { kind: 'staff', tenantId, tenantCode: 'A', membershipId: 'm', userId: input.userId };
          },
        ),
      };
    });
    vi.doMock('@/platform/commercial/tenantAccessGate', async () => {
      class TenantAccessDeniedError extends Error {
        readonly status = 403;
        readonly code = 'SUBSCRIPTION_INACTIVE';
      }
      return {
        TenantAccessDeniedError,
        assertTenantSubscriptionActive: vi.fn(async (tenantId: string) => {
          if (!subscriptionActive[tenantId]) throw new TenantAccessDeniedError('اشتراك المنشأة غير نشط');
          return { allowed: true };
        }),
        assertRouteAppEntitlement: vi.fn(async () => null),
      };
    });
  });

  it('rejects revoked mapping immediately', async () => {
    vi.doMock('@/lib/session', () => ({
      getSessionPayload: vi.fn(async () => ({
        UserID: 1,
        UserName: 'A',
        UserLevel: 'user',
        ActiveBranchID: 1,
        ActiveBranchCode: 'GLEEM',
        BranchSessionVersion: 1,
        TenantId: TENANT_A,
        MembershipId: 'm-a',
        iat: 1,
      })),
      destroySession: vi.fn(async () => undefined),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: 'A',
        userLevel: 'user',
      })),
      getBranchById: vi.fn(async () => ({
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        address: null,
        phone: null,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        defaultOpenTime: null,
        defaultCloseTime: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: null,
      })),
      getUserBranchAccess: vi.fn(),
      branchNow: () => new Date(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => {
        throw new BranchDomainError('BRANCH_ACCESS_INACTIVE', 'revoked', 403);
      }),
    }));

    const { requireActiveBranchContext, isActiveBranchContext } = await import(
      '@/lib/branch/context'
    );
    const result = await requireActiveBranchContext();
    expect(isActiveBranchContext(result)).toBe(false);
    expect((result as NextResponse).status).toBe(403);
  });

  it('rejects expired mapping immediately', async () => {
    vi.doMock('@/lib/session', () => ({
      getSessionPayload: vi.fn(async () => ({
        UserID: 1,
        UserName: 'A',
        UserLevel: 'user',
        ActiveBranchID: 1,
        ActiveBranchCode: 'GLEEM',
        BranchSessionVersion: 1,
        TenantId: TENANT_A,
        MembershipId: 'm-a',
        iat: 1,
      })),
      destroySession: vi.fn(async () => undefined),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: 'A',
        userLevel: 'user',
      })),
      getBranchById: vi.fn(async () => ({
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: null,
        address: null,
        phone: null,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        defaultOpenTime: null,
        defaultCloseTime: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: null,
      })),
      branchNow: () => new Date(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => {
        throw new BranchDomainError('BRANCH_ACCESS_EXPIRED', 'expired', 403);
      }),
    }));
    const { requireActiveBranchContext, isActiveBranchContext } = await import(
      '@/lib/branch/context'
    );
    const result = await requireActiveBranchContext();
    expect(isActiveBranchContext(result)).toBe(false);
  });

  it('enforces operation and report capabilities via helpers', async () => {
    vi.doMock('@/lib/session', () => ({
      getSessionPayload: vi.fn(async () => ({
        UserID: 1,
        UserName: 'A',
        UserLevel: 'user',
        ActiveBranchID: 1,
        ActiveBranchCode: 'GLEEM',
        BranchSessionVersion: 1,
        TenantId: TENANT_A,
        MembershipId: 'm-a',
        iat: 1,
      })),
      destroySession: vi.fn(async () => undefined),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: 'A',
        userLevel: 'user',
      })),
      getBranchById: vi.fn(async () => ({
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        address: null,
        phone: null,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        defaultOpenTime: null,
        defaultCloseTime: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: null,
      })),
      branchNow: () => new Date(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => ({
        id: 1,
        userId: 1,
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        isDefault: true,
        canOperate: false,
        canViewReports: false,
        canSwitch: false,
        isActive: true,
        validFrom: new Date('2020-01-01'),
        validTo: null,
        branchIsActive: true,
      })),
    }));

    const {
      requireBranchOperationAccess,
      requireBranchReportAccess,
      isActiveBranchContext,
    } = await import('@/lib/branch/context');

    const op = await requireBranchOperationAccess();
    const report = await requireBranchReportAccess();
    expect(isActiveBranchContext(op)).toBe(false);
    expect(isActiveBranchContext(report)).toBe(false);
    expect((op as NextResponse).status).toBe(403);
    expect((report as NextResponse).status).toBe(403);
  });

  function mockOperableBranch(branchId: number, tenantId: string | undefined) {
    const destroySession = vi.fn(async () => undefined);
    vi.doMock('@/lib/session', () => ({
      getSessionPayload: vi.fn(async () => ({
        UserID: 1,
        UserName: 'A',
        UserLevel: 'user',
        ActiveBranchID: branchId,
        ActiveBranchCode: 'B' + branchId,
        BranchSessionVersion: 1,
        ...(tenantId ? { TenantId: tenantId, MembershipId: 'm' } : {}),
        iat: 1,
      })),
      destroySession,
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: 'A',
        userLevel: 'user',
      })),
      getBranchById: vi.fn(async () => ({
        branchId,
        branchCode: 'B' + branchId,
        branchName: 'B',
        shortName: null,
        address: null,
        phone: null,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        defaultOpenTime: null,
        defaultCloseTime: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: null,
      })),
      branchNow: () => new Date(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => ({
        id: 1,
        userId: 1,
        branchId,
        branchCode: 'B' + branchId,
        branchName: 'B',
        shortName: null,
        isDefault: true,
        canOperate: true,
        canViewReports: true,
        canSwitch: false,
        isActive: true,
        validFrom: new Date('2020-01-01'),
        validTo: null,
        branchIsActive: true,
      })),
    }));
    return { destroySession };
  }

  it('DRVO-013: resolves the session tenant when the branch belongs to it', async () => {
    mockOperableBranch(1, TENANT_A);
    const { requireActiveBranchContext, isActiveBranchContext } = await import('@/lib/branch/context');
    const result = await requireActiveBranchContext();
    expect(isActiveBranchContext(result)).toBe(true);
    expect((result as { tenantId?: string }).tenantId).toBe(TENANT_A);
  });

  it('DRVO-013: rejects a session without a tenant binding (no default tenant)', async () => {
    mockOperableBranch(1, undefined);
    const { requireActiveBranchContext, isActiveBranchContext } = await import('@/lib/branch/context');
    const result = await requireActiveBranchContext();
    expect(isActiveBranchContext(result)).toBe(false);
    expect((result as NextResponse).status).toBe(401);
  });

  it('DRVO-013: a suspended / lapsed tenant subscription is denied with 403', async () => {
    mockOperableBranch(1, TENANT_A);
    subscriptionActive[TENANT_A] = false;
    const { requireActiveBranchContext, isActiveBranchContext } = await import('@/lib/branch/context');
    const result = await requireActiveBranchContext();
    expect(isActiveBranchContext(result)).toBe(false);
    expect((result as NextResponse).status).toBe(403);
    expect(await (result as NextResponse).json()).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' });
  });

  it('DRVO-013: rejects an active branch that is not a Location of the session tenant', async () => {
    mockOperableBranch(2, TENANT_A);
    const { requireActiveBranchContext, isActiveBranchContext } = await import('@/lib/branch/context');
    const result = await requireActiveBranchContext();
    expect(isActiveBranchContext(result)).toBe(false);
    expect((result as NextResponse).status).toBe(401);
  });
});
