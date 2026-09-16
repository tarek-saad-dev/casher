import { describe, expect, it } from 'vitest';
import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';
import type { EmployeeMonthlySheetReport } from '@/lib/reports/employee-monthly-sheet.types';
import {
  autoCompleteDisabledReason,
  canAutoCompleteAttendanceForSheetDay,
  displayedDayRevenue,
  editAttendanceDisabledReason,
  generateDisabledReason,
  mapPayrollDayToSheetDay,
  patchSheetWithDay,
  resolveSheetDayBranchId,
  sumSheetMoneyTotals,
} from '@/lib/reports/employee-monthly-sheet.mappers';

function baseDay(
  overrides: Partial<EmployeeMonthlyPayrollDayRow> = {},
): EmployeeMonthlyPayrollDayRow {
  return {
    date: '2026-09-01',
    dayNameAr: 'الإثنين',
    dayNumber: 1,
    isFutureDate: false,
    isScheduledWorkDay: true,
    isDayOff: false,
    scheduledStart: '11:00',
    scheduledEnd: '20:00',
    scheduledHours: 9,
    checkIn: '11:05',
    checkOut: '20:10',
    attendanceBranchId: 1,
    attendanceBranchCode: 'GLEEM',
    attendanceBranchName: 'جليم',
    checkOutLabelAr: null,
    breakMinutes: 0,
    actualHours: 9,
    statusCode: 'present',
    statusLabelAr: 'حاضر',
    badgeVariant: 'success',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    payrollMethod: 'hourly',
    hourlyRate: 50,
    baseWage: 450,
    fullDayBase: 450,
    isPartialDay: false,
    baseWageNoteAr: null,
    payrollStatus: 'Generated',
    payrollNotes: null,
    deductions: 0,
    advances: 0,
    deductionNotes: [],
    targetSales: null,
    targetAmount: 50,
    mtdSales: null,
    mtdTargetAmount: null,
    targetBreakdown: [],
    targetPersistence: 'generated',
    dayNet: 500,
    ...overrides,
  };
}

describe('employee-monthly-sheet mappers', () => {
  it('maps expenses as deductions + advances (ledger debits)', () => {
    const row = mapPayrollDayToSheetDay(
      baseDay({ deductions: 100, advances: 50, dayNet: 350 }),
      '2026-09-15',
      new Map(),
    );
    expect(row.dailyExpenses).toBe(150);
    expect(row.baseWage).toBe(450);
    expect(row.targetAmount).toBe(50);
    expect(row.dayNet).toBe(350);
  });

  it('maps allocated revenue from the sales map and leaves zero as null', () => {
    const withRev = mapPayrollDayToSheetDay(
      baseDay({ date: '2026-09-02', dayNumber: 2 }),
      '2026-09-15',
      new Map([['2026-09-02', 1980]]),
    );
    expect(withRev.dailyRevenue).toBe(1980);

    const zero = mapPayrollDayToSheetDay(baseDay(), '2026-09-15', new Map([['2026-09-01', 0]]));
    expect(zero.dailyRevenue).toBeNull();
  });

  it('shows dayNet in إيرادات اليوم when payroll exists, else sales', () => {
    const withPayroll = mapPayrollDayToSheetDay(
      baseDay({ dayNet: 500 }),
      '2026-09-15',
      new Map([['2026-09-01', 1980]]),
    );
    expect(withPayroll.dailyPayroll.exists).toBe(true);
    expect(displayedDayRevenue(withPayroll)).toBe(500);

    const noPayroll = mapPayrollDayToSheetDay(
      baseDay({
        payrollStatus: null,
        baseWage: null,
        dayNet: 0,
        targetAmount: null,
      }),
      '2026-09-15',
      new Map([['2026-09-01', 1980]]),
    );
    expect(noPayroll.dailyPayroll.exists).toBe(false);
    expect(displayedDayRevenue(noPayroll)).toBe(1980);
  });

  it('passes checkOutLabelAr and branch metadata through', () => {
    const row = mapPayrollDayToSheetDay(
      baseDay({
        checkOut: null,
        checkOutLabelAr: 'لم يسجل انصراف',
        statusCode: 'incomplete_checkout',
        attendanceBranchCode: 'CAMP_CAESAR',
        attendanceBranchName: 'كامب شيزار',
        attendanceBranchId: 3,
      }),
      '2026-09-15',
      new Map(),
    );
    expect(row.attendance.checkOutLabelAr).toBe('لم يسجل انصراف');
    expect(row.attendance.attendanceBranchCode).toBe('CAMP_CAESAR');
    expect(row.attendance.attendanceBranchId).toBe(3);
  });

  it('keeps employeeNet independent of revenue − expenses', () => {
    const days = [
      mapPayrollDayToSheetDay(baseDay({ dayNet: 2000 }), '2026-09-15', new Map()),
      mapPayrollDayToSheetDay(
        baseDay({
          date: '2026-09-02',
          dayNumber: 2,
          dayNet: 1000,
          deductions: 0,
          advances: 0,
        }),
        '2026-09-15',
        new Map(),
      ),
    ];
    days[0] = { ...days[0], dailyExpenses: 150 };
    const totals = sumSheetMoneyTotals(days, 777);
    expect(totals.revenue).toBe(3000);
    expect(totals.expenses).toBe(150);
    expect(totals.employeeNet).toBe(777);
    expect(totals.employeeNet).not.toBe(totals.revenue - totals.expenses);
  });

  it('patches one day without dropping the rest of the sheet', () => {
    const d1 = mapPayrollDayToSheetDay(baseDay({ dayNet: 100 }), '2026-09-15', new Map());
    const d2 = mapPayrollDayToSheetDay(
      baseDay({ date: '2026-09-02', dayNumber: 2, dayNet: 200 }),
      '2026-09-15',
      new Map(),
    );
    const sheet: EmployeeMonthlySheetReport = {
      employee: { id: 1, name: 'أ', job: null, isActive: true },
      branch: { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم' },
      period: {
        year: 2026,
        month: 9,
        monthLabelAr: 'سبتمبر 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        timezone: 'Africa/Cairo',
      },
      days: [d1, d2],
      totals: sumSheetMoneyTotals([d1, d2], 50),
    };
    const next = mapPayrollDayToSheetDay(
      baseDay({ dayNet: 900, baseWage: 850, targetAmount: 50 }),
      '2026-09-15',
      new Map([['2026-09-01', 300]]),
    );
    const patched = patchSheetWithDay(sheet, next, 999);
    expect(patched.days).toHaveLength(2);
    expect(patched.days[0].dayNet).toBe(900);
    expect(patched.days[1].dayNet).toBe(200);
    expect(patched.totals.revenue).toBe(1100);
    expect(patched.totals.employeeNet).toBe(999);
    expect(displayedDayRevenue(patched.days[0])).toBe(900);
  });

  it('flags payroll exists from status or base wage', () => {
    expect(mapPayrollDayToSheetDay(baseDay(), '2026-09-15', new Map()).dailyPayroll.exists).toBe(
      true,
    );
    expect(
      mapPayrollDayToSheetDay(
        baseDay({ payrollStatus: null, baseWage: null }),
        '2026-09-15',
        new Map(),
      ).dailyPayroll.exists,
    ).toBe(false);
  });

  it('allows auto-complete only for incomplete non-blocked days', () => {
    expect(
      canAutoCompleteAttendanceForSheetDay(
        baseDay({ checkIn: '11:00', checkOut: null, statusCode: 'incomplete_checkout' }),
      ),
    ).toBe(true);

    expect(
      canAutoCompleteAttendanceForSheetDay(
        baseDay({ checkIn: null, checkOut: null, statusCode: 'no_attendance_record' }),
      ),
    ).toBe(true);

    expect(canAutoCompleteAttendanceForSheetDay(baseDay())).toBe(false);
    expect(
      canAutoCompleteAttendanceForSheetDay(baseDay({ statusCode: 'absent', checkIn: null })),
    ).toBe(false);
    expect(
      canAutoCompleteAttendanceForSheetDay(
        baseDay({ isFutureDate: true, checkIn: null, checkOut: null }),
      ),
    ).toBe(false);
    expect(
      canAutoCompleteAttendanceForSheetDay(
        baseDay({ isDayOff: true, isScheduledWorkDay: false, checkIn: null, statusCode: 'day_off' }),
      ),
    ).toBe(false);
  });

  it('enables manual edit whenever auto-complete is allowed', () => {
    const incomplete = mapPayrollDayToSheetDay(
      baseDay({
        checkIn: '11:00',
        checkOut: null,
        statusCode: 'incomplete_checkout',
        baseWage: null,
        payrollStatus: null,
      }),
      '2026-09-15',
      new Map(),
    );
    expect(incomplete.canAutoCompleteAttendance).toBe(true);
    expect(incomplete.canEditAttendance).toBe(true);

    const unscheduled = mapPayrollDayToSheetDay(
      baseDay({
        checkIn: null,
        checkOut: null,
        isScheduledWorkDay: false,
        statusCode: 'unscheduled',
        baseWage: null,
        payrollStatus: null,
      }),
      '2026-09-15',
      new Map(),
    );
    expect(unscheduled.canAutoCompleteAttendance).toBe(true);
    expect(unscheduled.canEditAttendance).toBe(true);
  });

  it('resolves branch id without treating 0 as valid', () => {
    expect(resolveSheetDayBranchId(null, 0, 2)).toBe(2);
    expect(resolveSheetDayBranchId(5, 1, 2)).toBe(5);
    expect(resolveSheetDayBranchId(null, null, null)).toBeNull();
  });

  it('explains disabled action reasons in Arabic', () => {
    const complete = mapPayrollDayToSheetDay(baseDay(), '2026-09-15', new Map());
    expect(autoCompleteDisabledReason(complete, 1)).toMatch(/مكتمل/);
    expect(generateDisabledReason(complete, 1)).toBeNull();
    expect(editAttendanceDisabledReason(complete, null)).toMatch(/فرع/);

    const future = mapPayrollDayToSheetDay(
      baseDay({ date: '2026-09-20', isFutureDate: true, checkIn: null, checkOut: null }),
      '2026-09-15',
      new Map(),
    );
    expect(autoCompleteDisabledReason(future, 1)).toMatch(/مستقبلي/);
    expect(generateDisabledReason(future, 1)).toMatch(/مستقبلي/);
  });

  it('marks today and mutes future generate', () => {
    const today = mapPayrollDayToSheetDay(baseDay({ date: '2026-09-15' }), '2026-09-15', new Map());
    expect(today.isToday).toBe(true);

    const future = mapPayrollDayToSheetDay(
      baseDay({ date: '2026-09-20', isFutureDate: true }),
      '2026-09-15',
      new Map([['2026-09-20', 500]]),
    );
    expect(future.canGeneratePayroll).toBe(false);
    expect(future.dailyRevenue).toBeNull();
    expect(displayedDayRevenue(future)).toBeNull();
  });
});
