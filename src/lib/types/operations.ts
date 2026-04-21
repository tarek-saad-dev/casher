export interface OperationsAlert {
  type: 'error' | 'warning' | 'info';
  message: string;
}

export interface PaymentBreakdown {
  method: string;
  total: number;
  cnt: number;
}

export interface OpenShiftInfo {
  ID: number;
  UserID: number;
  UserName: string;
  ShiftID: number;
  ShiftName: string;
  StartDate: string;
  StartTime: string;
}

export interface DayInfo {
  ID: number;
  NewDay: string;
  Status: boolean;
}

export interface ShiftInfo {
  ID: number;
  NewDay: string;
  UserID: number;
  ShiftID: number;
  StartDate: string;
  StartTime: string;
  EndDate: string | null;
  EndTime: string | null;
  Status: boolean;
  UserName?: string;
  ShiftName?: string;
}

export interface ShiftSummaryData {
  shiftMoveID: number;
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: PaymentBreakdown[];
  cashIn: number;
  cashOut: number;
}

export interface DaySummaryData {
  dayID: number;
  date: string;
  shiftsCount: number;
  salesCount: number;
  totalRevenue: number;
  totalExpenses: number;
  paymentBreakdown: PaymentBreakdown[];
}

export interface UserDefaultShift {
  ShiftID: number;
  ShiftName: string;
}

export interface OperationsStatus {
  user: { UserID: number; UserName: string; UserLevel: string };
  day: DayInfo | null;
  shift: ShiftInfo | null;
  allOpenShifts: OpenShiftInfo[];
  shiftSummary: ShiftSummaryData | null;
  daySummary: DaySummaryData | null;
  userDefaultShift: UserDefaultShift | null;
  alerts: OperationsAlert[];
}

export interface ShiftDefinition {
  ShiftID: number;
  ShiftName: string;
}
