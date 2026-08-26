export type EmployeeMonthlyQuickReviewRow = {
  employeeId: number;
  employeeName: string;
  isActive: boolean;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  dailyWage: number | null;
  /** Target earned that day (day delta). */
  targetDay: number | null;
  /** Cumulative target from month start through this workDate. */
  targetMtd: number | null;
};

export type EmployeeMonthlyQuickReviewResponse = {
  /** Inclusive end date (today if current month, else month end). */
  asOfDate: string;
  year: number;
  month: number;
  rows: EmployeeMonthlyQuickReviewRow[];
  /** @deprecated alias of asOfDate */
  workDate?: string;
};
