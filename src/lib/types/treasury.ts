/**
 * Treasury / Daily Closing Types
 * For end-of-day treasury management and reconciliation
 */

export interface TreasurySummary {
  totalInflow: number;
  totalOutflow: number;
  grandNet: number;
  cashNet: number;
  transactionCount: number;
  topPaymentMethod: string | null;
}

export interface PaymentMethodBreakdown {
  paymentMethodId: number;
  paymentMethodName: string;
  inflow: number;
  outflow: number;
  net: number;
  transactionCount: number;
  percentageOfTotal: number;
  salesInflow: number;
  incomeInflow: number;
}

export interface TreasuryFilters {
  newDay: number | null;
  dayDate: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  shiftMoveId: number | null;
  shiftName: string | null;
  userId: number | null;
  userName: string | null;
}

export interface DailyTreasuryData {
  summary: TreasurySummary;
  paymentMethods: PaymentMethodBreakdown[];
  filters: TreasuryFilters;
}

export interface TreasuryMovement {
  id: number;
  invId: number;
  invType: string;
  invDate: string;
  invTime: string;
  paymentMethodId: number;
  paymentMethodName: string;
  inOut: 'in' | 'out';
  amount: number;
  shiftMoveId: number | null;
  shiftName: string | null;
  userId: number | null;
  userName: string | null;
  notes: string | null;
}

export interface TreasuryMovementsResponse {
  movements: TreasuryMovement[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface CurrentDayShift {
  currentDay: {
    newDay: number;
    dayDate: string;
    isOpen: boolean;
  } | null;
  currentShift: {
    shiftMoveId: number;
    shiftName: string;
    userName: string;
    startDate: string;
  } | null;
}

export interface ReconciliationInput {
  paymentMethodId: number;
  systemAmount: number;
  countedAmount: number;
  notes?: string;
}

export interface ReconciliationRequest {
  newDay: number;
  shiftMoveId?: number;
  reconciliations: ReconciliationInput[];
}

export type VarianceStatus = 'acceptable' | 'warning' | 'critical';

export interface ReconciliationVariance {
  paymentMethodId: number;
  paymentMethodName: string;
  variance: number;
  variancePercentage: number;
  status: VarianceStatus;
}

export interface ReconciliationResponse {
  success: boolean;
  reconciliationIds: number[];
  variances: ReconciliationVariance[];
  message: string;
}

export interface ReconciliationRecord {
  id: number;
  newDay: number;
  dayDate: string;
  shiftMoveId: number | null;
  shiftName: string | null;
  paymentMethodId: number;
  paymentMethodName: string;
  systemAmount: number;
  countedAmount: number;
  varianceAmount: number;
  variancePercentage: number;
  status: VarianceStatus;
  notes: string | null;
  closedByUserId: number;
  closedByUserName: string;
  closedAt: string;
}

export interface ReconciliationHistoryResponse {
  reconciliations: ReconciliationRecord[];
}

export interface DayOption {
  newDay: number;
  dayDate: string;
  label: string;
  isOpen: boolean;
}

export interface ShiftOption {
  shiftMoveId: number;
  shiftName: string;
  userName: string;
  label: string;
}

export interface UserOption {
  userId: number;
  userName: string;
}
