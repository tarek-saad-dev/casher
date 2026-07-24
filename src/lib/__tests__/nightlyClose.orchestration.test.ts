import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const finalizeIncompleteAttendanceAsDayOff = vi.fn();
const validateDailyPayrollAttendance = vi.fn();
const countPostedDailyPayroll = vi.fn();
const countEligibleDailyPayrollEmployees = vi.fn();
const runDailyPayrollGenerateWithOptionalLedger = vi.fn();
const generateEmployeeDailyTargets = vi.fn();
const buildEmployeeDailyWhatsAppPreview = vi.fn();
const sendEmployeeDailyWhatsAppReports = vi.fn();
const sendOwnerDailyWhatsApp = vi.fn();
const checkWhatsAppStatus = vi.fn();
const isWhatsAppEnabled = vi.fn();
const getPool = vi.fn();

vi.mock('@/lib/hr/finalize-incomplete-attendance', () => ({
  finalizeIncompleteAttendanceWithDefaults: (...args: unknown[]) =>
    finalizeIncompleteAttendanceAsDayOff(...args),
  finalizeIncompleteAttendanceAsDayOff: (...args: unknown[]) =>
    finalizeIncompleteAttendanceAsDayOff(...args),
}));

vi.mock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
  validateDailyPayrollAttendance: (...args: unknown[]) =>
    validateDailyPayrollAttendance(...args),
  countPostedDailyPayroll: (...args: unknown[]) => countPostedDailyPayroll(...args),
  countEligibleDailyPayrollEmployees: (...args: unknown[]) =>
    countEligibleDailyPayrollEmployees(...args),
}));

vi.mock('@/lib/services/employeeLedgerDualWrite', () => ({
  EmployeeLedgerDualWriteError: class EmployeeLedgerDualWriteError extends Error {},
  runDailyPayrollGenerateWithOptionalLedger: (...args: unknown[]) =>
    runDailyPayrollGenerateWithOptionalLedger(...args),
}));

vi.mock('@/lib/payroll/employee-target/employee-daily-target-generation.service', () => ({
  generateEmployeeDailyTargets: (...args: unknown[]) =>
    generateEmployeeDailyTargets(...args),
}));

vi.mock('@/lib/hr/employee-daily-whatsapp-report.service', () => ({
  buildEmployeeDailyWhatsAppPreview: (...args: unknown[]) =>
    buildEmployeeDailyWhatsAppPreview(...args),
  sendEmployeeDailyWhatsAppReports: (...args: unknown[]) =>
    sendEmployeeDailyWhatsAppReports(...args),
}));

vi.mock('@/lib/hr/owner-daily-whatsapp-report.service', () => ({
  sendOwnerDailyWhatsApp: (...args: unknown[]) => sendOwnerDailyWhatsApp(...args),
}));

vi.mock('@/lib/integrations/whatsapp', () => ({
  checkWhatsAppStatus: (...args: unknown[]) => checkWhatsAppStatus(...args),
  isWhatsAppEnabled: (...args: unknown[]) => isWhatsAppEnabled(...args),
}));

vi.mock('@/lib/db', () => ({
  getPool: (...args: unknown[]) => getPool(...args),
  sql: {
    Date: 'Date',
    Bit: 'Bit',
    Int: 'Int',
    Decimal: () => 'Decimal',
    NVarChar: Object.assign(() => 'NVarChar', { MAX: 'MAX' }),
  },
}));

const listActiveBranches = vi.fn();
vi.mock('@/lib/branch', () => ({
  listActiveBranches: (...args: unknown[]) => listActiveBranches(...args),
}));

describe('runNightlyClose orchestration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listActiveBranches.mockResolvedValue([
      { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم', isActive: true },
    ]);
    getPool.mockResolvedValue({
      request: () => ({
        input: function input() {
          return this;
        },
        query: async () => ({ recordset: [] }),
      }),
    });
    finalizeIncompleteAttendanceAsDayOff.mockResolvedValue({
      workDate: '2026-07-14',
      statusCode: 'D',
      action: 'DefaultFill',
      status: 'DefaultFill',
      filled: [
        {
          empId: 9,
          empName: 'ناقص',
          reason: 'missing_checkout',
          checkIn: '10:05',
          checkOut: '22:00',
          filledIn: false,
          filledOut: true,
          status: 'Present',
        },
      ],
      closed: [
        {
          empId: 9,
          empName: 'ناقص',
          reason: 'missing_checkout',
          checkIn: '10:05',
          checkOut: '22:00',
          filledIn: false,
          filledOut: true,
          status: 'Present',
        },
      ],
      skippedNoDefault: [],
      remainingMissing: [],
    });
    countPostedDailyPayroll.mockResolvedValue(0);
    countEligibleDailyPayrollEmployees.mockResolvedValue(5);
    validateDailyPayrollAttendance.mockResolvedValue({ missing: [], excluded: [] });
    runDailyPayrollGenerateWithOptionalLedger.mockResolvedValue({
      result: {
        workDate: '2026-07-14',
        generatedCount: 4,
        totalHours: 32,
        totalWage: 1000,
        newRows: 4,
      },
      ledgerDualWrite: true,
    });
    generateEmployeeDailyTargets.mockResolvedValue({
      totals: {
        generated: 3,
        recalculated: 1,
        totalTargetAmount: '250.00',
        eligibleEmployees: 3,
      },
    });
    isWhatsAppEnabled.mockReturnValue(true);
    checkWhatsAppStatus.mockResolvedValue({
      success: true,
      whatsappReady: true,
      chromeConnected: true,
      whatsappTabFound: true,
    });
    buildEmployeeDailyWhatsAppPreview.mockResolvedValue({
      summary: { readyToSend: 2, total: 5, skippedNoPhone: 0, skippedOther: 3 },
    });
    sendEmployeeDailyWhatsAppReports.mockResolvedValue({
      ok: true,
      workDate: '2026-07-14',
      dryRun: false,
      results: [],
      summary: { sent: 2, skipped: 3, failed: 0, dryRun: 0 },
    });
    sendOwnerDailyWhatsApp.mockResolvedValue({
      ok: true,
      workDate: '2026-07-14',
      dryRun: false,
      ownerName: 'طارق',
      phone: '01011112222',
      message: 'msg',
      status: 'sent',
    });
  });

  it('runs D → payroll → targets → employee WA → owner WA and verifies', async () => {
    const { runNightlyClose } = await import('@/lib/hr/nightly-close.service');
    const result = await runNightlyClose({ workDate: '2026-07-14' });

    expect(finalizeIncompleteAttendanceAsDayOff).toHaveBeenCalledWith('2026-07-14', {
      branchId: 1,
    });
    expect(runDailyPayrollGenerateWithOptionalLedger).toHaveBeenCalled();
    expect(generateEmployeeDailyTargets).toHaveBeenCalledWith({
      workDate: '2026-07-14',
      generatedByUserId: null,
    });
    expect(sendEmployeeDailyWhatsAppReports).toHaveBeenCalledWith({
      workDate: '2026-07-14',
      dryRun: false,
    });
    expect(sendOwnerDailyWhatsApp).toHaveBeenCalledWith({
      workDate: '2026-07-14',
      dryRun: false,
    });
    expect(result.ok).toBe(true);
    expect(result.delivery.ok).toBe(true);
    expect(result.delivery.employeesSent).toBe(2);
    expect(result.delivery.ownerSent).toBe(true);
    expect(result.steps.attendanceClose?.closed).toHaveLength(1);
  });

  it('fails delivery verification when owner send fails', async () => {
    sendOwnerDailyWhatsApp.mockResolvedValue({
      ok: false,
      workDate: '2026-07-14',
      dryRun: false,
      ownerName: 'طارق',
      phone: '01011112222',
      message: 'msg',
      status: 'failed',
      reason: 'bot_error',
    });

    const { runNightlyClose } = await import('@/lib/hr/nightly-close.service');
    const result = await runNightlyClose({ workDate: '2026-07-14' });
    expect(result.ok).toBe(false);
    expect(result.delivery.ok).toBe(false);
    expect(result.delivery.error).toMatch(/المدير/);
  });
});
