import { describe, expect, it } from 'vitest';
import {
  canEditAttendanceForWage,
  needsAttendanceWageReview,
} from '@/lib/reports/employeeMonthlyAttendanceFix';
import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';

function day(partial: Partial<EmployeeMonthlyPayrollDayRow>): EmployeeMonthlyPayrollDayRow {
  return {
    date: '2026-08-10',
    dayNameAr: 'الإثنين',
    dayNumber: 10,
    isFutureDate: false,
    isScheduledWorkDay: true,
    isDayOff: false,
    scheduledStart: '09:00',
    scheduledEnd: '17:00',
    scheduledHours: 8,
    checkIn: null,
    checkOut: null,
    attendanceBranchId: null,
    attendanceBranchCode: null,
    attendanceBranchName: null,
    checkOutLabelAr: null,
    breakMinutes: 0,
    actualHours: null,
    statusCode: 'no_attendance_record',
    statusLabelAr: 'لم يسجل حضور',
    badgeVariant: 'info',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    payrollMethod: 'hourly',
    hourlyRate: 50,
    baseWage: null,
    fullDayBase: 400,
    isPartialDay: false,
    baseWageNoteAr: null,
    payrollStatus: null,
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
    dayNet: 0,
    ...partial,
  };
}

describe('monthly report attendance wage helpers', () => {
  it('allows editing attendance on work days and flags missing checkout', () => {
    expect(canEditAttendanceForWage(day({}))).toBe(true);
    expect(canEditAttendanceForWage(day({ isFutureDate: true }))).toBe(false);

    const incomplete = day({
      checkIn: '10:00',
      checkOut: null,
      statusCode: 'incomplete_checkout',
      isPartialDay: false,
    });
    expect(needsAttendanceWageReview(incomplete)).toBe(true);

    const partial = day({
      checkIn: '10:00',
      checkOut: '14:00',
      actualHours: 4,
      baseWage: 200,
      isPartialDay: true,
    });
    expect(needsAttendanceWageReview(partial)).toBe(true);

    const ok = day({
      checkIn: '09:00',
      checkOut: '17:00',
      actualHours: 8,
      baseWage: 400,
      statusCode: 'present',
      isPartialDay: false,
    });
    expect(needsAttendanceWageReview(ok)).toBe(false);
    expect(canEditAttendanceForWage(ok)).toBe(true);
  });
});
