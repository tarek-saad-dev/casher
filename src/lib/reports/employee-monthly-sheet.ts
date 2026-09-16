import 'server-only';

import { getCairoTodayStr } from '@/lib/reports/dailyAttendanceStatus';
import { getEmployeeMonthlyPayrollReport } from '@/lib/reports/employee-monthly-payroll';
import { getEmployeeDailyNetServiceSalesMap } from '@/lib/payroll/employee-target/employee-target-sales-service';
import {
  mapPayrollDayToSheetDay,
  sumSheetMoneyTotals,
} from '@/lib/reports/employee-monthly-sheet.mappers';
import type {
  EmployeeMonthlySheetDayPatch,
  EmployeeMonthlySheetReport,
  GetEmployeeMonthlySheetDayParams,
  GetEmployeeMonthlySheetParams,
} from '@/lib/reports/employee-monthly-sheet.types';

export {
  canAutoCompleteAttendanceForSheetDay,
  mapPayrollDayToSheetDay,
  sumSheetMoneyTotals,
  displayedDayRevenue,
  patchSheetWithDay,
  resolveSheetDayBranchId,
  autoCompleteDisabledReason,
  generateDisabledReason,
  editAttendanceDisabledReason,
} from '@/lib/reports/employee-monthly-sheet.mappers';

export async function getEmployeeMonthlySheet(
  params: GetEmployeeMonthlySheetParams,
): Promise<EmployeeMonthlySheetReport | null> {
  const report = await getEmployeeMonthlyPayrollReport({
    employeeId: params.employeeId,
    year: params.year,
    month: params.month,
    branchId: params.branchId,
  });
  if (!report) return null;

  const revenueByDate = await getEmployeeDailyNetServiceSalesMap(
    report.period.startDate,
    report.period.endDate,
    params.branchId,
    params.employeeId,
  );

  const todayStr = getCairoTodayStr();
  const days = report.days.map((day) => mapPayrollDayToSheetDay(day, todayStr, revenueByDate));
  const totals = sumSheetMoneyTotals(days, report.summary.monthNet);

  return {
    employee: {
      id: report.employee.id,
      name: report.employee.name,
      job: report.employee.job,
      isActive: report.employee.isActive,
    },
    branch: report.branch,
    period: report.period,
    days,
    totals,
  };
}

/**
 * Reload one calendar day + authoritative monthNet after generate/fix.
 * Reuses the monthly composer (same formulas) without forcing a full UI remount.
 */
export async function getEmployeeMonthlySheetDay(
  params: GetEmployeeMonthlySheetDayParams,
): Promise<EmployeeMonthlySheetDayPatch | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.workDate)) {
    throw new Error('workDate يجب أن يكون بصيغة YYYY-MM-DD');
  }
  const [yearStr, monthStr] = params.workDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  const sheet = await getEmployeeMonthlySheet({
    employeeId: params.employeeId,
    year,
    month,
    branchId: params.branchId,
  });
  if (!sheet) return null;

  const day = sheet.days.find((d) => d.date === params.workDate);
  if (!day) return null;

  return {
    day,
    totals: sheet.totals,
  };
}
