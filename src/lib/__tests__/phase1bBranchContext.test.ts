import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { BranchDomainError } from '@/lib/branch/types';

vi.mock('server-only', () => ({}));

describe('Phase 1B branch context', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
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
});
