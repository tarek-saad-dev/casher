import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getMonthDateRange,
  parseMonthYearParams,
  validateMonthYear,
  roundMoney,
} from '@/lib/reportMonthUtils';
import { isBarberOrServiceWorker } from '@/lib/services/employeeServicesReportService';

function calcPartnersOperatingNet(
  totalRevenue: number,
  totalEmployeeAdvances: number,
  operatingExpenses: number
): number {
  return roundMoney(totalRevenue - totalEmployeeAdvances - operatingExpenses);
}

vi.mock('server-only', () => ({}));

const mockBuildReport = vi.fn();
const mockRequirePageAccess = vi.fn();
const mockResolveScope = vi.fn();

vi.mock('@/lib/services/partnersReportService', () => ({
  buildPartnersMonthlyReport: (...args: unknown[]) => mockBuildReport(...args),
}));

// Phase 1E: the route now authorizes via requirePageAccess (session + page ACL)
// and resolves branch scope via resolveReportBranchScope — mock both directly
// rather than the lower-level session/permissions modules they wrap.
vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: (...args: unknown[]) => mockRequirePageAccess(...args),
  isAuthResult: (v: unknown) => Boolean(v) && (v as { ok?: unknown }).ok === true,
}));

vi.mock('@/lib/branch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/branch')>('@/lib/branch');
  return {
    ...actual,
    resolveReportBranchScope: (...args: unknown[]) => mockResolveScope(...args),
  };
});

import { NextResponse } from 'next/server';
import { GET } from '@/app/api/admin/reports/partners/route';

const AUTHORIZED_AUTH_RESULT = {
  ok: true,
  userId: 1,
  userName: 'Admin',
  userLevel: '1',
  roles: ['admin'],
  isSuperAdmin: true,
  activeBranchId: 1,
  activeBranchCode: 'MAIN',
};

const SINGLE_BRANCH_SCOPE = {
  mode: 'single' as const,
  branchId: 1,
  branchCode: 'MAIN',
  branchName: 'Main Branch',
  shortName: null,
};

const sampleReport = {
  period: { year: 2026, month: 6, startDate: '2026-06-01', endDate: '2026-06-30' },
  summary: {
    totalRevenue: 100000,
    totalExpenses: 65000,
    operatingExpenses: 57000,
    excludedEmployeeSettlementExpenses: 8000,
    totalEmployeeAdvances: 8000,
    advancesIncludedInExpenses: false,
    operatingNet: 35000,
    operatingNetExplanation: 'test',
  },
  revenueDetails: [],
  expensesByCategory: [],
  employeeAdvances: [],
  employeeSummary: [],
  employeeSummaryTotals: {
    totalShopRevenue: 0,
    totalPaidSalaryAndAdvances: 0,
  },
  metadata: { generatedAt: '2026-06-27T00:00:00.000Z' },
};

describe('reportMonthUtils', () => {
  it('calculates month boundaries correctly', () => {
    expect(getMonthDateRange(2026, 6)).toEqual({
      year: 2026,
      month: 6,
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });
    expect(getMonthDateRange(2024, 2)).toEqual({
      year: 2024,
      month: 2,
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });

  it('defaults missing query params to current month', () => {
    const now = new Date(2026, 5, 15);
    expect(parseMonthYearParams(null, null, now)).toEqual({ year: 2026, month: 6 });
  });

  it('rejects invalid month and year', () => {
    expect(validateMonthYear(2019, 6)).toBe('سنة غير صالحة');
    expect(validateMonthYear(2026, 0)).toBe('شهر غير صالح');
    expect(validateMonthYear(2026, 13)).toBe('شهر غير صالح');
    expect(validateMonthYear(2026, 6)).toBeNull();
  });
});

describe('partners operating net calculation', () => {
  it('subtracts employee advances and filtered operating expenses from revenue', () => {
    expect(calcPartnersOperatingNet(100000, 8000, 57000)).toBe(35000);
  });

  it('does not double-count settlement categories already in employee advances', () => {
    const operatingExpenses = 57000;
    const excludedSettlement = 8000;
    const rawExpenses = operatingExpenses + excludedSettlement;
    expect(rawExpenses).toBe(65000);
    expect(calcPartnersOperatingNet(100000, 8000, operatingExpenses)).toBe(35000);
    expect(calcPartnersOperatingNet(100000, 8000, rawExpenses)).not.toBe(35000);
  });

  it('handles zero totals', () => {
    expect(calcPartnersOperatingNet(0, 0, 0)).toBe(0);
  });
});

describe('GET /api/admin/reports/partners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePageAccess.mockResolvedValue(AUTHORIZED_AUTH_RESULT);
    mockResolveScope.mockResolvedValue(SINGLE_BRANCH_SCOPE);
    mockBuildReport.mockResolvedValue(sampleReport);
  });

  function makeRequest(year?: string, month?: string) {
    const params = new URLSearchParams();
    if (year) params.set('year', year);
    if (month) params.set('month', month);
    const qs = params.toString();
    return new NextRequest(`http://localhost/api/admin/reports/partners${qs ? `?${qs}` : ''}`);
  }

  it('returns 401 for unauthenticated requests', async () => {
    mockRequirePageAccess.mockResolvedValue(
      NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
    );
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for unauthorized users', async () => {
    mockRequirePageAccess.mockResolvedValue(
      NextResponse.json({ error: 'غير مصرح' }, { status: 403 }),
    );
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid month/year', async () => {
    const res = await GET(makeRequest('2019', '6'));
    expect(res.status).toBe(400);
    const res2 = await GET(makeRequest('2026', '13'));
    expect(res2.status).toBe(400);
  });

  it('returns 400 for partners report periods before June 2026', async () => {
    const res = await GET(makeRequest('2026', '5'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('يونيو 2026');
    expect(mockBuildReport).not.toHaveBeenCalled();
  });

  it('returns 403 when branch scope resolution denies access', async () => {
    mockResolveScope.mockResolvedValue(
      NextResponse.json({ error: 'غير مصرح', code: 'REPORT_NOT_ALLOWED' }, { status: 403 }),
    );
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(403);
    expect(mockBuildReport).not.toHaveBeenCalled();
  });

  it('returns single-branch report for authorized users, scoped to their active branch', async () => {
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalRevenue).toBe(100000);
    expect(body.scope.mode).toBe('single');
    expect(body.scope.branch.BranchID).toBe(1);
    expect(mockBuildReport).toHaveBeenCalledWith(2026, 6, 1);
  });

  it('consolidates partner entitlements per-branch when scope=all', async () => {
    mockResolveScope.mockResolvedValue({
      mode: 'all' as const,
      branchIds: [1, 2],
      branches: [
        { branchId: 1, branchCode: 'A', branchName: 'Alpha', shortName: null },
        { branchId: 2, branchCode: 'B', branchName: 'Beta', shortName: null },
      ],
    });
    mockBuildReport.mockImplementation(async (_year: number, _month: number, branchId: number) => ({
      ...sampleReport,
      summary: { ...sampleReport.summary, operatingNet: branchId === 1 ? 10000 : 20000 },
      partners: [
        { name: 'Partner A', percentage: 50, partnerCode: 'A' },
        { name: 'Partner B', percentage: 50, partnerCode: 'B' },
      ],
    }));

    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope.mode).toBe('all');
    expect(body.branches).toHaveLength(2);
    expect(body.consolidated.operatingNet).toBe(30000);
    const partnerA = body.consolidated.entitlements.find(
      (e: { partnerCode: string }) => e.partnerCode === 'A',
    );
    // Each branch applies its OWN 50% share to its OWN operatingNet: 5000 + 10000 = 15000.
    expect(partnerA.total).toBe(15000);
    expect(mockBuildReport).toHaveBeenCalledWith(2026, 6, 1);
    expect(mockBuildReport).toHaveBeenCalledWith(2026, 6, 2);
  });
});

describe('isBarberOrServiceWorker', () => {
  it('identifies barbers and assistants', () => {
    expect(isBarberOrServiceWorker('حلاق')).toBe(true);
    expect(isBarberOrServiceWorker('مساعد')).toBe(true);
    expect(isBarberOrServiceWorker('Barber')).toBe(true);
    expect(isBarberOrServiceWorker('محاسب')).toBe(false);
    expect(isBarberOrServiceWorker(null)).toBe(false);
  });
});

describe('reconciliation helpers', () => {
  it('matches revenue total from employee services aggregation', () => {
    const employeeTotals = [45000, 35000, 20000];
    const totalRevenue = roundMoney(employeeTotals.reduce((a, b) => a + b, 0));
    expect(totalRevenue).toBe(100000);
  });

  it('matches expense category totals to summary total', () => {
    const categories = [
      { totalAmount: 40000 },
      { totalAmount: 25000 },
    ];
    const totalExpenses = roundMoney(categories.reduce((sum, c) => sum + c.totalAmount, 0));
    expect(totalExpenses).toBe(65000);
  });

  it('matches employee advances total to advances rows', () => {
    const advances = [
      { totalAdvance: 5000 },
      { totalAdvance: 3000 },
    ];
    const totalAdvances = roundMoney(advances.reduce((sum, a) => sum + a.totalAdvance, 0));
    expect(totalAdvances).toBe(8000);
  });

  it('handles no-data month with zero totals', () => {
    expect(calcPartnersOperatingNet(0, 0, 0)).toBe(0);
  });
});
