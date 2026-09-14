import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';
import { roundMoney } from '@/lib/reportMonthUtils';
import { canEditAttendanceForWage } from '@/lib/reports/employeeMonthlyAttendanceFix';
import type { EmployeeMonthlySheetDayRow } from '@/lib/reports/employee-monthly-sheet.types';

const BLOCKED_AUTO_COMPLETE_STATUSES = new Set([
  'absent',
  'day_off',
  'excused',
  'future_scheduled',
]);

/** Pure: whether default-fill may run for this day (does not overwrite complete punches). */
export function canAutoCompleteAttendanceForSheetDay(
  day: Pick<
    EmployeeMonthlyPayrollDayRow,
    'isFutureDate' | 'statusCode' | 'checkIn' | 'checkOut' | 'isScheduledWorkDay' | 'isDayOff'
  >,
): boolean {
  if (day.isFutureDate) return false;
  if (BLOCKED_AUTO_COMPLETE_STATUSES.has(day.statusCode)) return false;
  if (day.isDayOff && !day.checkIn) return false;
  const missingIn = !day.checkIn;
  const missingOut = Boolean(day.checkIn && !day.checkOut);
  if (!missingIn && !missingOut) return false;
  return day.isScheduledWorkDay || missingOut || missingIn;
}

export function mapPayrollDayToSheetDay(
  day: EmployeeMonthlyPayrollDayRow,
  todayStr: string,
  revenueByDate: Map<string, number>,
): EmployeeMonthlySheetDayRow {
  const expensesRaw = roundMoney((day.deductions ?? 0) + (day.advances ?? 0));
  const revenueRaw = revenueByDate.get(day.date);
  const payrollExists = day.payrollStatus != null || day.baseWage != null;

  return {
    date: day.date,
    dayNumber: day.dayNumber,
    dayNameAr: day.dayNameAr,
    isFutureDate: day.isFutureDate,
    isDayOff: day.isDayOff,
    isToday: day.date === todayStr,
    isScheduledWorkDay: day.isScheduledWorkDay,
    attendance: {
      statusCode: day.statusCode,
      statusLabelAr: day.statusLabelAr,
      checkIn: day.checkIn,
      checkOut: day.checkOut,
      attendanceBranchId: day.attendanceBranchId,
    },
    dailyRevenue:
      day.isFutureDate || revenueRaw == null || revenueRaw === 0 ? null : roundMoney(revenueRaw),
    dailyExpenses: day.isFutureDate || expensesRaw === 0 ? null : expensesRaw,
    dailyPayroll: {
      exists: payrollExists,
      amount: day.baseWage,
      status: day.payrollStatus,
    },
    canAutoCompleteAttendance: canAutoCompleteAttendanceForSheetDay(day),
    canGeneratePayroll: !day.isFutureDate,
    canEditAttendance: canEditAttendanceForWage(day),
  };
}

export function sumSheetMoneyTotals(
  days: Array<{ dailyRevenue: number | null; dailyExpenses: number | null }>,
  employeeNet: number,
): { revenue: number; expenses: number; employeeNet: number } {
  let revenue = 0;
  let expenses = 0;
  for (const day of days) {
    if (day.dailyRevenue != null) revenue = roundMoney(revenue + day.dailyRevenue);
    if (day.dailyExpenses != null) expenses = roundMoney(expenses + day.dailyExpenses);
  }
  return { revenue, expenses, employeeNet };
}
