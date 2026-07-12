// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DailyPayrollPanel from '@/components/hr/DailyPayrollPanel';

function makeFetchMock(ledgerConfig: {
  ledgerDualWriteEnabled?: boolean;
  legacyPostToCashDisabled?: boolean;
  legacyPostToCashWarning?: string | null;
} = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('validate-attendance')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          missing: [],
          excluded: [{ empId: 3, empName: 'مريم', reason: 'monthly_excluded' }],
          alreadyPostedCount: 0,
          generatedExists: false,
        }),
      });
    }
    if (url.includes('employee-ledger/summary')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ledgerDualWriteEnabled: ledgerConfig.ledgerDualWriteEnabled ?? false,
          legacyPostToCashDisabled: ledgerConfig.legacyPostToCashDisabled ?? false,
          legacyPostToCashWarning: ledgerConfig.legacyPostToCashWarning ?? null,
        }),
      });
    }
    if (url.includes('/api/payroll/daily/post-to-cash')) {
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          legacyPostToCashDisabled: true,
          message: 'تم إيقاف ترحيل اليوميات القديم. استخدم دفتر الموظفين لصرف المستحقات.',
          redirectTab: 'employee-ledger',
        }),
      });
    }
    if (url.includes('/api/payroll/daily/auto-generate')) {
      return Promise.resolve({ ok: true, json: async () => ({ found: false }) });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({
        rows: [{
          ID: 1,
          EmpID: 1,
          EmpName: 'محمد',
          EmploymentType: 'full_time',
          PayrollMethod: 'hourly',
          HourlyRateSnapshot: 50,
          DailyRate: null,
          WorkDate: '2026-07-12',
          ActualHours: 8,
          AttendanceStatus: 'Present',
          DailyWage: 400,
          Status: 'Generated',
          CashMoveID: null,
          EmployeeIncomeCashMoveID: null,
          Notes: 'بالساعة: 50 x 8h | Present',
          CheckInTime: '09:00',
          CheckOutTime: '17:00',
          LateMinutes: 0,
          RevenueExpINID: 1,
          RevenueCatName: 'إيراد',
          needsIncomeRepair: false,
        }],
        summary: {
          total: 1,
          totalWage: 400,
          totalHours: 8,
          postedCount: 0,
          generatedCount: 1,
          earnedCount: 1,
          repairCount: 0,
          totalExpenseAmount: 0,
          totalEmployeeIncomeAmount: 0,
        },
        missingMappingEmps: [],
      }),
    });
  }) as unknown as typeof fetch;
}

describe('DailyPayrollPanel HR labels', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = makeFetchMock();
  });

  afterEach(() => cleanup());

  it('shows monthly excluded in validation excluded list', async () => {
    render(<DailyPayrollPanel />);
    fireEvent.click(screen.getByText('فحص الحضور'));
    await waitFor(() => {
      expect(screen.getByText('مستثنون من اليوميات (ليس خطأ)')).toBeInTheDocument();
      expect(screen.getByText('شهري — لا يدخل في اليوميات')).toBeInTheDocument();
    });
  });

  it('shows employment and payroll badges on payroll rows', async () => {
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByText('تحميل البيانات')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تحميل البيانات'));
    await waitFor(() => {
      expect(screen.getAllByText('دوام كامل').length).toBeGreaterThan(0);
      expect(screen.getAllByText('بالساعة').length).toBeGreaterThan(0);
    });
  });
});

describe('DailyPayrollPanel legacy post-to-cash (Phase 4C)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => cleanup());

  it('hides post button and shows banner when legacy post-to-cash disabled', async () => {
    global.fetch = makeFetchMock({
      ledgerDualWriteEnabled: true,
      legacyPostToCashDisabled: true,
    });
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByText('تحميل البيانات')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تحميل البيانات'));
    await waitFor(() => {
      expect(screen.getByText(/تم إيقاف الترحيل القديم/)).toBeInTheDocument();
      expect(screen.getByText('فتح دفتر الموظفين')).toBeInTheDocument();
    });
    expect(screen.queryByText('ترحيل للخزنة')).not.toBeInTheDocument();
    expect(screen.queryByText('ترحيل قديم للخزنة')).not.toBeInTheDocument();
    const ledgerLink = screen.getByText('فتح دفتر الموظفين').closest('a');
    expect(ledgerLink?.getAttribute('href')).toBe('/admin/hr?tab=employee-ledger');
  });

  it('shows legacy warning when dual-write enabled but legacy still allowed', async () => {
    global.fetch = makeFetchMock({
      ledgerDualWriteEnabled: true,
      legacyPostToCashDisabled: false,
      legacyPostToCashWarning: 'تحذير: هذا الترحيل قد يضخم الإيرادات والمصروفات.',
    });
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByText('تحميل البيانات')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تحميل البيانات'));
    await waitFor(() => {
      expect(screen.getByText('ترحيل قديم للخزنة')).toBeInTheDocument();
      expect(screen.getByText(/تحذير: هذا الترحيل قد يضخم/)).toBeInTheDocument();
    });
  });

  it('displays API rejection message when post-to-cash is blocked', async () => {
    global.fetch = makeFetchMock({
      ledgerDualWriteEnabled: true,
      legacyPostToCashDisabled: false,
    });
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByText('تحميل البيانات')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تحميل البيانات'));
    await waitFor(() => expect(screen.getByText('ترحيل قديم للخزنة')).toBeInTheDocument());
    fireEvent.click(screen.getByText('ترحيل قديم للخزنة'));
    await waitFor(() => expect(screen.getByText('تأكيد الترحيل القديم للخزنة')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تأكيد الترحيل القديم للخزنة'));
    await waitFor(() => {
      expect(screen.getByText(/تم إيقاف ترحيل اليوميات القديم/)).toBeInTheDocument();
    });
  });
});
