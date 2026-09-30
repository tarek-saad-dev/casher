// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmployeeLedgerPanel from '@/components/hr/EmployeeLedgerPanel';
import EmployeePayoutModal from '@/components/hr/EmployeePayoutModal';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
    disabled,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label="طريقة الدفع"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">اختر</option>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

const employeeRow = {
  empId: 12,
  empName: 'أحمد',
  salaryCredits: 500,
  targetCredits: 0,
  fundingCredits: 0,
  advanceDebits: 0,
  payoutDebits: 0,
  deductionDebits: 0,
  balance: 500,
  overallBalance: 1000,
  revenue: 0,
  payoutWithinDues: 0,
  revenueWithdrawal: 0,
  advanceExcess: 0,
  branches: {
    GLEEM: {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      salary: 500,
      target: 0,
      funding: 0,
      payout: 0,
      revenueWithdrawal: 0,
      advance: 0,
      deductions: 0,
      balance: 500,
      salaryCredits: 500,
      targetCredits: 0,
      fundingCredits: 0,
      advanceDebits: 0,
      payoutDebits: 0,
      deductionDebits: 0,
    },
    CAMP_CAESAR: {
      branchId: 3,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب شيزار',
      salary: 500,
      target: 0,
      funding: 0,
      payout: 0,
      revenueWithdrawal: 0,
      advance: 0,
      deductions: 0,
      balance: 500,
      salaryCredits: 500,
      targetCredits: 0,
      fundingCredits: 0,
      advanceDebits: 0,
      payoutDebits: 0,
      deductionDebits: 0,
    },
  },
};

function summaryPayload() {
  return {
    ledgerDualWriteEnabled: true,
    operatingBranch: {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
    },
    accessibleBranches: [
      { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم' },
      { branchId: 3, branchCode: 'CAMP_CAESAR', branchName: 'كامب شيزار' },
    ],
    employees: [employeeRow],
    totals: {
      salaryCredits: 500,
      targetCredits: 0,
      fundingCredits: 0,
      advanceDebits: 0,
      payoutDebits: 0,
      deductionDebits: 0,
      balance: 1000,
      revenue: 0,
      payoutWithinDues: 0,
      revenueWithdrawal: 0,
      advanceExcess: 0,
    },
  };
}

function payoutButtons() {
  return screen.getAllByRole('button', { name: /صرف مستحقات/ });
}

describe('employee ledger dues settlement branch gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('employee-ledger/summary')) {
        return { ok: true, json: async () => summaryPayload() };
      }
      if (u.includes('/api/admin/hr/employee-ledger?')) {
        return { ok: true, json: async () => ({ entries: [], totalCredits: 0, totalDebits: 0, balance: 0 }) };
      }
      if (u.includes('/api/employees')) {
        return { ok: true, json: async () => [{ EmpID: 12, EmpName: 'أحمد' }] };
      }
      if (u.includes('/api/incomes/meta')) {
        return { ok: true, json: async () => ({ paymentMethods: [{ PaymentID: 2, PaymentMethod: 'نقدي' }] }) };
      }
      if (u.includes('employee-ledger/payout')) {
        return { ok: true, json: async () => ({ success: true, idempotentReplay: false }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('blocks all-branch and mismatched-branch settlement until the session branch is selected', async () => {
    render(<EmployeeLedgerPanel />);

    await waitFor(() => expect(screen.getByTestId('dues-settlement-branch-rule')).toHaveTextContent('متوقف'));
    expect(screen.getByTestId('dues-settlement-branch-rule')).toHaveTextContent('جليم');
    expect(screen.getByTestId('dues-settlement-branch-rule')).toHaveTextContent('الكل');

    await waitFor(() => expect(payoutButtons()).toHaveLength(2));
    for (const button of payoutButtons()) {
      expect(button).toBeDisabled();
    }

    fireEvent.click(screen.getByRole('button', { name: 'كامب شيزار' }));
    await waitFor(() => {
      expect(screen.getByTestId('dues-settlement-branch-rule')).toHaveTextContent('متوقف');
    });
    for (const button of payoutButtons()) {
      expect(button).toBeDisabled();
    }
    expect(payoutButtons()[1]).toHaveAttribute(
      'title',
      expect.stringContaining('ليس الفرع التشغيلي النشط'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'جليم' }));
    await waitFor(() => {
      expect(screen.getByTestId('dues-settlement-branch-rule').textContent ?? '').toMatch(/النشط فقط/);
    });
    const [gleemButton, campButton] = payoutButtons();
    expect(gleemButton).toBeEnabled();
    expect(campButton).toBeDisabled();

    fireEvent.click(gleemButton);
    expect(screen.getByText('الفرع التشغيلي النشط')).toBeInTheDocument();
    expect(screen.getByText(/على الفرع التشغيلي النشط \(جليم\) فقط/)).toBeInTheDocument();
    expect(screen.queryByText(/صرف هذا الصف متاح فقط/)).not.toBeInTheDocument();
  });
});

describe('EmployeePayoutModal posts the session branch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/incomes/meta')) {
        return { ok: true, json: async () => ({ paymentMethods: [{ PaymentID: 2, PaymentMethod: 'نقدي' }] }) };
      }
      if (u.includes('employee-ledger/payout')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('sends the operating branch id with the confirmed monthly amount', async () => {
    const onSuccess = vi.fn();
    render(
      <EmployeePayoutModal
        open
        onClose={() => {}}
        dualWriteEnabled
        onSuccess={onSuccess}
        employee={{
          empId: 12,
          empName: 'أحمد',
          payrollMonth: '2026-04',
          branchId: 1,
          branchLabel: 'جليم',
          monthBalance: 500,
        }}
      />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'طريقة الدفع' })).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'طريقة الدفع' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد صرف المستحقات' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const payoutCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      String(call[0]).includes('employee-ledger/payout'),
    );
    expect(payoutCall).toBeTruthy();
    const body = JSON.parse(String((payoutCall?.[1] as RequestInit).body));
    expect(body.confirmedLedgerBranchId).toBe(1);
    expect(body.branchId).toBeUndefined();
    expect(body.amount).toBe(500);
    expect(body.expectedBalance).toBe(500);
    expect(body.payrollMonth).toBe('2026-04');
  });
});
