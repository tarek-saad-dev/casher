export type WageSourceSuggestion = 'TblEmpDailyPayroll' | 'LegacyCashMove' | 'NoneFound';

export interface DailyPayrollStatusBreakdown {
  status: string;
  rowCount: number;
  dailyWageTotal: number;
}

export interface DailyPayrollEmployeeBreakdown {
  empId: number;
  empName: string;
  rowCount: number;
  dailyWageTotal: number;
}

export interface DailyPayrollAuditSection {
  totalRowCount: number;
  dailyWageTotal: number;
  generatedStatusTotal: number;
  byStatus: DailyPayrollStatusBreakdown[];
  byEmployee: DailyPayrollEmployeeBreakdown[];
}

export interface CashWageExpenseRow {
  cashMoveId: number;
  invDate: string;
  amount: number;
  categoryName: string | null;
  empId: number | null;
  empName: string | null;
  notes: string | null;
  paymentMethod: string | null;
  isPayrollDeduction: boolean;
  matchReason: string;
}

export interface IncomeMirrorRow {
  cashMoveId: number;
  invDate: string;
  amount: number;
  categoryName: string | null;
  empId: number | null;
  empName: string | null;
  notes: string | null;
  paymentMethod: string | null;
  isEmployeePayrollIncome: boolean;
  mappedTxnKind: string | null;
  matchedExpenseCashMoveId: number | null;
  matchReason: string;
}

export interface LedgerSalaryCreditEmployeeTotal {
  empId: number;
  empName: string;
  hourlyWageTotal: number;
  monthlySalaryTotal: number;
  totalAmount: number;
  entryCount: number;
}

export interface LedgerSalaryCreditSection {
  totalAmount: number;
  entryCount: number;
  byEmployee: LedgerSalaryCreditEmployeeTotal[];
}

export interface EmployeeLedgerWageSourceAuditResponse {
  month: string;
  empId: number | null;
  readOnly: true;
  dailyPayrollGeneratedTotal: number;
  cashWageExpenseTotal: number;
  possibleIncomeMirrorTotal: number;
  ledgerSalaryCreditTotal: number;
  suggestedSource: WageSourceSuggestion;
  dailyPayroll: DailyPayrollAuditSection;
  cashWageExpenses: CashWageExpenseRow[];
  incomeMirrors: IncomeMirrorRow[];
  ledgerSalaryCredits: LedgerSalaryCreditSection;
}
