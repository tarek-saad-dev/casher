export type AdvanceIssueReason =
  | 'missing_employee_mapping'
  | 'no_emp_id'
  | 'ledger_entry_missing'
  | 'amount_mismatch'
  | 'orphan_ledger_debit'
  | 'unexplained_difference'
  | 'unknown';

export interface ReconciliationSummary {
  month: string;
  empId: number | null;
  payrollGeneratedTotal: number;
  ledgerSalaryCreditsTotal: number;
  payrollLedgerCreditDiff: number;
  /** Sum of deduplicated advance cash moves with a resolvable employee mapping */
  resolvedCashAdvanceTotal: number;
  /** Advance-like cash moves that cannot be tied to an employee */
  unresolvedCashAdvanceTotal: number;
  /** resolved + unresolved — deduplicated by CashMove ID */
  advanceCashMoveTotal: number;
  ledgerAdvanceDebitsTotal: number;
  advanceLedgerDiff: number;
  unresolvedCashAdvanceCount: number;
  payoutCashMoveTotal: number;
  ledgerPayoutDebitsTotal: number;
  payoutLedgerDiff: number;
  legacyPayrollIncomeMirrorTotal: number;
  legacyPayrollExpenseMirrorTotal: number;
  legacyColumnsAvailable: boolean;
  issueCount: number;
}

export interface MissingPayrollCreditRow {
  payrollId: number;
  empId: number;
  empName: string;
  workDate: string;
  dailyWage: number;
}

export interface OrphanLedgerCreditRow {
  ledgerEntryId: number;
  empId: number;
  empName: string;
  entryDate: string;
  amount: number;
  refId: number;
}

export interface MissingAdvanceDebitRow {
  cashMoveId: number;
  invDate: string;
  amount: number;
  empId: number | null;
  empName: string | null;
  categoryName: string | null;
  notes: string | null;
  ledgerAmount: number | null;
  issueReason: AdvanceIssueReason;
}

export interface SuggestedEmployeeMatch {
  empId: number;
  empName: string;
  matchScore: number;
}

export interface UnresolvedCashAdvanceRow {
  cashMoveId: number;
  expInId: number;
  invDate: string;
  amount: number;
  categoryName: string | null;
  notes: string | null;
  cashEmpId: number | null;
  mapEmpId: number | null;
  hasLedgerEntry: boolean;
  ledgerEntryId: number | null;
  suggestedEmployeeMatches: SuggestedEmployeeMatch[];
  issueReason: AdvanceIssueReason;
}

export interface AdvanceAmountMismatchRow {
  cashMoveId: number;
  invDate: string;
  cashAmount: number;
  ledgerAmount: number;
  empId: number;
  empName: string;
  categoryName: string | null;
  notes: string | null;
  issueReason: AdvanceIssueReason;
}

export interface AdvanceDiagnosticRow {
  label: string;
  amount: number;
  issueReason: AdvanceIssueReason;
  notes: string | null;
  ledgerEntryId?: number | null;
}

export interface MissingPayoutDebitRow {
  cashMoveId: number;
  invDate: string;
  amount: number;
  empId: number | null;
  empName: string | null;
}

export interface LegacyMirrorGroupRow {
  invDate: string;
  empId: number | null;
  empName: string | null;
  incomeMirrorTotal: number;
  expenseMirrorTotal: number;
  rowCount: number;
}

export interface EmployeeLedgerReconciliationResponse {
  summary: ReconciliationSummary;
  missingPayrollCredits: MissingPayrollCreditRow[];
  orphanLedgerCredits: OrphanLedgerCreditRow[];
  missingAdvanceDebits: MissingAdvanceDebitRow[];
  unresolvedCashAdvances: UnresolvedCashAdvanceRow[];
  advanceAmountMismatches: AdvanceAmountMismatchRow[];
  advanceDiagnosticRows: AdvanceDiagnosticRow[];
  missingPayoutDebits: MissingPayoutDebitRow[];
  legacyMirrorRows: LegacyMirrorGroupRow[];
}
