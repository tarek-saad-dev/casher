import type { DailyAttendanceStatusCode } from '@/lib/reports/employee-monthly-work-revenue.types';
import { validateReportParams } from '@/lib/reports/employee-monthly-work-revenue.types';

export { validateReportParams };

export interface EmployeeMonthlySheetDayAttendance {
  statusCode: DailyAttendanceStatusCode;
  statusLabelAr: string;
  checkIn: string | null;
  checkOut: string | null;
  checkOutLabelAr: string | null;
  attendanceBranchId: number | null;
  attendanceBranchCode: string | null;
  attendanceBranchName: string | null;
}

export interface EmployeeMonthlySheetDayPayroll {
  exists: boolean;
  amount: number | null;
  status: string | null;
}

export interface EmployeeMonthlySheetDayRow {
  date: string;
  dayNumber: number;
  dayNameAr: string;
  isFutureDate: boolean;
  isDayOff: boolean;
  isToday: boolean;
  isScheduledWorkDay: boolean;
  attendance: EmployeeMonthlySheetDayAttendance;
  /** Allocated invoice sales (netSalesAfterDiscount) for the day. */
  dailyRevenue: number | null;
  /** Ledger debits (advances + deductions) for the day. */
  dailyExpenses: number | null;
  /** Base wage from daily payroll / recomputed hours. */
  baseWage: number | null;
  /** Daily target commission amount. */
  targetAmount: number | null;
  /** Authoritative day compensation: base + target − advances − deductions. */
  dayNet: number | null;
  dailyPayroll: EmployeeMonthlySheetDayPayroll;
  canAutoCompleteAttendance: boolean;
  canGeneratePayroll: boolean;
  canEditAttendance: boolean;
}

export interface EmployeeMonthlySheetReport {
  employee: {
    id: number;
    name: string;
    job: string | null;
    isActive: boolean;
  };
  branch: {
    branchId: number;
    branchCode: string;
    branchName: string;
  };
  period: {
    year: number;
    month: number;
    monthLabelAr: string;
    startDate: string;
    endDate: string;
    timezone: 'Africa/Cairo';
  };
  days: EmployeeMonthlySheetDayRow[];
  totals: {
    revenue: number;
    expenses: number;
    employeeNet: number;
  };
}

export interface EmployeeMonthlySheetDayPatch {
  day: EmployeeMonthlySheetDayRow;
  totals: {
    revenue: number;
    expenses: number;
    employeeNet: number;
  };
}

export interface GetEmployeeMonthlySheetParams {
  employeeId: number;
  year: number;
  month: number;
  branchId: number;
}

export interface GetEmployeeMonthlySheetDayParams {
  employeeId: number;
  workDate: string;
  branchId: number;
}
