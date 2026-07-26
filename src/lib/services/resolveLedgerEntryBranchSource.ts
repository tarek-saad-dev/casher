/**
 * Phase 1L — central map of ledger EntryReason → BranchID source.
 * Writers must still validate persisted row ownership; this does not invent BranchID.
 */

export type LedgerBranchSourceKind =
  | 'payroll_row'
  | 'branch_payroll_plan'
  | 'daily_target'
  | 'cash_move'
  | 'session_branch'
  | 'sale_or_cash_move'
  | 'original_ledger_entry';

export interface LedgerBranchSourceRule {
  source: LedgerBranchSourceKind;
  rule: string;
}

const RULES: Record<string, LedgerBranchSourceRule> = {
  hourly_wage: {
    source: 'payroll_row',
    rule: 'Inherit BranchID from TblEmpDailyPayroll row (EmpID+BranchID+WorkDate).',
  },
  monthly_salary: {
    source: 'branch_payroll_plan',
    rule: 'Inherit BranchID from TblEmpBranchPayrollPlan used for posting.',
  },
  target: {
    source: 'daily_target',
    rule: 'Inherit BranchID from TblEmpDailyTarget (invoice branch).',
  },
  commission: {
    source: 'sale_or_cash_move',
    rule: 'Inherit from persisted sale/invoice BranchID for the earning branch.',
  },
  bonus: {
    source: 'session_branch',
    rule: 'Use authenticated active session branch; reject body BranchID.',
  },
  tip: {
    source: 'sale_or_cash_move',
    rule: 'Inherit from persisted sale/payment/CashMove BranchID.',
  },
  advance: {
    source: 'cash_move',
    rule: 'Inherit BranchID from TblCashMove; Ledger.BranchID = CashMove.BranchID.',
  },
  payout: {
    source: 'cash_move',
    rule: 'Session branch balance → CashMove → ledger debit; same BranchID.',
  },
  employee_funding: {
    source: 'cash_move',
    rule: 'Inherit BranchID from source CashMove.',
  },
  correction: {
    source: 'original_ledger_entry',
    rule: 'Inherit original ledger entry BranchID; never change BranchID.',
  },
  reversal: {
    source: 'original_ledger_entry',
    rule: 'Inherit original ledger entry BranchID; never change BranchID.',
  },
};

export function resolveLedgerEntryBranchSource(
  entryReason: string,
): LedgerBranchSourceRule {
  const rule = RULES[entryReason];
  if (!rule) {
    throw new Error(
      `No BranchID source rule for EntryReason=${entryReason} — fail closed`,
    );
  }
  return rule;
}

export function listLedgerEntryBranchSourceRules(): Record<
  string,
  LedgerBranchSourceRule
> {
  return { ...RULES };
}
