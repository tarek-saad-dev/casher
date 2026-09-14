import { describe, expect, it } from 'vitest';
import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';
import {
  canAutoCompleteAttendanceForSheetDay,
  mapPayrollDayToSheetDay,
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
    targetAmount: null,
    mtdSales: null,
    mtdTargetAmount: null,
    targetBreakdown: [],
    targetPersistence: 'none',
    dayNet: 450,
    ...overrides,
  };
}

describe('employee-monthly-sheet mappers', () => {
  it('maps expenses as deductions + advances (ledger debits)', () => {
    const row = mapPayrollDayToSheetDay(
      baseDay({ deductions: 100, advances: 50 }),
      '2026-09-15',
      new Map(),
    );
    expect(row.dailyExpenses).toBe(150);
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

  it('keeps employeeNet independent of revenue − expenses', () => {
    const totals = sumSheetMoneyTotals(
      [
        { dailyRevenue: 2000, dailyExpenses: 150 },
        { dailyRevenue: 1000, dailyExpenses: null },
      ],
      777,
    );
    expect(totals.revenue).toBe(3000);
    expect(totals.expenses).toBe(150);
    expect(totals.employeeNet).toBe(777);
    expect(totals.employeeNet).not.toBe(totals.revenue - totals.expenses);
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
  });
});
