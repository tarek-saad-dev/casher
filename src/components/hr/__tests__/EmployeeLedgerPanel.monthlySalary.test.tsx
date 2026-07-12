// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmployeeLedgerPanel from '@/components/hr/EmployeeLedgerPanel';

describe('EmployeeLedgerPanel monthly salary posting', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn((url: string) => {
      if (url.includes('employee-ledger/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ledgerDualWriteEnabled: true,
            employees: [],
            totals: {
              salaryCredits: 0,
              targetCredits: 0,
              fundingCredits: 0,
              advanceDebits: 0,
              payoutDebits: 0,
              deductionDebits: 0,
              balance: 0,
            },
          }),
        });
      }
      if (url.includes('/api/admin/hr/employee-ledger?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ entries: [], month: '2026-07' }),
        });
      }
      if (url.includes('/api/employees')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{
            EmpID: 1032,
            EmpName: 'مريم',
            PayrollMethod: 'monthly',
            BaseSalary: 2000,
          }],
        });
      }
      if (url.includes('monthly-salary/post')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            dryRun: true,
            month: '2026-07',
            postingDate: '2026-07-31',
            totalAmount: 2000,
            counts: { eligible: 1, inserted: 1, updated: 0, alreadyPosted: 0, skipped: 0, errors: 0 },
            rows: [{ empId: 1032, empName: 'مريم', amount: 2000, status: 'new', existingLedgerEntryId: null, existingAmount: null, notes: '' }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('renders monthly salary post button', async () => {
    render(<EmployeeLedgerPanel />);
    await waitFor(() => {
      expect(screen.getByText('ترحيل الرواتب الشهرية للدفتر')).toBeInTheDocument();
    });
  });

  it('opens modal with no-cash warning and preview', async () => {
    render(<EmployeeLedgerPanel />);
    await waitFor(() => expect(screen.getByText('ترحيل الرواتب الشهرية للدفتر')).toBeInTheDocument());
    fireEvent.click(screen.getByText('ترحيل الرواتب الشهرية للدفتر'));
    await waitFor(() => {
      expect(screen.getByText(/لا ينشئ حركة خزنة/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('معاينة'));
    await waitFor(() => {
      expect(screen.getByText('مريم')).toBeInTheDocument();
      expect(screen.getByText('جديد')).toBeInTheDocument();
    });
  });
});
