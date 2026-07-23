/**
 * Phase 1D unit tests — ownership helpers, cache keys, gates (no live DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

describe('Phase 1D financial ownership helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('assertActiveBranchOwns matches numeric equality', async () => {
    const { assertActiveBranchOwns } = await import('@/lib/branch/financialOwnership');
    expect(assertActiveBranchOwns(1, 1)).toBe(true);
    expect(assertActiveBranchOwns(1, 2)).toBe(false);
    expect(assertActiveBranchOwns(1, null)).toBe(false);
  });

  it('financialNotFoundResponse is non-disclosing 404', async () => {
    const { financialNotFoundResponse } = await import('@/lib/branch/financialOwnership');
    const res = financialNotFoundResponse();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('غير موجود');
  });

  it('ownershipFromBranchDay uses server day id', async () => {
    const { ownershipFromBranchDay } = await import('@/lib/branch/financialOwnership');
    const o = ownershipFromBranchDay(
      {
        userId: 1,
        branchId: 9,
        branchCode: 'GLEEM',
        branchName: 'x',
        shortName: null,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: false,
      },
      { id: 42, branchId: 9, newDay: '2026-07-22', status: true },
    );
    expect(o).toEqual({ branchId: 9, businessDayId: 42 });
  });

  it('assertShiftMatchesOwnership rejects other-branch shift', async () => {
    const { assertShiftMatchesOwnership } = await import('@/lib/branch/financialOwnership');
    const { BranchDomainError } = await import('@/lib/branch/types');
    expect(() =>
      assertShiftMatchesOwnership(
        {
          id: 1,
          branchId: 2,
          businessDayId: 10,
          userId: 1,
          shiftId: 1,
          newDay: '2026-07-22',
          status: 1,
          openTime: null,
          closeTime: null,
        } as never,
        { branchId: 1, businessDayId: 10 },
      ),
    ).toThrow(BranchDomainError);
  });
});

describe('Phase 1D recent invoice cache key', () => {
  it('includes branchId so branches cannot share cache entries', async () => {
    const { buildRecentInvoicesCacheKey } = await import('@/lib/recentInvoicesQuery');
    const a = buildRecentInvoicesCacheKey({ branchId: 1, q: '', limit: 20 });
    const b = buildRecentInvoicesCacheKey({ branchId: 2, q: '', limit: 20 });
    expect(a).not.toEqual(b);
    expect(a).toContain('"branchId":1');
  });
});

describe('Phase 1D past-date day gate', () => {
  it('resolveBranchDayForDate returns 400 when day missing', async () => {
    vi.doMock('@/lib/branch/businessDay', () => ({
      getBusinessDayByDate: vi.fn(async () => null),
      getOpenBusinessDay: vi.fn(),
    }));
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (x: unknown) => typeof x === 'object' && x !== null && 'branchId' in (x as object),
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(),
      getUserOpenShiftForBranch: vi.fn(),
    }));

    const { resolveBranchDayForDate } = await import('@/lib/branch/operationalGates');
    const result = await resolveBranchDayForDate(1, '2024-01-01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.code).toBe('NO_BUSINESS_DAY_FOR_DATE');
    }
  });
});
