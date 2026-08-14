// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: { UserID: 1, UserName: 'admin', UserLevel: 'admin' },
  }),
}));

vi.mock('@/components/providers/PermissionsProvider', () => ({
  usePermissions: () => ({
    access: { isSuperAdmin: true, roles: ['admin'] },
    hasRole: (r: string) => r === 'admin',
  }),
}));

import DailyPayrollPanel from '@/components/hr/DailyPayrollPanel';

function closingCenterMocks(url: string) {
  if (url.includes('/api/branches/active')) {
    return {
      ok: true,
      json: async () => ({ activeBranch: { BranchID: 1, BranchCode: 'GLEEM', BranchName: 'جليم' } }),
    };
  }
  if (url.includes('/api/branches/available')) {
    return {
      ok: true,
      json: async () => ({
        branches: [
          {
            BranchID: 1,
            BranchCode: 'GLEEM',
            BranchName: 'جليم',
            ShortName: 'جليم',
            IsDefault: true,
            CanOperate: true,
            CanViewReports: true,
            CanSwitch: true,
            ValidTo: null,
          },
          {
            BranchID: 3,
            BranchCode: 'CAMP_CAESAR',
            BranchName: 'كامب شيزار',
            ShortName: 'كامب',
            IsDefault: false,
            CanOperate: true,
            CanViewReports: true,
            CanSwitch: true,
            ValidTo: null,
          },
        ],
      }),
    };
  }
  if (url.includes('/api/admin/hr/daily-payroll/open-days')) {
    expect(url).toContain('scope=current-month');
    return {
      ok: true,
      json: async () => ({
        items: [
          {
            branchId: 1,
            branchCode: 'GLEEM',
            branchName: 'جليم',
            workDate: '2026-07-12',
            persistedState: 'OPEN',
            recommendedState: 'NEEDS_REVIEW',
            readyToClose: false,
            blockerCount: 1,
            readyEmployeeCount: 0,
            employeeCount: 1,
            shortBlockerSummary: 'ناقص انصراف×1',
          },
        ],
        lookbackDays: 45,
        fromWorkDate: '2026-08-01',
        toWorkDate: null,
        elapsedMs: 10,
      }),
    };
  }
  if (url.includes('/api/admin/hr/daily-payroll/readiness')) {
    return {
      ok: true,
      json: async () => ({
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        workDate: '2026-07-12',
        persistedState: 'OPEN',
        isVirtualOpen: true,
        recommendedState: 'NEEDS_REVIEW',
        readyToClose: false,
        blockers: [
          {
            code: 'open_attendance_session',
            empId: 1,
            empName: 'محمد',
            message: 'جلسة حضور مفتوحة',
            fix: {
              type: 'attendance_modal',
              branchId: 1,
              workDate: '2026-07-12',
              employeeId: 1,
              targetUrl: '/admin/hr?tab=attendance&date=2026-07-12&branchId=1&empId=1',
              labelAr: 'تعديل الحضور',
            },
          },
        ],
        warnings: [{ code: 'monthly_excluded', empId: 3, empName: 'مريم', message: 'monthly_excluded' }],
        employees: [
          {
            empId: 1,
            empName: 'محمد',
            ready: false,
            blockers: ['open_attendance_session'],
            hasAttendance: true,
            hasOpenSession: true,
            payrollGenerated: false,
            targetGenerated: false,
            payrollLedgerOk: null,
            targetSyncStatus: 'none',
          },
        ],
        summary: {
          employeeCount: 1,
          readyEmployeeCount: 0,
          blockerCount: 1,
          warningCount: 1,
          payrollRowCount: 0,
          targetRowCount: 0,
          totalHours: 0,
          totalWage: 0,
          totalTargetAmount: 0,
          hasActivity: true,
        },
        closeAudit: null,
        elapsedMs: 12,
      }),
    };
  }
  if (url.includes('/api/auth/switch-branch')) {
    return { ok: true, json: async () => ({ ok: true, changed: false, activeBranch: { BranchID: 1 } }) };
  }
  return null;
}

function makeFetchMock(ledgerConfig: {
  ledgerDualWriteEnabled?: boolean;
  legacyPostToCashDisabled?: boolean;
  legacyPostToCashWarning?: string | null;
} = {}) {
  return vi.fn((url: string) => {
    const u = String(url);
    const closing = closingCenterMocks(u);
    if (closing) return Promise.resolve(closing);

    if (u.includes('validate-attendance')) {
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
    if (u.includes('employee-ledger/summary')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ledgerDualWriteEnabled: ledgerConfig.ledgerDualWriteEnabled ?? false,
          legacyPostToCashDisabled: ledgerConfig.legacyPostToCashDisabled ?? false,
          legacyPostToCashWarning: ledgerConfig.legacyPostToCashWarning ?? null,
        }),
      });
    }
    if (u.includes('/api/payroll/daily/post-to-cash')) {
      return Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          legacyPostToCashDisabled: true,
          message: 'تم إيقاف ترحيل اليوميات القديمة. استخدم دفتر الموظفين لصرف المستحقات.',
          redirectTab: 'employee-ledger',
        }),
      });
    }
  if (url.includes('/api/payroll/daily/auto-generate')) {
    return Promise.resolve({ ok: true, json: async () => ({ found: false }) });
  }
  if (url.includes('/api/payroll/daily/targets')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        employees: [],
        totals: null,
        planConflicts: [],
        sameDayMultiBranchEmployees: [],
      }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({
      rows: [{
        ID: 1,
        EmpID: 1,
        EmpName: 'محمد',
        BranchID: 1,
        BranchCode: 'GLEEM',
        BranchName: 'جليم',
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
    await waitFor(() => expect(screen.getByText('فحص الحضور')).toBeInTheDocument());
    fireEvent.click(screen.getByText('فحص الحضور'));
    await waitFor(() => {
      expect(screen.getByText('مستثنون من اليوميات (ليس خطأ)')).toBeInTheDocument();
      expect(screen.getByText('شهري — لا يدخل في اليوميات')).toBeInTheDocument();
    });
  });

  it('shows employment and payroll badges on payroll rows', async () => {
    render(<DailyPayrollPanel />);
    await waitFor(() => {
      expect(screen.getAllByText('دوام كامل').length).toBeGreaterThan(0);
      expect(screen.getAllByText('بالساعة').length).toBeGreaterThan(0);
    });
  });

  it('renders closing center strip and blockers from readiness API', async () => {
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByText('أيام تحتاج إقفال')).toBeInTheDocument());
    expect(screen.getByText('الأيام المفتوحة')).toBeInTheDocument();
    expect(screen.getByText('إدارة يوم محدد')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/موانع الإقفال/)).toBeInTheDocument());
    expect(screen.getByText(/جلسة حضور مفتوحة/)).toBeInTheDocument();
    expect(screen.getByText(/تنبيهات \(ليست موانع إقفال\)/)).toBeInTheDocument();
    expect(screen.getByText('الحالة')).toBeInTheDocument();
    expect(screen.queryByText('إقفال يوم الموظفين')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /حل المشاكل/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'فتح اليوم' })).toBeInTheDocument();
  });

  it('فتح اليوم transfers open-day into workspace without auto-select on load', async () => {
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'فتح اليوم' })).toBeInTheDocument());
    // Workspace boots on business date, not oldest open day
    const dateInput = screen.getByDisplayValue(/^\d{4}-\d{2}-\d{2}$/) as HTMLInputElement;
    expect(dateInput.value).not.toBe('2026-07-12');
    fireEvent.click(screen.getByRole('button', { name: 'فتح اليوم' }));
    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-07-12')).toBeInTheDocument();
    });
  });

  it('open-days failure does not block workspace actions', async () => {
    global.fetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/api/admin/hr/daily-payroll/open-days')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'open-days down' }),
        });
      }
      const closing = closingCenterMocks(u);
      if (closing) return Promise.resolve(closing);
      if (u.includes('employee-ledger/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ledgerDualWriteEnabled: false, legacyPostToCashDisabled: true }),
        });
      }
      if (u.includes('/api/payroll/daily/auto-generate')) {
        return Promise.resolve({ ok: true, json: async () => ({ found: false }) });
      }
      if (u.includes('/api/payroll/daily/targets')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ employees: [], totals: null, planConflicts: [] }),
        });
      }
      return Promise.resolve({
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
      });
    }) as unknown as typeof fetch;

    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByText(/open-days down|فشل تحميل الأيام المفتوحة/)).toBeInTheDocument());
    const validateBtn = screen.getByRole('button', { name: /فحص الحضور/ });
    expect(validateBtn).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /توليد اليوميات والتارجت/ })).not.toBeDisabled();
  });

  it('loads table with employeeScope=all by default without switch-branch', async () => {
    const fetchMock = makeFetchMock();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'كل الموظفين' })).toBeInTheDocument());
    await waitFor(() => {
      const payrollGets = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/api/payroll/daily?') && !String(c[0]).includes('targets'),
      );
      expect(payrollGets.some((c) => String(c[0]).includes('employeeScope=all'))).toBe(true);
    });
    const switchCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/auth/switch-branch'),
    );
    expect(switchCalls.length).toBe(0);
    await waitFor(() => expect(screen.getAllByText('جليم').length).toBeGreaterThan(0));
  });

  it('opens smart fix modal from حل المشاكل', async () => {
    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /حل المشاكل/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /حل المشاكل/ }));
    await waitFor(() => {
      expect(screen.getByText('حل المشاكل')).toBeInTheDocument();
      expect(screen.getByText(/المتبقي:/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'تعديل الحضور' })).toBeInTheDocument();
    });
  });

  it('nests salary_config_missing when generate returns backend missing reason', async () => {
    const base = makeFetchMock();
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/admin/hr/daily-payroll/readiness')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            branchId: 1,
            branchCode: 'GLEEM',
            branchName: 'جليم',
            workDate: '2026-07-12',
            persistedState: 'OPEN',
            isVirtualOpen: true,
            recommendedState: 'NEEDS_REVIEW',
            readyToClose: false,
            blockers: [
              {
                code: 'payroll_not_generated',
                empId: 1,
                empName: 'محمد',
                message: 'اليوميات غير مولّدة',
                fix: {
                  type: 'generate_payroll',
                  branchId: 1,
                  workDate: '2026-07-12',
                  employeeId: 1,
                  targetUrl: null,
                  labelAr: 'توليد اليوميات',
                },
              },
            ],
            warnings: [],
            employees: [
              {
                empId: 1,
                empName: 'محمد',
                ready: false,
                blockers: ['payroll_not_generated'],
                hasAttendance: true,
                hasOpenSession: false,
                payrollGenerated: false,
                targetGenerated: false,
                payrollLedgerOk: null,
                targetSyncStatus: 'none',
              },
            ],
            summary: {
              employeeCount: 1,
              readyEmployeeCount: 0,
              blockerCount: 1,
              warningCount: 0,
              payrollRowCount: 0,
              targetRowCount: 0,
              totalHours: 0,
              totalWage: 0,
              totalTargetAmount: 0,
              hasActivity: true,
            },
            closeAudit: null,
            elapsedMs: 5,
          }),
        });
      }
      if (u.includes('/api/payroll/daily/generate') && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({
            ok: false,
            error: 'برجاء إكمال بيانات الحضور والانصراف أولاً',
            code: 'SALARY_CONFIG_MISSING',
            missing: [{ empId: 1, empName: 'محمد', reason: 'no_hourly_rate' }],
          }),
        });
      }
      return base(u);
    }) as unknown as typeof fetch;

    render(<DailyPayrollPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: /حل المشاكل/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /حل المشاكل/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'توليد اليوميات' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'توليد اليوميات' }));
    await waitFor(() => {
      expect(screen.getAllByText(/سبب أعمق/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/إعدادات الراتب ناقصة للموظف/).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'ضبط إعدادات الراتب' })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('ترحيل قديم للخزنة')).toBeInTheDocument());
    fireEvent.click(screen.getByText('ترحيل قديم للخزنة'));
    await waitFor(() => expect(screen.getByText('تأكيد الترحيل القديم للخزنة')).toBeInTheDocument());
    fireEvent.click(screen.getByText('تأكيد الترحيل القديم للخزنة'));
    await waitFor(() => {
      expect(screen.getByText(/تم إيقاف ترحيل اليوميات القديمة/)).toBeInTheDocument();
    });
  });
});
