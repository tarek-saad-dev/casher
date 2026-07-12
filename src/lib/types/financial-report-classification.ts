export interface ClassifiedTotals {
  salesRevenue: number;
  otherBusinessIncome: number;
  nonRevenueCashIn: number;
  legacyEmployeeIncomeMirror: number;
  operatingExpense: number;
  employeeAdvances: number;
  employeePayouts: number;
  payrollExpenseFromLedger: number;
  legacyPayrollExpense: number;
  internalTransfers: number;
  uncategorizedCashIn: number;
  uncategorizedCashOut: number;
  cashInTotal: number;
  cashOutTotal: number;
  cleanNetProfit: number;
}

export interface ClassificationBreakdownItem {
  bucket: string;
  label: string;
  amount: number;
  transactionCount: number;
}

export interface CashMoveReportClassification {
  bucket: string;
  label: string;
  isRealRevenue: boolean;
  isProfitExpense: boolean;
  isEmployeeLedgerRelated: boolean;
  isNonRevenueCashIn: boolean;
  treasuryLabel?: string;
}

export interface FinancialReportClassificationPayload {
  classificationEnabled: boolean;
  legacyTotals?: Record<string, number>;
  classifiedTotals?: ClassifiedTotals;
  classificationBreakdown?: ClassificationBreakdownItem[];
}

export interface PayrollExpenseFromLedgerResult {
  totalPayrollExpense: number;
  dailyHourlyTotal: number;
  monthlySalaryTotal: number;
  commissionBonusTotal: number;
  targetTotal: number;
  byEmployee: Array<{
    empId: number;
    empName: string;
    totalAmount: number;
    hourlyWageTotal: number;
    monthlySalaryTotal: number;
    commissionTotal: number;
    bonusTotal: number;
    targetTotal: number;
    entryCount: number;
  }>;
  byReason: Array<{
    entryReason: string;
    totalAmount: number;
    entryCount: number;
  }>;
}
