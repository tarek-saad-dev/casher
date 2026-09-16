import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';
import { roundMoney } from '@/lib/reportMonthUtils';
import { canEditAttendanceForWage } from '@/lib/reports/employeeMonthlyAttendanceFix';
import type {
  EmployeeMonthlySheetDayRow,
  EmployeeMonthlySheetReport,
} from '@/lib/reports/employee-monthly-sheet.types';

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

export function resolveSheetDayBranchId(
  attendanceBranchId: number | null | undefined,
  sheetBranchId: number | null | undefined,
  sessionBranchId: number | null | undefined,
): number | null {
  if (attendanceBranchId != null && attendanceBranchId > 0) return attendanceBranchId;
  if (sheetBranchId != null && sheetBranchId > 0) return sheetBranchId;
  if (sessionBranchId != null && sessionBranchId > 0) return sessionBranchId;
  return null;
}

export function autoCompleteDisabledReason(
  day: Pick<
    EmployeeMonthlySheetDayRow,
    'isFutureDate' | 'canAutoCompleteAttendance' | 'attendance' | 'isDayOff'
  >,
  branchForDay: number | null,
): string | null {
  if (branchForDay == null) return 'لا يوجد فرع نشط لهذا اليوم';
  if (day.isFutureDate) return 'يوم مستقبلي — لا يمكن إكمال الحضور';
  if (day.canAutoCompleteAttendance) return null;
  if (day.attendance.statusCode === 'absent') return 'مسجّل غياب — استخدم التعديل اليدوي إن لزم';
  if (day.isDayOff || day.attendance.statusCode === 'day_off') {
    return 'يوم إجازة — لا يتم التعبئة التلقائية';
  }
  if (day.attendance.statusCode === 'excused') return 'حالة معذور — لا يتم التعبئة التلقائية';
  if (day.attendance.checkIn && day.attendance.checkOut) {
    return 'الحضور والانصراف مكتملان بالفعل';
  }
  return 'لا يمكن إكمال الحضور لهذا اليوم';
}

export function generateDisabledReason(
  day: Pick<EmployeeMonthlySheetDayRow, 'isFutureDate' | 'canGeneratePayroll'>,
  branchForDay: number | null,
): string | null {
  if (branchForDay == null) return 'لا يوجد فرع نشط لهذا اليوم';
  if (day.isFutureDate || !day.canGeneratePayroll) return 'يوم مستقبلي — لا يمكن توليد اليومية';
  return null;
}

export function editAttendanceDisabledReason(
  day: Pick<EmployeeMonthlySheetDayRow, 'canEditAttendance'>,
  branchForDay: number | null,
): string | null {
  if (branchForDay == null) return 'لا يوجد فرع نشط لهذا اليوم';
  if (!day.canEditAttendance) return 'لا يمكن تعديل الحضور لهذا اليوم';
  return null;
}

/**
 * Column «إيرادات اليوم»: dayNet when payroll exists, else allocated sales.
 * Matches HR day compensation once اليومية is generated.
 */
export function displayedDayRevenue(
  day: Pick<
    EmployeeMonthlySheetDayRow,
    'isFutureDate' | 'dailyPayroll' | 'dayNet' | 'dailyRevenue'
  >,
): number | null {
  if (day.isFutureDate) return null;
  if (day.dailyPayroll.exists) {
    return day.dayNet != null ? roundMoney(day.dayNet) : 0;
  }
  return day.dailyRevenue;
}

export function mapPayrollDayToSheetDay(
  day: EmployeeMonthlyPayrollDayRow,
  todayStr: string,
  revenueByDate: Map<string, number>,
): EmployeeMonthlySheetDayRow {
  const expensesRaw = roundMoney((day.deductions ?? 0) + (day.advances ?? 0));
  const revenueRaw = revenueByDate.get(day.date);
  const payrollExists = day.payrollStatus != null || day.baseWage != null;
  const canAutoCompleteAttendance = canAutoCompleteAttendanceForSheetDay(day);

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
      checkOutLabelAr: day.checkOutLabelAr,
      attendanceBranchId: day.attendanceBranchId,
      attendanceBranchCode: day.attendanceBranchCode,
      attendanceBranchName: day.attendanceBranchName,
    },
    dailyRevenue:
      day.isFutureDate || revenueRaw == null || revenueRaw === 0 ? null : roundMoney(revenueRaw),
    dailyExpenses: day.isFutureDate || expensesRaw === 0 ? null : expensesRaw,
    baseWage: day.isFutureDate ? null : day.baseWage,
    targetAmount: day.isFutureDate ? null : day.targetAmount,
    dayNet: day.isFutureDate ? null : roundMoney(day.dayNet),
    dailyPayroll: {
      exists: payrollExists,
      amount: day.baseWage,
      status: day.payrollStatus,
    },
    canAutoCompleteAttendance,
    canGeneratePayroll: !day.isFutureDate,
    canEditAttendance: canEditAttendanceForWage(day) || canAutoCompleteAttendance,
  };
}

export function sumSheetMoneyTotals(
  days: EmployeeMonthlySheetDayRow[],
  employeeNet: number,
): { revenue: number; expenses: number; employeeNet: number } {
  let revenue = 0;
  let expenses = 0;
  for (const day of days) {
    const shown = displayedDayRevenue(day);
    if (shown != null) revenue = roundMoney(revenue + shown);
    if (day.dailyExpenses != null) expenses = roundMoney(expenses + day.dailyExpenses);
  }
  return { revenue, expenses, employeeNet };
}

/** Patch one day into an existing sheet and recompute revenue/expenses from days; keep employeeNet from server. */
export function patchSheetWithDay(
  sheet: EmployeeMonthlySheetReport,
  nextDay: EmployeeMonthlySheetDayRow,
  employeeNet: number,
): EmployeeMonthlySheetReport {
  const days = sheet.days.map((d) => (d.date === nextDay.date ? nextDay : d));
  return {
    ...sheet,
    days,
    totals: sumSheetMoneyTotals(days, employeeNet),
  };
}
