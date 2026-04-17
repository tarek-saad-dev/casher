// ───────────────────────── Database Entities ─────────────────────────

export interface Customer {
  ClientID: number;
  Name: string;
  Mobile: string | null;
  BirthDate: string | null;
  RegisterDate: string | null;
}

export interface Barber {
  EmpID: number;
  EmpName: string;
}

export interface Service {
  ProID: number;
  ProName: string;
  SPrice1: number;
  Bonus: number;
  CatID: number | null;
  CatName: string | null;
  SalesCount: number;
}

export interface PaymentMethod {
  ID: number;
  Name: string;
}

export interface Shift {
  ID: number;
  Status: number;
  NewDay: string;
}

// ───────────────────────── POS Sale State ─────────────────────────

export interface CartItem {
  id: string;           // unique key for React (uuid-like)
  ProID: number;
  ProName: string;
  EmpID: number;
  EmpName: string;
  SPrice: number;
  Bonus: number;
  Qty: number;
  Dis: number;          // line discount %
  DisVal: number;       // line discount value
  SPriceAfterDis: number;
}

export interface SaleState {
  customer: Customer | null;
  barber: Barber | null;       // default barber for new items
  items: CartItem[];
  discountPercent: number;     // header-level discount %
  discountValue: number;       // header-level discount value
  paymentMethodId: number | null;
  notes: string;
  shiftMoveId: number | null;
}

export interface SaleTotals {
  totalQty: number;
  subTotal: number;
  discountValue: number;
  taxValue: number;
  grandTotal: number;
  totalBonus: number;
}

// ───────────────────────── Expense Entities ─────────────────────────

export interface ExpenseCategory {
  ExpINID: number;
  CatName: string;
}

export interface ExpenseRecord {
  ID: number;
  invID: number;
  invDate: string;
  invTime: string;
  ExpINID: number;
  CatName: string;
  GrandTolal: number;
  Notes: string | null;
  ShiftMoveID: number;
  PaymentMethodID: number;
  PaymentMethod: string | null;
  UserName: string | null;
}

export interface CreateExpensePayload {
  expINID: number;
  amount: number;
  paymentMethodId: number;
  notes: string;
}

// ───────────────────────── Budget Planner ─────────────────────────

export type BudgetLineType =
  | 'expense_category'
  | 'payroll'
  | 'utility'
  | 'subscription'
  | 'advance'
  | 'non_operating'
  | 'target'
  | 'other';

export type BudgetStatus = 'draft' | 'active' | 'closed';

export type BudgetLineGroup = 'operating' | 'payroll' | 'advances' | 'nonOperating';

export interface BudgetMonth {
  BudgetMonthID: number;
  Year: number;
  Month: number;
  TargetRevenue: number | null;
  TargetNetProfit: number | null;
  Status: BudgetStatus;
  Notes: string | null;
  CreatedByUserID: number | null;
  CreatedAt: string;
  UpdatedAt: string | null;
  // Computed aggregates (from list API)
  TotalPlanned?: number;
  TotalActualExpenses?: number;
  ActualRevenue?: number;
  ActualOtherIncome?: number;
  ApproxCurrentNet?: number;
  DerivedTargetRevenue?: number;
  AchievementPct?: number;
  LineCount?: number;
  OverBudgetCount?: number;
}

export interface BudgetMonthLine {
  ID: number;
  BudgetMonthID: number;
  LineType: BudgetLineType;
  ExpINID: number | null;
  EmpID: number | null;
  LineName: string;
  PlannedAmount: number;
  WarningThresholdPct: number | null;
  HardCapAmount: number | null;
  SortOrder: number | null;
  Notes: string | null;
  IsActive: boolean;
  // Computed from actuals
  ActualAmount?: number;
  Remaining?: number;
  BurnPct?: number;
  WarningState?: 'ok' | 'warning' | 'over';
  // Joined names
  CatName?: string | null;
  EmpName?: string | null;
  // UI group
  Group?: BudgetLineGroup;
}

// ── Dashboard response (GET /api/budget/[id]) ──

export interface BudgetBlocker {
  type: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  detail: string;
}

export interface BudgetGroupTotals {
  planned: number;
  actual: number;
  variance: number;
  lineCount: number;
}

export interface BudgetDashboard {
  // Header
  BudgetMonthID: number;
  Year: number;
  Month: number;
  TargetNetProfit: number;
  TargetRevenue: number | null;
  Status: BudgetStatus;
  Notes: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;

  // Derived targets
  TotalPlannedExpenses: number;
  DerivedTargetRevenue: number;

  // Actuals
  ActualRevenue: number;
  ActualExpenses: number;
  ActualOtherIncome: number;
  ApproxCurrentNet: number;
  RemainingToTarget: number;
  AchievementPct: number;

  // Daily metrics
  DaysInMonth: number;
  DaysElapsed: number;
  DaysRemaining: number;
  RequiredDailyRevenue: number;
  RequiredDailyNet: number;
  CurrentDailyRevenuePace: number;

  // Invoice metrics
  InvoiceCount: number;
  AverageInvoiceValue: number;
  HistAvgMonthlyRevenue: number;
  HistAvgDailyRevenue: number;
  HistAvgInvoiceValue: number;
  HistAvgMonthlyInvoices: number;

  // Lines & groups
  lines: BudgetMonthLine[];
  groupTotals: Record<BudgetLineGroup, BudgetGroupTotals>;
  OverBudgetCount: number;
  TopOverBudgetLine: string | null;

  // Blockers
  blockers: BudgetBlocker[];
}

// ── Historical baseline (GET /api/budget/historical) ──

export interface HistoricalCategoryBaseline {
  ExpINID: number;
  CatName: string;
  AvgMonthlyAmount: number;
  MonthsActive: number;
  SuggestedLineType: BudgetLineType;
  SuggestedGroup: BudgetLineGroup;
}

export interface HistoricalBaseline {
  avgMonthlySales: number;
  avgMonthlyExpenses: number;
  avgMonthlyOtherIncome: number;
  avgMonthlyNet: number;
  avgMonthlyInvoices: number;
  avgInvoiceValue: number;
  avgDailySales: number;
  categories: HistoricalCategoryBaseline[];
}

// ── Payloads ──

export interface CreateBudgetMonthPayload {
  year: number;
  month: number;
  targetNetProfit: number;
  notes: string;
}

export interface UpdateBudgetMonthPayload {
  targetNetProfit: number | null;
  status: BudgetStatus;
  notes: string;
}

export interface SaveBudgetLinePayload {
  lineType: BudgetLineType;
  expINID: number | null;
  empID: number | null;
  lineName: string;
  plannedAmount: number;
  warningThresholdPct: number | null;
  hardCapAmount: number | null;
  sortOrder: number | null;
  notes: string;
  isActive: boolean;
}

// ───────────────────────── Payroll Foundation ─────────────────────────

export interface EmpCompRule {
  ID: number;
  EmpID: number;
  EmpName?: string;
  BaseSalary: number;
  TargetThreshold: number | null;
  CommissionMode: string | null;
  CommissionValue: number | null;
  EffectiveFrom: string;
  EffectiveTo: string | null;
  IsActive: boolean;
  Notes: string | null;
}

export type PayrollTxnType = 'salary' | 'advance' | 'deduction' | 'commission' | 'bonus';

export interface EmpPayrollTxn {
  ID: number;
  EmpID: number;
  EmpName?: string;
  TxnYear: number;
  TxnMonth: number;
  TxnType: PayrollTxnType;
  Amount: number;
  CashMoveID: number | null;
  RefBudgetMonthID: number | null;
  Notes: string | null;
  CreatedByUserID: number | null;
  CreatedAt: string;
}

// ───────────────────────── API Payloads ─────────────────────────

export interface CreateSalePayload {
  clientId: number | null;
  items: {
    proId: number;
    empId: number;
    sPrice: number;
    bonus: number;
    qty: number;
    dis: number;
    disVal: number;
    sPriceAfterDis: number;
    notes: string;
  }[];
  subTotal: number;
  dis: number;
  disVal: number;
  grandTotal: number;
  totalBonus: number;
  totalQty: number;
  paymentMethodId: number | null;
  payCash: number;
  payVisa: number;
  notes: string;
}

export interface CreateSaleResult {
  invID: number;
  invType: string;
}

export interface SaleForPrint {
  invID: number;
  invType: string;
  invDate: string;
  invTime: string;
  customerName: string;
  customerPhone: string | null;
  subTotal: number;
  dis: number;
  disVal: number;
  grandTotal: number;
  paymentMethod: string | null;
  items: {
    proName: string;
    empName: string;
    sPrice: number;
    qty: number;
    sPriceAfterDis: number;
    bonus: number;
  }[];
}

// ───────────────────────── Reports: Monthly Expenses ─────────────────────────

export interface ExpenseTransaction {
  ID: number;
  invID: number;
  invDate: string;
  invTime: string;
  ExpINID: number;
  CatName: string;
  GrandTolal: number;
  Notes: string | null;
  ShiftMoveID: number | null;
  PaymentMethodID: number;
  PaymentMethod: string | null;
  UserName: string | null;
  needsCategorization?: boolean; // Flag for unclear/uncategorized expenses
}

export interface CategoryBreakdown {
  ExpINID: number;
  CatName: string;
  Amount: number;
  Count: number;
  AvgTransaction: number;
  Percentage: number;
}

export interface DailyTrend {
  invDate: string;
  Amount: number;
  Count: number;
}

export interface MonthlyExpensesSummary {
  totalExpenses: number;
  transactionCount: number;
  averageTransaction: number;
  avgDailyExpense: number;
  daysInMonth: number;
  uncategorizedCount: number;
  uncategorizedAmount: number;
  topCategory: {
    ExpINID: number;
    CatName: string;
    Amount: number;
    Percentage: number;
  } | null;
  highestSpendDay: {
    invDate: any;
    Amount: number;
    Count: number;
  } | null;
  topPaymentMethod: {
    PaymentMethodID: number;
    PaymentMethod: string;
    Amount: number;
    Percentage: number;
  } | null;
}

export interface RiskStatus {
  level: 'safe' | 'watch' | 'high' | 'critical';
  label: string;
  color: string;
  textColor: string;
  description: string;
}

export interface EmployeeAdvanceData {
  EmpID: number;
  EmpName: string;
  TotalAdvances: number;
  AdvanceCount: number;
  LatestAdvanceDate: string | null;
  TotalRevenue: number;
  SalesCount: number;
  Remaining: number;
  AdvancePercentage: number;
  RiskStatus: RiskStatus;
}

export interface ExpenseCategoryEmployeeMapping {
  ID: number;
  ExpINID: number;
  EmpID: number;
  TxnKind: 'advance' | 'deduction';
  IsActive: boolean;
  Notes: string | null;
  CreatedDate: string;
  ModifiedDate: string;
}

export interface MonthlyExpensesReport {
  summary: MonthlyExpensesSummary;
  categoryBreakdown: CategoryBreakdown[];
  dailyTrend: DailyTrend[];
  transactions: ExpenseTransaction[];
}
