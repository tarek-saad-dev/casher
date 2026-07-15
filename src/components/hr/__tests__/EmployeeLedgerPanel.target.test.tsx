// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmployeeLedgerPanel from '@/components/hr/EmployeeLedgerPanel';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('EmployeeLedgerPanel target separation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('employee-ledger/summary')) {
        return {
          ok: true,
          json: async () => ({
            ledgerDualWriteEnabled: true,
            employees: [
              {
                empId: 12,
                empName: 'أحمد',
                salaryCredits: 350,
                targetCredits: 100,
                fundingCredits: 0,
                advanceDebits: 0,
                payoutDebits: 0,
                deductionDebits: 0,
                balance: 450,
              },
            ],
            totals: {
              salaryCredits: 350,
              targetCredits: 100,
              fundingCredits: 0,
              advanceDebits: 0,
              payoutDebits: 0,
              deductionDebits: 0,
              balance: 450,
            },
          }),
        };
      }
      if (u.includes('/api/admin/hr/employee-ledger?')) {
        return {
          ok: true,
          json: async () => ({
            entries: [
              {
                id: 1,
                empId: 12,
                empName: 'أحمد',
                entryDate: '2026-07-15',
                entryDirection: 'credit',
                entryReason: 'hourly_wage',
                amount: 350,
                payrollMonth: '2026-07',
                refType: 'TblEmpDailyPayroll',
                refId: 1500,
                cashMoveId: null,
                attendanceId: null,
                notes: 'أجر',
                isVoided: false,
                voidReason: null,
                createdByUserId: 1,
                createdAt: 'x',
                updatedAt: null,
              },
              {
                id: 2,
                empId: 12,
                empName: 'أحمد',
                entryDate: '2026-07-15',
                entryDirection: 'credit',
                entryReason: 'target',
                amount: 100,
                payrollMonth: '2026-07',
                refType: 'TblEmpDailyTarget',
                refId: 25,
                cashMoveId: null,
                attendanceId: null,
                notes: 'استحقاق تارجت يومي بتاريخ 2026-07-15',
                isVoided: false,
                voidReason: null,
                createdByUserId: 1,
                createdAt: 'x',
                updatedAt: null,
              },
            ],
            totalCredits: 450,
            totalDebits: 0,
            balance: 450,
            filters: { empId: null, dateFrom: null, dateTo: null, month: '2026-07' },
          }),
        };
      }
      if (u.includes('/api/payroll/daily/targets/25')) {
        return {
          ok: true,
          json: async () => ({
            dailyTarget: {
              id: 25,
              empId: 12,
              empName: 'أحمد',
              workDate: '2026-07-15',
              targetPlanId: 3,
              netSalesAfterDiscount: 1500,
              targetAmount: 100,
              inputBasis: 'daily',
              conversionDays: 26,
              calculationBreakdownJson: '{"targetAmount":"100.00"}',
              generatedAt: 'g',
              updatedAt: null,
            },
            tiers: [{ sortOrder: 1, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20 }],
            ledger: { id: 2, amount: 100, entryDate: '2026-07-15', payrollMonth: '2026-07', cashMoveId: null },
            match: { status: 'matched', message: 'متطابق' },
          }),
        };
      }
      if (u.includes('/api/employees')) {
        return { ok: true, json: async () => [{ EmpID: 12, EmpName: 'أحمد' }] };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('shows salary and target as separate cards and columns', async () => {
    render(<EmployeeLedgerPanel />);
    await waitFor(() => expect(screen.getByText('استحقاق راتب')).toBeInTheDocument());
    expect(screen.getAllByText('تارجت').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Combined/i)).not.toBeInTheDocument();
    expect(screen.getByText('أجر ساعات')).toBeInTheDocument();
    expect(screen.getByText('تارجت يومي')).toBeInTheDocument();
    expect(screen.getByText(/TblEmpDailyTarget #25/)).toBeInTheDocument();
    expect(screen.getByText(/TblEmpDailyPayroll #1500/)).toBeInTheDocument();
  });

  it('opens snapshot details for daily target ledger row', async () => {
    render(<EmployeeLedgerPanel />);
    await waitFor(() => expect(screen.getByText('تارجت يومي')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تارجت يومي'));
    await waitFor(() => expect(screen.getByText('تفاصيل تارجت يومي')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/CalculationBreakdownJson/)).toBeInTheDocument());
  });
});
