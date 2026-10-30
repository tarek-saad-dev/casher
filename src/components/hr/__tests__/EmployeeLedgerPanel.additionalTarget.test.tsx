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

describe('EmployeeLedgerPanel additional target', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('employee-ledger/summary')) {
        return {
          ok: true,
          json: async () => ({
            ledgerDualWriteEnabled: true,
            accessibleBranches: [
              { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم' },
              { branchId: 3, branchCode: 'CAMP_CAESAR', branchName: 'كامب شيزار' },
            ],
            employees: [],
            totals: {
              salaryCredits: 0,
              targetCredits: 0,
              fundingCredits: 0,
              advanceDebits: 0,
              payoutDebits: 0,
              deductionDebits: 0,
              balance: 0,
              revenue: 0,
              payoutWithinDues: 0,
              revenueWithdrawal: 0,
              advanceExcess: 0,
            },
          }),
        };
      }
      if (u.includes('/api/admin/hr/employee-ledger?')) {
        return {
          ok: true,
          json: async () => ({
            entries: [],
            totalCredits: 0,
            totalDebits: 0,
            balance: 0,
            filters: { empId: null, dateFrom: null, dateTo: null, month: null, branchId: null },
          }),
        };
      }
      if (u.includes('/api/employees')) {
        return {
          ok: true,
          json: async () => [{ EmpID: 21, EmpName: 'هدى' }],
        };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('shows تارجت إضافي action and opens modal', async () => {
    render(<EmployeeLedgerPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /تارجت إضافي/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /تارجت إضافي/ }));
    await waitFor(() => expect(screen.getByText(/تارجت إضافي \(بونص\)/)).toBeInTheDocument());
  });
});
