export const EMP_LEDGER_ENTRY_DIRECTIONS = ['credit', 'debit'] as const;
export type EmpLedgerEntryDirection = (typeof EMP_LEDGER_ENTRY_DIRECTIONS)[number];

export const EMP_LEDGER_ENTRY_REASONS = [
  'hourly_wage',
  'monthly_salary',
  'target',
  'commission',
  'bonus',
  'advance',
  'payout',
  'deduction',
  'settlement',
  'adjustment',
  'employee_funding',
  'tip',
] as const;
export type EmpLedgerEntryReason = (typeof EMP_LEDGER_ENTRY_REASONS)[number];

export const EMP_LEDGER_SALARY_CREDIT_REASONS = ['hourly_wage', 'monthly_salary'] as const;
export const EMP_LEDGER_TARGET_CREDIT_REASONS = ['target', 'commission', 'bonus'] as const;
export const EMP_LEDGER_FUNDING_CREDIT_REASONS = ['employee_funding'] as const;
export const EMP_LEDGER_TIP_CREDIT_REASONS = ['tip'] as const;
export const EMP_LEDGER_ADVANCE_DEBIT_REASONS = ['advance'] as const;
export const EMP_LEDGER_PAYOUT_DEBIT_REASONS = ['payout'] as const;
export const EMP_LEDGER_DEDUCTION_DEBIT_REASONS = ['deduction', 'settlement', 'adjustment'] as const;

export interface EmpLedgerEntryRow {
  id: number;
  empId: number;
  empName: string;
  entryDate: string;
  entryDirection: EmpLedgerEntryDirection;
  entryReason: EmpLedgerEntryReason;
  amount: number;
  payrollMonth: string | null;
  refType: string | null;
  refId: number | null;
  cashMoveId: number | null;
  attendanceId: number | null;
  notes: string | null;
  isVoided: boolean;
  voidReason: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string | null;
  /** Branch stamped on the ledger row (historical attribution — not home branch). */
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
}

export interface EmpLedgerListResponse {
  entries: EmpLedgerEntryRow[];
  totalCredits: number;
  totalDebits: number;
  balance: number;
  filters: {
    empId: number | null;
    dateFrom: string | null;
    dateTo: string | null;
    month: string | null;
    branchId: number | null;
  };
}

/** Fixed salon branches rendered as paired rows in the employee ledger table. */
export const EMP_LEDGER_TABLE_BRANCH_CODES = ['GLEEM', 'CAMP_CAESAR'] as const;
export type EmpLedgerTableBranchCode = (typeof EMP_LEDGER_TABLE_BRANCH_CODES)[number];

/**
 * Per-branch employee strip (entry BranchID).
 * balance = salary + target + funding − payout − revenueWithdrawal − advance − deductions
 * (= ledger credits − debits; payout/revenueWithdrawal/advance are withdrawal-bucket slices).
 */
export interface EmpLedgerEmployeeBranchBreakdown {
  branchId: number;
  branchCode: EmpLedgerTableBranchCode | string;
  branchName: string;
  salary: number;
  target: number;
  funding: number;
  /** صرف = payoutWithinDues */
  payout: number;
  revenueWithdrawal: number;
  /** سلفة = advanceExcess */
  advance: number;
  deductions: number;
  balance: number;
  /** Raw ledger buckets (for reconciliation / KPIs). */
  salaryCredits: number;
  targetCredits: number;
  fundingCredits: number;
  advanceDebits: number;
  payoutDebits: number;
  deductionDebits: number;
}

export interface EmpLedgerEmployeeSummaryRow {
  empId: number;
  empName: string;
  salaryCredits: number;
  targetCredits: number;
  fundingCredits: number;
  advanceDebits: number;
  payoutDebits: number;
  deductionDebits: number;
  balance: number;
  /** Sum of per-branch balances for GLEEM + CAMP_CAESAR (always both). */
  overallBalance: number;
  // إيراد الموظف الفعلي للمحل خلال الشهر (من الفواتير) — يُستخدم لتصنيف المسحوبات.
  revenue: number;
  // تصنيف مسحوبات الموظف (سلف + صرف) على ثلاث شرائح:
  // صرف = ضمن الاستحقاقات (راتب + تارجت)
  payoutWithinDues: number;
  // سحب الايراد = الزيادة عن الاستحقاقات المغطّاة بإيراد الموظف
  revenueWithdrawal: number;
  // سلفة = ما تجاوز (راتب + تارجت + إيراد)
  advanceExcess: number;
  /**
   * Always includes GLEEM + CAMP_CAESAR (zeros when no entries).
   * Attribution = TblEmpLedgerEntry.BranchID only.
   */
  branches: Record<EmpLedgerTableBranchCode, EmpLedgerEmployeeBranchBreakdown>;
  /** Compact list (non-zero only) — legacy UI / cards. */
  branchBalances?: Array<{
    branchId: number;
    branchCode: string;
    branchName: string;
    balance: number;
  }>;
}

/** Branch financial strip — same bucket math as employee summary, grouped by entry BranchID. */
export interface EmpLedgerBranchFinancialRow {
  branchId: number;
  branchCode: string;
  branchName: string;
  /** راتب + تارجت */
  accrued: number;
  /** صرف مستحقات (payout debits) */
  paid: number;
  /** سلف */
  advances: number;
  /** خصومات / تسويات / تعديلات */
  deductions: number;
  /** تمويل من موظف + تبس */
  transfers: number;
  /**
   * Balance = accrued + transfers − advances − paid − deductions
   * (= salary + target + funding − advance − payout − deduction)
   */
  balance: number;
  salaryCredits: number;
  targetCredits: number;
  fundingCredits: number;
  advanceDebits: number;
  payoutDebits: number;
  deductionDebits: number;
}

export interface EmpLedgerBranchFinancialOverall {
  accrued: number;
  paid: number;
  advances: number;
  deductions: number;
  transfers: number;
  balance: number;
  salaryCredits: number;
  targetCredits: number;
  fundingCredits: number;
  advanceDebits: number;
  payoutDebits: number;
  deductionDebits: number;
}

export interface EmpLedgerBranchFinancialSummary {
  branches: EmpLedgerBranchFinancialRow[];
  overall: EmpLedgerBranchFinancialOverall;
}

export interface EmpLedgerSummaryResponse {
  month: string;
  employees: EmpLedgerEmployeeSummaryRow[];
  totals: {
    salaryCredits: number;
    targetCredits: number;
    fundingCredits: number;
    advanceDebits: number;
    payoutDebits: number;
    deductionDebits: number;
    balance: number;
    revenue: number;
    payoutWithinDues: number;
    revenueWithdrawal: number;
    advanceExcess: number;
  };
  /** Multi-branch financial summary for the selected month (entry BranchID). */
  branchFinancial?: EmpLedgerBranchFinancialSummary;
  /** Active filter: null = all accessible branches. */
  branchId?: number | null;
  ledgerDualWriteEnabled?: boolean;
}

export interface EmpLedgerPayoutResponse {
  success: true;
  cashMoveId: number;
  ledgerEntryId: number;
  previousBalance: number;
  payoutAmount: number;
  newBalance: number;
  ledgerDualWrite: true;
}

export interface EmpLedgerFundingResponse {
  success: true;
  cashMoveId: number;
  ledgerEntryId: number;
  employeeName: string;
  amount: number;
  previousBalance: number;
  newBalance: number;
  ledgerDualWrite: true;
}

export const EMP_LEDGER_REASON_LABELS: Record<EmpLedgerEntryReason, string> = {
  hourly_wage: 'أجر ساعات',
  monthly_salary: 'راتب شهري',
  target: 'تارجت يومي',
  commission: 'عمولة',
  bonus: 'مكافأة',
  advance: 'سلفة',
  payout: 'صرف',
  deduction: 'خصم',
  settlement: 'تسوية',
  adjustment: 'تعديل',
  employee_funding: 'تمويل للمحل',
  tip: 'تبس',
};

export interface EmpLedgerTipResponse {
  success: true;
  cashMoveId: number;
  ledgerEntryId: number;
  invID: number;
  employeeName: string;
  invoiceTotal: number;
  amountPaid: number;
  tipAmount: number;
  previousBalance: number;
  newBalance: number;
  ledgerDualWrite: true;
  tipWhatsApp?: boolean;
}
