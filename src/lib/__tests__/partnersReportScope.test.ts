/**
 * Partner-only users may view the partners report for their linked branch
 * even when CanViewReports was left 0 by Phase 1B backfill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const ACTIVE_CTX = {
  userId: 17,
  branchId: 2,
  branchCode: 'CC',
  branchName: 'Camp Caesar',
  shortName: 'CC',
  timeZone: 'Africa/Cairo',
  businessDayCutoffTime: '05:00:00',
  canOperate: true,
  canViewReports: false,
  canSwitch: false,
};

function isScope(v: unknown): v is {
  mode: 'single' | 'all';
  branchId?: number;
  branchCode?: string;
} {
  return !(v instanceof NextResponse) && typeof (v as { mode?: unknown }).mode === 'string';
}

describe('resolvePartnersReportBranchScope', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('allows partner-only users on their active branch without CanViewReports', async () => {
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ACTIVE_CTX),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-08-01T00:00:00Z'),
      getBranchById: vi.fn(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/reportScope', () => ({
      resolveReportBranchScope: vi.fn(async () =>
        NextResponse.json({ error: 'should not call staff scope' }, { status: 500 }),
      ),
    }));

    const { resolvePartnersReportBranchScope } = await import('@/lib/branch/partnersReportScope');
    const scope = await resolvePartnersReportBranchScope(['partner'], {
      requestedBranchId: null,
      requestedAllBranches: false,
    });
    expect(isScope(scope)).toBe(true);
    if (isScope(scope) && scope.mode === 'single') {
      expect(scope.branchId).toBe(2);
      expect(scope.branchCode).toBe('CC');
    }
  });

  it('denies partner-only users from scope=all', async () => {
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ACTIVE_CTX),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-08-01T00:00:00Z'),
      getBranchById: vi.fn(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/reportScope', () => ({
      resolveReportBranchScope: vi.fn(),
    }));

    const { resolvePartnersReportBranchScope } = await import('@/lib/branch/partnersReportScope');
    const scope = await resolvePartnersReportBranchScope(['partner'], {
      requestedBranchId: null,
      requestedAllBranches: true,
    });
    expect(isScope(scope)).toBe(false);
    if (!isScope(scope)) {
      expect((scope as NextResponse).status).toBe(403);
      const body = await (scope as NextResponse).json();
      expect(body.code).toBe('ALL_BRANCHES_DENIED');
    }
  });

  it('delegates staff/admin roles to normal report scope (CanViewReports required)', async () => {
    const staffScope = {
      mode: 'single' as const,
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'Gleem',
      shortName: 'GL',
    };
    const resolveReportBranchScope = vi.fn(async () => staffScope);
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: vi.fn(),
      requireActiveBranchContext: vi.fn(),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-08-01T00:00:00Z'),
      getBranchById: vi.fn(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/reportScope', () => ({
      resolveReportBranchScope,
    }));

    const { resolvePartnersReportBranchScope } = await import('@/lib/branch/partnersReportScope');
    const scope = await resolvePartnersReportBranchScope(['admin'], {
      requestedBranchId: null,
      requestedAllBranches: false,
    });
    expect(resolveReportBranchScope).toHaveBeenCalledOnce();
    expect(scope).toEqual(staffScope);
  });
});
