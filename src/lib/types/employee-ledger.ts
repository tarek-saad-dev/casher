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
] as const;
export type EmpLedgerEntryReason = (typeof EMP_LEDGER_ENTRY_REASONS)[number];

export const EMP_LEDGER_SALARY_CREDIT_REASONS = ['hourly_wage', 'monthly_salary'] as const;
export const EMP_LEDGER_TARGET_CREDIT_REASONS = ['target', 'commission', 'bonus'] as const;
export const EMP_LEDGER_FUNDING_CREDIT_REASONS = ['employee_funding'] as const;
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
  };
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
  };
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
  target: 'تارجت',
  commission: 'عمولة',
  bonus: 'مكافأة',
  advance: 'سلفة',
  payout: 'صرف',
  deduction: 'خصم',
  settlement: 'تسوية',
  adjustment: 'تعديل',
  employee_funding: 'تمويل للمحل',
};
