// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import fs from 'fs';
import path from 'path';
import EmployeeLedgerPanel from '@/components/hr/EmployeeLedgerPanel';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const emptyBreakdown = (branchId: number, code: string, name: string, balance: number) => ({
  branchId,
  branchCode: code,
  branchName: name,
  salary: 0,
  target: 0,
  funding: 0,
  payout: 0,
  revenueWithdrawal: 0,
  advance: Math.max(0, -balance),
  deductions: 0,
  settlementNet: 0,
  balance,
  salaryCredits: 0,
  targetCredits: 0,
  fundingCredits: 0,
  repaymentCredits: 0,
  settlementCredits: 0,
  advanceDebits: Math.max(0, -balance),
  payoutDebits: 0,
  deductionDebits: 0,
  settlementDebits: 0,
});

const ziyadRow = {
  empId: 12,
  empName: 'زياد',
  salaryCredits: 0,
  targetCredits: 0,
  fundingCredits: 0,
  repaymentCredits: 0,
  advanceDebits: 3000,
  payoutDebits: 0,
  deductionDebits: 0,
  balance: -3000,
  overallBalance: -3000,
  revenue: 0,
  payoutWithinDues: 0,
  revenueWithdrawal: 0,
  advanceExcess: 3000,
  branches: {
    GLEEM: emptyBreakdown(1, 'GLEEM', 'جليم', -1800),
    CAMP_CAESAR: emptyBreakdown(3, 'CAMP_CAESAR', 'كامب شيزار', -1200),
  },
};

describe('EmployeeLedgerPanel advance repayment UX', () => {
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
            operatingBranch: { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم' },
            tableBranches: [
              { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم', label: 'جليم' },
              { branchId: 3, branchCode: 'CAMP_CAESAR', branchName: 'كامب شيزار', label: 'كامب شيزار' },
            ],
            employees: [ziyadRow],
            totals: {
              salaryCredits: 0,
              targetCredits: 0,
              fundingCredits: 0,
              repaymentCredits: 0,
              advanceDebits: 3000,
              payoutDebits: 0,
              deductionDebits: 0,
              balance: -3000,
              revenue: 0,
              payoutWithinDues: 0,
              revenueWithdrawal: 0,
              advanceExcess: 3000,
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
        return { ok: true, json: async () => [{ EmpID: 12, EmpName: 'زياد' }] };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('source: repayment ignores branchViewMatchesOperating; payout still requires it', () => {
    const root = path.join(__dirname, '..', '..', '..', '..');
    const panel = fs.readFileSync(
      path.join(root, 'src/components/hr/EmployeeLedgerPanel.tsx'),
      'utf8',
    );
    expect(panel).toMatch(/openAdvanceRepayment[\s\S]*?branchBreakdown\.branchId !== operatingBranch\.branchId/);
    expect(panel).not.toMatch(
      /openAdvanceRepayment[\s\S]*?if \(!operatingBranch \|\| !branchViewMatchesOperating\) return/,
    );
    expect(panel).toMatch(
      /openPayout[\s\S]*?if \(!operatingBranch \|\| !branchViewMatchesOperating\) return/,
    );
    expect(panel).toContain('data-testid="advance-repayment-branch-rule"');
  });

  it('enables رد سلفة on operating-branch row while filter is الكل', async () => {
    render(<EmployeeLedgerPanel />);
    await waitFor(() => expect(screen.getByText('زياد')).toBeInTheDocument());

    const repayButtons = screen.getAllByRole('button', { name: /رد سلفة/ });
    expect(repayButtons.length).toBeGreaterThanOrEqual(2);

    // Row 0 = GLEEM (operating) enabled; row 1 = CAMP disabled with switch hint
    expect(repayButtons[0]).not.toBeDisabled();
    expect(repayButtons[1]).toBeDisabled();
    expect(repayButtons[1].getAttribute('title') ?? '').toMatch(/بدّل الفرع التشغيلي/);

    expect(screen.getByTestId('advance-repayment-branch-rule')).toHaveTextContent(/عرض «الكل»/);
  });
});
