// ──── Database row types (match HawaiDB exactly) ────

export interface DbUser {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
  loginName: string;
  Password: string;
  ShiftID: number;
  CardNO: string;
  isDeleted: boolean;
}

export interface ShiftDefinition {
  ShiftID: number;
  ShiftName: string;
}

export interface DbNewDay {
  ID: number;
  NewDay: string; // ISO date string
  Status: boolean; // true = open
}

export interface DbShiftMove {
  ID: number;
  NewDay: string;
  UserID: number;
  ShiftID: number;
  StartDate: string;
  StartTime: string;
  EndDate: string | null;
  EndTime: string | null;
  Status: boolean;
}

// ──── Session / client-facing types ────

export interface SessionUser {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
}

export interface BusinessDay {
  ID: number;
  NewDay: string;
  Status: boolean;
}

export interface ActiveShift {
  ID: number;
  NewDay: string;
  UserID: number;
  UserName?: string;
  ShiftID: number;
  ShiftName?: string;
  StartDate: string;
  StartTime: string;
  EndDate: string | null;
  EndTime: string | null;
  Status: boolean;
}

export interface OperationalSession {
  user: SessionUser | null;
  day: BusinessDay | null;
  shift: ActiveShift | null;
  permissions: string[];
}

// ──── Summary types ────

export interface PaymentBreakdownItem {
  method: string;
  total: number;
  count: number;
}

export interface ShiftSummary {
  shiftMoveID: number;
  userName: string;
  shiftName: string;
  startTime: string;
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: PaymentBreakdownItem[];
  cashIn: number;
  cashOut: number;
}

export interface DaySummaryShift {
  id: number;
  userName: string;
  shiftName: string;
  totalRevenue: number;
  salesCount: number;
}

export interface DaySummary {
  dayID: number;
  date: string;
  shiftsCount: number;
  shifts: DaySummaryShift[];
  totalRevenue: number;
  paymentBreakdown: PaymentBreakdownItem[];
}

// ──── Session cookie payload ────

export interface SessionPayload {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
  iat: number; // issued at (epoch seconds)
}
