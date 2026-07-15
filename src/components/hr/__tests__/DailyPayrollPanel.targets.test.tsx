// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DailyPayrollPanel from '@/components/hr/DailyPayrollPanel';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('DailyPayrollPanel Phase 3 target UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/payroll/daily/auto-generate')) {
        return { ok: true, json: async () => ({ found: false }) };
      }
      if (u.includes('/api/admin/hr/employee-ledger/summary')) {
        return {
          ok: true,
          json: async () => ({
            ledgerDualWriteEnabled: false,
            legacyPostToCashDisabled: true,
          }),
        };
      }
      if (u.includes('/api/payroll/daily/targets?')) {
        return {
          ok: true,
          json: async () => ({
            workDate: '2026-07-15',
            totals: {
              eligibleEmployees: 1,
              notGenerated: 1,
              generated: 0,
              recalculated: 0,
              zeroSales: 0,
              belowFirstTier: 0,
              earnedTarget: 0,
              totalCurrentNetSalesAfterDiscount: '700.00',
              totalStoredTargetAmount: '0.00',
            },
            employees: [
              {
                empId: 3,
                empName: 'كريم',
                persistenceStatus: 'not_generated',
                displayStatus: null,
                currentNetSalesAfterDiscount: '700.00',
                storedNetSalesAfterDiscount: null,
                storedTargetAmount: null,
                planSummary: 'فوق 1000.00 = 20.00%',
                targetPlanId: 2,
                tierCount: 1,
                firstDailyStartAmount: '1000.000000',
                firstRatePercent: '20.000000',
                generatedAt: null,
                updatedAt: null,
                previewTargetAmount: '0.00',
                previewBreakdown: [],
                tiers: [{ sortOrder: 1, dailyStartAmount: '1000', ratePercent: '20', inputStartAmount: '1000' }],
                inputBasis: 'daily',
                conversionDays: 26,
                planEffectiveFrom: '2026-01-01',
                planEffectiveTo: null,
                calculationBreakdownJson: null,
                dailyTargetId: null,
              },
            ],
            planConflicts: [],
          }),
        };
      }
      if (u.includes('/api/payroll/daily?')) {
        return {
          ok: true,
          json: async () => ({
            rows: [
              {
                ID: 1,
                EmpID: 1,
                EmpName: 'أحمد',
                EmploymentType: 'full_time',
                PayrollMethod: 'hourly',
                HourlyRateSnapshot: 50,
                DailyRate: null,
                WorkDate: '2026-07-15',
                ActualHours: 8,
                AttendanceStatus: 'Present',
                DailyWage: 400,
                Status: 'Generated',
                CashMoveID: null,
                EmployeeIncomeCashMoveID: null,
                Notes: null,
                CheckInTime: '10:00',
                CheckOutTime: '18:00',
                LateMinutes: 0,
                RevenueExpINID: 1,
                RevenueCatName: 'إيراد',
                needsIncomeRepair: false,
              },
            ],
            summary: {
              total: 1,
              totalWage: 400,
              totalHours: 8,
              postedCount: 0,
              generatedCount: 1,
              earnedCount: 0,
              repairCount: 0,
              totalExpenseAmount: 0,
              totalEmployeeIncomeAmount: 0,
            },
            missingMappingEmps: [],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('loads and merges payroll + target-only rows; shows separate columns', async () => {
    render(<DailyPayrollPanel />);
    fireEvent.click(screen.getByRole('button', { name: /تحميل البيانات/ }));

    await waitFor(() => {
      expect(screen.getByText('أحمد')).toBeInTheDocument();
      expect(screen.getByText('كريم')).toBeInTheDocument();
    });

    expect(screen.getByText('الأساسي اليومي')).toBeInTheDocument();
    expect(screen.getByText('تارجت اليوم')).toBeInTheDocument();
    expect(screen.queryByText(/إجمالي الاستحقاق|CombinedPay|الأساسي \+ التارجت/i)).not.toBeInTheDocument();
    expect(screen.getByText('إجمالي الأساسي اليومي')).toBeInTheDocument();
    expect(screen.getByText('إجمالي تارجت اليوم')).toBeInTheDocument();
    expect(screen.getAllByText('لم يتم التوليد').length).toBeGreaterThan(0);
  });

  it('primary generate calls payroll then targets independently', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && u.includes('/api/payroll/daily/generate') && !u.includes('targets')) {
        return {
          ok: true,
          json: async () => ({ generatedCount: 1, totalHours: 8, totalWage: 400 }),
        };
      }
      if (init?.method === 'POST' && u.includes('/targets/generate')) {
        return {
          ok: true,
          json: async () => ({
            totals: { eligibleEmployees: 1, earnedTarget: 0, totalTargetAmount: '0.00' },
          }),
        };
      }
      // fall through to default load responses from beforeEach by re-calling pattern:
      if (u.includes('/api/payroll/daily/auto-generate')) {
        return { ok: true, json: async () => ({ found: false }) };
      }
      if (u.includes('/api/admin/hr/employee-ledger/summary')) {
        return {
          ok: true,
          json: async () => ({ ledgerDualWriteEnabled: false, legacyPostToCashDisabled: true }),
        };
      }
      if (u.includes('/api/payroll/daily/targets?')) {
        return {
          ok: true,
          json: async () => ({
            totals: {
              eligibleEmployees: 0,
              notGenerated: 0,
              earnedTarget: 0,
              totalCurrentNetSalesAfterDiscount: '0.00',
              totalStoredTargetAmount: '0.00',
            },
            employees: [],
            planConflicts: [],
          }),
        };
      }
      if (u.includes('/api/payroll/daily?')) {
        return {
          ok: true,
          json: async () => ({
            rows: [],
            summary: {
              total: 0, totalWage: 0, totalHours: 0, postedCount: 0,
              generatedCount: 0, earnedCount: 0, repairCount: 0,
              totalExpenseAmount: 0, totalEmployeeIncomeAmount: 0,
            },
            missingMappingEmps: [],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<DailyPayrollPanel />);
    fireEvent.click(screen.getByRole('button', { name: /توليد اليوميات والتارجت/ }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
      expect(posts.some((c) => String(c[0]).includes('/api/payroll/daily/generate') && !String(c[0]).includes('targets'))).toBe(true);
      expect(posts.some((c) => String(c[0]).includes('/targets/generate'))).toBe(true);
    });
  });

  it('recalculate target only does not call payroll generate', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const posts: string[] = [];
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') posts.push(u);
      if (init?.method === 'POST' && u.includes('/targets/generate')) {
        return {
          ok: true,
          json: async () => ({
            totals: { eligibleEmployees: 1, earnedTarget: 1, totalTargetAmount: '40.00' },
          }),
        };
      }
      if (u.includes('/api/payroll/daily/auto-generate')) {
        return { ok: true, json: async () => ({ found: false }) };
      }
      if (u.includes('/api/admin/hr/employee-ledger/summary')) {
        return {
          ok: true,
          json: async () => ({ ledgerDualWriteEnabled: false, legacyPostToCashDisabled: true }),
        };
      }
      if (u.includes('/api/payroll/daily/targets?')) {
        return { ok: true, json: async () => ({ totals: null, employees: [], planConflicts: [] }) };
      }
      if (u.includes('/api/payroll/daily?')) {
        return {
          ok: true,
          json: async () => ({
            rows: [],
            summary: {
              total: 0, totalWage: 0, totalHours: 0, postedCount: 0,
              generatedCount: 0, earnedCount: 0, repairCount: 0,
              totalExpenseAmount: 0, totalEmployeeIncomeAmount: 0,
            },
            missingMappingEmps: [],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<DailyPayrollPanel />);
    fireEvent.click(screen.getByRole('button', { name: /إعادة حساب التارجت فقط/ }));

    await waitFor(() => {
      expect(posts.some((p) => p.includes('/targets/generate'))).toBe(true);
    });
    expect(posts.some((p) => p.includes('/api/payroll/daily/generate') && !p.includes('targets'))).toBe(false);
  });
});
