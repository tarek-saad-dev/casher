import { describe, expect, it } from 'vitest';
import {
  composeEmployeeDailyWhatsAppMessage,
  shouldSkipEmptyDayOff,
} from '@/lib/hr/employee-daily-whatsapp-message';
import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';

function baseDay(overrides: Partial<EmployeeMonthlyPayrollDayRow> = {}): EmployeeMonthlyPayrollDayRow {
  return {
    date: '2026-07-06',
    dayNameAr: 'الأحد',
    dayNumber: 6,
    isFutureDate: false,
    isScheduledWorkDay: true,
    isDayOff: false,
    scheduledStart: '23:00',
    scheduledEnd: '11:00',
    scheduledHours: 12,
    checkIn: '23:34',
    checkOut: '11:00',
    checkOutLabelAr: null,
    breakMinutes: 0,
    actualHours: 9.5,
    statusCode: 'late',
    statusLabelAr: 'متأخر',
    badgeVariant: 'warning',
    lateMinutes: 34,
    earlyLeaveMinutes: 0,
    payrollMethod: 'hourly',
    hourlyRate: 22.5,
    baseWage: 213.75,
    fullDayBase: 270,
    isPartialDay: true,
    baseWageNoteAr: 'اتحاسب أساسي 213.75 بدل 270 (9.5س من 12س)',
    payrollStatus: 'Generated',
    payrollNotes: null,
    deductions: 0,
    advances: 0,
    deductionNotes: [],
    targetSales: 184.1,
    targetAmount: 0,
    targetPersistence: 'generated',
    dayNet: 213.75,
    ...overrides,
  };
}

describe('composeEmployeeDailyWhatsAppMessage', () => {
  it('includes partial-day note and ledger balance', () => {
    const msg = composeEmployeeDailyWhatsAppMessage({
      employeeName: 'زياد',
      branchName: 'جليم',
      workDate: '2026-07-06',
      dayNameAr: 'الأحد',
      day: baseDay(),
      ledgerBalance: 1850,
      invoiceCount: 7,
      serviceCount: 12,
      basicServiceCount: 9,
      otherServiceCount: 3,
    });

    expect(msg).toContain('تقرير يومك — جليم');
    expect(msg).toContain('يا زياد');
    expect(msg).toContain('اتحاسب أساسي');
    expect(msg).toContain('عدد الفواتير: 7');
    expect(msg).toContain('إجمالي الخدمات: 12');
    expect(msg).toContain('خدمات أساسية (شعر / دقن / شعر ودقن): 9');
    expect(msg).toContain('خدمات أخرى: 3');
    expect(msg).not.toContain('مبيعات:');
    expect(msg).toContain('رصيد حسابك حتى الآن');
    expect(msg).toMatch(/1[,.]850|١[,.\u066C]?٨٥٠/);
  });

  it('skips empty day off', () => {
    expect(
      shouldSkipEmptyDayOff(
        baseDay({
          isDayOff: true,
          checkIn: null,
          checkOut: null,
          baseWage: null,
          targetAmount: null,
          deductions: 0,
          advances: 0,
          dayNet: 0,
        }),
      ),
    ).toBe(true);
  });

  it('includes break intervals from-to for multiple periods', () => {
    const msg = composeEmployeeDailyWhatsAppMessage({
      employeeName: 'زياد',
      branchName: 'جليم',
      workDate: '2026-07-06',
      dayNameAr: 'الأحد',
      day: baseDay({ breakMinutes: 45 }),
      ledgerBalance: 1850,
      breakIntervals: [
        { LeaveAt: '14:00', ReturnAt: '14:30', Minutes: 30 },
        { LeaveAt: '17:00', ReturnAt: '17:15', Minutes: 15 },
      ],
    });

    expect(msg).toContain('مستقطع: 45 د');
    expect(msg).toContain('• من 2:00 م إلى 2:30 م');
    expect(msg).toContain('• من 5:00 م إلى 5:15 م');
  });
});
