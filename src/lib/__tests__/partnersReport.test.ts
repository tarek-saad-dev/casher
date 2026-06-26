import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getMonthDateRange,
  parseMonthYearParams,
  validateMonthYear,
  roundMoney,
} from '@/lib/reportMonthUtils';
import {
  areAdvancesIncludedInExpenses,
  calculateOperatingNet,
  getOperatingNetExplanation,
} from '@/lib/services/monthlyExpensesReportService';

vi.mock('server-only', () => ({}));

const mockBuildReport = vi.fn();
const mockGetSession = vi.fn();
const mockCanAccessPath = vi.fn();

vi.mock('@/lib/services/partnersReportService', () => ({
  buildPartnersMonthlyReport: (...args: unknown[]) => mockBuildReport(...args),
}));

vi.mock('@/lib/session', () => ({
  getSession: () => mockGetSession(),
}));

vi.mock('@/lib/permissions-server', () => ({
  canAccessPath: (...args: unknown[]) => mockCanAccessPath(...args),
}));

import { GET } from '@/app/api/admin/reports/partners/route';

const sampleReport = {
  period: { year: 2026, month: 6, startDate: '2026-06-01', endDate: '2026-06-30' },
  summary: {
    totalRevenue: 100000,
    totalExpenses: 65000,
    totalEmployeeAdvances: 8000,
    advancesIncludedInExpenses: true,
    operatingNet: 35000,
    operatingNetExplanation: 'test',
  },
  revenueDetails: [],
  expensesByCategory: [],
  employeeAdvances: [],
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

describe('operating net calculation', () => {
  it('subtracts only expenses when advances are included', () => {
    expect(areAdvancesIncludedInExpenses()).toBe(true);
    expect(calculateOperatingNet(100000, 65000, 8000, true)).toBe(35000);
    expect(getOperatingNetExplanation(true)).toContain('السلف مدرجة');
  });

  it('subtracts advances separately when not included in expenses', () => {
    expect(calculateOperatingNet(100000, 65000, 8000, false)).toBe(27000);
    expect(getOperatingNetExplanation(false)).toContain('سلف الموظفين');
  });

  it('does not double-count advances when included', () => {
    const net = calculateOperatingNet(100000, 65000, 8000, true);
    expect(net).not.toBe(roundMoney(100000 - 65000 - 8000));
    expect(net).toBe(35000);
  });
});

describe('GET /api/admin/reports/partners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ UserID: 1, UserName: 'Admin', UserLevel: '1' });
    mockCanAccessPath.mockResolvedValue(true);
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
    mockGetSession.mockResolvedValue(null);
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for unauthorized users', async () => {
    mockCanAccessPath.mockResolvedValue(false);
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid month/year', async () => {
    const res = await GET(makeRequest('2019', '6'));
    expect(res.status).toBe(400);
    const res2 = await GET(makeRequest('2026', '13'));
    expect(res2.status).toBe(400);
  });

  it('returns consolidated report for authorized users', async () => {
    const res = await GET(makeRequest('2026', '6'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalRevenue).toBe(100000);
    expect(mockBuildReport).toHaveBeenCalledWith(2026, 6);
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
    expect(calculateOperatingNet(0, 0, 0, true)).toBe(0);
  });
});
