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
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('resolveBranchDayForDate returns 400 when day missing', async () => {
    vi.doMock('@/lib/branch/businessDay', () => ({
      getBusinessDayByDate: vi.fn(async () => null),
      getOpenBusinessDay: vi.fn(),
      getBranchBusinessDate: vi.fn(() => '2024-01-01'),
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

describe('Phase 1D POS active-branch day write', () => {
  const branch = {
    userId: 1,
    branchId: 3,
    branchCode: 'CAMP_CAESAR',
    branchName: 'كامب شيزار',
    shortName: 'كامب',
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
    canOperate: true,
    canViewReports: true,
    canSwitch: true,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('resolveActiveBranchDayForPosWrite prefers open day on active branch', async () => {
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => ({
        id: 99,
        branchId: 3,
        newDay: '2026-07-30',
        status: true,
      })),
      getBusinessDayByDate: vi.fn(async () => null),
      getBranchBusinessDate: vi.fn(() => '2026-07-31'),
    }));
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: () => true,
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(),
      getUserOpenShiftForBranch: vi.fn(),
    }));

    const { resolveActiveBranchDayForPosWrite } = await import('@/lib/branch/operationalGates');
    const result = await resolveActiveBranchDayForPosWrite(branch as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.day.id).toBe(99);
      expect(result.dateYmd).toBe('2026-07-30');
    }
  });

  it('resolveActiveBranchDayForPosWrite falls back to cutoff business date when no open day', async () => {
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => null),
      getBusinessDayByDate: vi.fn(async (_branchId: number, date: string) =>
        date === '2026-07-30'
          ? { id: 77, branchId: 3, newDay: '2026-07-30', status: false }
          : null,
      ),
      getBranchBusinessDate: vi.fn(() => '2026-07-30'),
    }));
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: () => true,
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(),
      getUserOpenShiftForBranch: vi.fn(),
    }));

    const { resolveActiveBranchDayForPosWrite } = await import('@/lib/branch/operationalGates');
    const result = await resolveActiveBranchDayForPosWrite(branch as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.day.id).toBe(77);
      expect(result.dateYmd).toBe('2026-07-30');
    }
  });
});

describe('branch business date overnight cutoff', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/branch/businessDay');
    vi.doUnmock('@/lib/branch/context');
    vi.doUnmock('@/lib/branch/shiftSession');
  });

  it('getBranchBusinessDate before 04:00 Cairo returns previous calendar day', async () => {
    const { getBranchBusinessDate } = await import('@/lib/branch/businessDay');
    // 2026-07-31 01:30 Cairo = 2026-07-30 22:30 UTC (UTC+3)
    const overnight = new Date('2026-07-30T22:30:00.000Z');
    expect(
      getBranchBusinessDate(
        { timeZone: 'Africa/Cairo', businessDayCutoffTime: '04:00:00' },
        overnight,
      ),
    ).toBe('2026-07-30');
  });

  it('getBranchBusinessDate at/after 04:00 Cairo returns calendar day', async () => {
    const { getBranchBusinessDate } = await import('@/lib/branch/businessDay');
    // 2026-07-31 05:00 Cairo = 2026-07-31 02:00 UTC (UTC+3)
    const morning = new Date('2026-07-31T02:00:00.000Z');
    expect(
      getBranchBusinessDate(
        { timeZone: 'Africa/Cairo', businessDayCutoffTime: '04:00:00' },
        morning,
      ),
    ).toBe('2026-07-31');
  });
});
