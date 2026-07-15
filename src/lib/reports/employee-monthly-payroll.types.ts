import type { BadgeVariant, DailyAttendanceStatusCode } from '@/lib/reports/employee-monthly-work-revenue.types';
import { validateReportParams } from '@/lib/reports/employee-monthly-work-revenue.types';

export { validateReportParams };

export type BaseWageKind = 'hourly' | 'daily' | 'monthly' | 'none';

export interface EmployeeMonthlyPayrollDayRow {
  date: string;
  dayNameAr: string;
  dayNumber: number;
  isFutureDate: boolean;
  isScheduledWorkDay: boolean;
  isDayOff: boolean;

  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduledHours: number | null;

  checkIn: string | null;
  checkOut: string | null;
  checkOutLabelAr: string | null;
  breakMinutes: number;
  actualHours: number | null;
  statusCode: DailyAttendanceStatusCode;
  statusLabelAr: string;
  badgeVariant: BadgeVariant;
  lateMinutes: number;
  earlyLeaveMinutes: number;

  payrollMethod: BaseWageKind;
  hourlyRate: number | null;
  baseWage: number | null;
  fullDayBase: number | null;
  isPartialDay: boolean;
  /** Arabic note like: تم احتساب الأساسي 500 بدل 800 (5س من 8س) */
  baseWageNoteAr: string | null;
  payrollStatus: string | null;
  payrollNotes: string | null;

  deductions: number;
  advances: number;
  deductionNotes: string[];

  targetSales: number | null;
  targetAmount: number | null;
  targetPersistence: 'not_generated' | 'generated' | 'none';

  dayNet: number;
}

export interface EmployeeMonthlyPayrollReport {
  employee: {
    id: number;
    name: string;
    job: string | null;
    isActive: boolean;
    employmentType: string | null;
    payrollMethod: string | null;
    hourlyRate: number | null;
    dailyRate: number | null;
    baseSalary: number | null;
  };
  period: {
    year: number;
    month: number;
    monthLabelAr: string;
    startDate: string;
    endDate: string;
    timezone: 'Africa/Cairo';
  };
  summary: {
    calendarDays: number;
    scheduledDays: number;
    attendanceDays: number;
    absentDays: number;
    incompleteAttendanceDays: number;
    partialHourlyDays: number;
    totalActualHours: number;
    totalScheduledHours: number;
    totalBaseWage: number;
    totalFullDayBase: number;
    totalBaseShortfall: number;
    totalDeductions: number;
    totalAdvances: number;
    totalTargetAmount: number;
    totalTargetSales: number;
    monthNet: number;
  };
  days: EmployeeMonthlyPayrollDayRow[];
}

export interface GetEmployeeMonthlyPayrollParams {
  employeeId: number;
  year: number;
  month: number;
}
