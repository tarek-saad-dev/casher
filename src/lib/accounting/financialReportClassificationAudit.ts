/**
 * Phase 5A — Read-only financial report classification helpers.
 * Used by audit script and tests; does NOT modify reports or data.
 */

import { normalizeForMatch } from '@/lib/accounting/cashMoveClassification';

export const EMPLOYEE_FUNDING_CATEGORY_NAME = 'تمويل من موظف';
export const PAYOUT_EXPENSE_CATEGORY_NAME = 'صرف مستحقات الموظفين';

export const READ_ONLY_FINANCIAL_AUDIT_GUARD = Object.freeze({
  allowWrites: false,
  allowCashMoveUpdates: false,
  allowLedgerUpdates: false,
});

export type AuditRevenueClass =
  | 'sales_revenue'
  | 'other_business_income'
  | 'non_revenue_cash_in'
  | 'legacy_employee_income_mirror'
  | 'unknown';

export type AuditExpenseClass =
  | 'operating_expense'
  | 'employee_advance'
  | 'employee_payout'
  | 'legacy_payroll_expense'
  | 'non_expense_cash_out'
  | 'unknown';

export type AuditLedgerCashClass =
  | 'advance'
  | 'payout'
  | 'employee_funding'
  | 'advance_repayment'
  | 'none';

export interface CategoryAuditInput {
  expInId: number;
  categoryName: string;
  expInType: string | null;
  txnKind: string | null;
  mappedEmpId: number | null;
}

export interface CategoryAuditResult {
  expInId: number;
  categoryName: string;
  expInType: string | null;
  txnKind: string | null;
  mappedEmpId: number | null;
  revenueClass: AuditRevenueClass | null;
  expenseClass: AuditExpenseClass | null;
  ledgerCashClass: AuditLedgerCashClass;
  isEmployeeLedgerRelated: boolean;
  countsAsRealRevenue: boolean;
  countsAsOperatingExpense: boolean;
  classificationGuess: string;
}

export interface CashMoveAuditInput {
  invType: string;
  inOut: string;
  categoryName: string | null;
  isPayrollDeduction: boolean;
  isEmployeePayrollIncome: boolean;
  txnKind: string | null;
  empIdFromMap: number | null;
  empId: number | null;
}

export interface CashMoveAuditResult {
  revenueClass: AuditRevenueClass | null;
  expenseClass: AuditExpenseClass | null;
  ledgerCashClass: AuditLedgerCashClass;
  isEmployeeLedgerRelated: boolean;
  countsAsRealRevenue: boolean;
  countsAsOperatingExpense: boolean;
  classificationGuess: string;
}

const SALES_INV_TYPES = new Set(['مبيعات', 'مبيعات بالكارت']);
const DAILY_PAYROLL_EXPENSE = 'يوميات الموظفين';

function norm(text: string | null | undefined): string {
  return normalizeForMatch(text);
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(norm(p)));
}

export function classifyCategoryForFinancialAudit(
  input: CategoryAuditInput,
): CategoryAuditResult {
  const name = input.categoryName ?? '';
  const n = norm(name);
  const isIncome = input.expInType === 'ايرادات' || input.expInType === 'إيرادات';
  const isExpense = input.expInType === 'مصروفات';

  let revenueClass: AuditRevenueClass | null = null;
  let expenseClass: AuditExpenseClass | null = null;
  let ledgerCashClass: AuditLedgerCashClass = 'none';
  let classificationGuess = 'unclassified';

  if (name === EMPLOYEE_FUNDING_CATEGORY_NAME) {
    revenueClass = 'non_revenue_cash_in';
    ledgerCashClass = 'employee_funding';
    classificationGuess = 'employee_funding';
  } else if (name === PAYOUT_EXPENSE_CATEGORY_NAME) {
    expenseClass = 'employee_payout';
    ledgerCashClass = 'payout';
    classificationGuess = 'employee_payout';
  } else if (name === DAILY_PAYROLL_EXPENSE) {
    expenseClass = 'legacy_payroll_expense';
    classificationGuess = 'legacy_payroll_expense';
  } else if (input.txnKind === 'advance') {
    expenseClass = 'employee_advance';
    ledgerCashClass = 'advance';
    classificationGuess = 'employee_advance';
  } else if (input.txnKind === 'revenue' && isIncome) {
    revenueClass = 'legacy_employee_income_mirror';
    classificationGuess = 'employee_mapped_revenue_category';
  } else if (isIncome && containsAny(n, ['رد سلف', 'سداد', 'تسوية سلف', 'سد'])) {
    revenueClass = 'non_revenue_cash_in';
    ledgerCashClass = 'advance_repayment';
    classificationGuess = 'advance_repayment';
  } else if (isIncome && containsAny(n, ['تحويل', 'تحويلات', 'بين طرق الدفع'])) {
    revenueClass = 'non_revenue_cash_in';
    classificationGuess = 'internal_transfer';
  } else if (isIncome) {
    revenueClass = 'other_business_income';
    classificationGuess = 'other_business_income';
  } else if (isExpense && containsAny(n, ['سلف', 'سلفة', 'سلفه'])) {
    expenseClass = 'employee_advance';
    ledgerCashClass = 'advance';
    classificationGuess = 'employee_advance_by_name';
  } else if (isExpense && containsAny(n, ['تحويل', 'تحويلات'])) {
    expenseClass = 'non_expense_cash_out';
    classificationGuess = 'internal_transfer';
  } else if (isExpense) {
    expenseClass = 'operating_expense';
    classificationGuess = 'operating_expense';
  }

  const isEmployeeLedgerRelated =
    ledgerCashClass !== 'none'
    || input.txnKind === 'advance'
    || input.txnKind === 'revenue'
    || input.txnKind === 'deduction'
    || Boolean(input.mappedEmpId);

  const countsAsRealRevenue = revenueClass === 'other_business_income';
  const countsAsOperatingExpense = expenseClass === 'operating_expense';

  return {
    expInId: input.expInId,
    categoryName: name,
    expInType: input.expInType,
    txnKind: input.txnKind,
    mappedEmpId: input.mappedEmpId,
    revenueClass,
    expenseClass,
    ledgerCashClass,
    isEmployeeLedgerRelated,
    countsAsRealRevenue,
    countsAsOperatingExpense,
    classificationGuess,
  };
}

export function classifyCashMoveForFinancialAudit(
  input: CashMoveAuditInput,
): CashMoveAuditResult {
  if (SALES_INV_TYPES.has(input.invType) && input.inOut === 'in') {
    return {
      revenueClass: 'sales_revenue',
      expenseClass: null,
      ledgerCashClass: 'none',
      isEmployeeLedgerRelated: false,
      countsAsRealRevenue: true,
      countsAsOperatingExpense: false,
      classificationGuess: 'sales_revenue',
    };
  }

  if (input.isEmployeePayrollIncome) {
    return {
      revenueClass: 'legacy_employee_income_mirror',
      expenseClass: null,
      ledgerCashClass: 'none',
      isEmployeeLedgerRelated: true,
      countsAsRealRevenue: false,
      countsAsOperatingExpense: false,
      classificationGuess: 'legacy_employee_income_mirror',
    };
  }

  if (input.isPayrollDeduction) {
    return {
      revenueClass: null,
      expenseClass: 'legacy_payroll_expense',
      ledgerCashClass: 'none',
      isEmployeeLedgerRelated: true,
      countsAsRealRevenue: false,
      countsAsOperatingExpense: false,
      classificationGuess: 'legacy_payroll_expense',
    };
  }

  const cat = classifyCategoryForFinancialAudit({
    expInId: 0,
    categoryName: input.categoryName ?? '',
    expInType: input.invType === 'مصروفات' ? 'مصروفات' : 'ايرادات',
    txnKind: input.txnKind,
    mappedEmpId: input.empIdFromMap,
  });

  if (input.invType === 'ايرادات' && input.inOut === 'in') {
    return {
      revenueClass: cat.revenueClass ?? 'other_business_income',
      expenseClass: null,
      ledgerCashClass: cat.ledgerCashClass,
      isEmployeeLedgerRelated: cat.isEmployeeLedgerRelated,
      countsAsRealRevenue: cat.countsAsRealRevenue,
      countsAsOperatingExpense: false,
      classificationGuess: cat.classificationGuess,
    };
  }

  if (input.invType === 'مصروفات' && input.inOut === 'out') {
    return {
      revenueClass: null,
      expenseClass: cat.expenseClass ?? 'operating_expense',
      ledgerCashClass: cat.ledgerCashClass,
      isEmployeeLedgerRelated: cat.isEmployeeLedgerRelated,
      countsAsRealRevenue: false,
      countsAsOperatingExpense: cat.countsAsOperatingExpense,
      classificationGuess: cat.classificationGuess,
    };
  }

  return {
    revenueClass: null,
    expenseClass: null,
    ledgerCashClass: 'none',
    isEmployeeLedgerRelated: false,
    countsAsRealRevenue: false,
    countsAsOperatingExpense: false,
    classificationGuess: 'unknown_flow',
  };
}

export function aggregateCashMoveAuditTotals(
  rows: Array<CashMoveAuditResult & { amount: number }>,
): Record<string, number> {
  const totals: Record<string, number> = {
    totalIn: 0,
    totalOut: 0,
    likelySalesRevenue: 0,
    likelyNonRevenueCashIn: 0,
    legacyIncomeMirror: 0,
    likelyEmployeePayouts: 0,
    likelyEmployeeAdvances: 0,
    likelyOperatingExpenses: 0,
    legacyPayrollExpense: 0,
  };

  for (const row of rows) {
    if (row.revenueClass === 'sales_revenue') totals.likelySalesRevenue += row.amount;
    if (row.revenueClass === 'non_revenue_cash_in' || row.revenueClass === 'legacy_employee_income_mirror') {
      totals.likelyNonRevenueCashIn += row.amount;
    }
    if (row.revenueClass === 'legacy_employee_income_mirror') totals.legacyIncomeMirror += row.amount;
    if (row.expenseClass === 'employee_payout') totals.likelyEmployeePayouts += row.amount;
    if (row.expenseClass === 'employee_advance') totals.likelyEmployeeAdvances += row.amount;
    if (row.expenseClass === 'operating_expense') totals.likelyOperatingExpenses += row.amount;
    if (row.expenseClass === 'legacy_payroll_expense') totals.legacyPayrollExpense += row.amount;
  }

  return totals;
}
