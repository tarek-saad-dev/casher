export type PayrollGapDayCategory =
  | 'ok'
  | 'future'
  | 'schedule_off'
  | 'schedule_off_with_payroll'
  | 'missing_payroll'
  | 'incomplete_attendance'
  | 'attendance_no_payroll'
  | 'no_attendance'
  | 'non_payable_no_payroll'
  | 'posted_payroll';

export interface PayrollGapDayRow {
  workDate: string;
  dayOfWeek: number;
  dayNameAr: string;
  isScheduledOff: boolean;
  hasAttendance: boolean;
  attendanceStatus: string | null;
  checkIn: string | null;
  checkOut: string | null;
  hasPayroll: boolean;
  payrollStatus: string | null;
  dailyWage: number | null;
  actualHours: number | null;
  dayCloseState: string | null;
  category: PayrollGapDayCategory;
  categoryLabelAr: string;
  actionable: boolean;
  suggestedActionAr: string | null;
}

export interface PayrollGapReviewSummary {
  totalDays: number;
  payrollDays: number;
  attendanceDays: number;
  missingPayroll: number;
  incompleteAttendance: number;
  scheduledOffDays: number;
  scheduledOffWithPayroll: number;
  futureDays: number;
  actionableDays: number;
}

export interface PayrollGapReviewResponse {
  empId: number;
  empName: string;
  branchId: number;
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  reviewThroughDate: string;
  /** Weekly off days from employee branch schedule (0=Sun … 6=Sat). */
  employeeOffDaysOfWeek: number[];
  employeeOffDayLabelsAr: string[];
  employeeOffDaysLabel: string;
  summary: PayrollGapReviewSummary;
  days: PayrollGapDayRow[];
}

export interface PayrollGapApplyOptions {
  /** Mark scheduled off days (from weekly schedule) as DayOff. */
  markScheduledOffAsDayOff?: boolean;
  /** Remove non-posted payroll on scheduled off days. */
  removeScheduledOffPayroll?: boolean;
  completeIncompleteAttendance?: boolean;
  generateMissingPayroll?: boolean;
  skipFutureDays?: boolean;
  reopenClosedDays?: boolean;
  defaultCheckoutTime?: string;
  notesPrefix?: string;
}

export interface PayrollGapApplyDayResult {
  workDate: string;
  action: string;
  success: boolean;
  message: string;
}

export interface PayrollGapGenerateDayResponse {
  workDate: string;
  success: boolean;
  message: string;
  actions: PayrollGapApplyDayResult[];
  review: PayrollGapReviewResponse;
}

export interface PayrollGapAssignAttendanceResponse {
  workDate: string;
  success: boolean;
  message: string;
  checkIn: string | null;
  checkOut: string | null;
  review: PayrollGapReviewResponse;
}

export interface PayrollGapApplyResponse {
  empId: number;
  branchId: number;
  year: number;
  month: number;
  summary: {
    scheduledOffMarked: number;
    scheduledOffPayrollRemoved: number;
    attendanceCompleted: number;
    payrollGenerated: number;
    payrollSkippedExisting: number;
    payrollSkippedPosted: number;
    daysReopened: number;
    daysReclosed: number;
    failures: string[];
  };
  dayResults: PayrollGapApplyDayResult[];
  review: PayrollGapReviewResponse;
}
