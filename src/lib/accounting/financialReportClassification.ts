/**
 * Phase 5B — Production financial report classification helpers.
 * Reuses Phase 5A audit logic with stable bucket names for report APIs.
 */

import type { CashMoveReportClassification } from '@/lib/types/financial-report-classification';
import {
  classifyCashMoveForFinancialAudit,
  classifyCategoryForFinancialAudit,
  type CashMoveAuditInput,
  type CategoryAuditInput,
  type CashMoveAuditResult,
  type CategoryAuditResult,
} from '@/lib/accounting/financialReportClassificationAudit';

export type ReportClassificationBucket =
  | 'salesRevenue'
  | 'otherBusinessIncome'
  | 'nonRevenueCashIn'
  | 'legacyEmployeeIncomeMirror'
  | 'operatingExpense'
  | 'employeeAdvances'
  | 'employeePayouts'
  | 'payrollExpenseFromLedger'
  | 'legacyPayrollExpense'
  | 'internalTransfers'
  | 'uncategorizedCashIn'
  | 'uncategorizedCashOut';

export const REPORT_BUCKET_LABELS: Record<ReportClassificationBucket, string> = {
  salesRevenue: 'إيرادات مبيعات',
  otherBusinessIncome: 'إيرادات أعمال أخرى',
  nonRevenueCashIn: 'تدفقات داخلة غير إيراد',
  legacyEmployeeIncomeMirror: 'مرآة إيراد موظف (قديم)',
  operatingExpense: 'مصروفات تشغيل',
  employeeAdvances: 'سلف موظفين',
  employeePayouts: 'صرف مستحقات',
  payrollExpenseFromLedger: 'تكلفة رواتب من الدفتر',
  legacyPayrollExpense: 'مصروف رواتب قديم (ترحيل نقدي)',
  internalTransfers: 'تحويلات داخلية',
  uncategorizedCashIn: 'حركات واردة تحتاج مراجعة',
  uncategorizedCashOut: 'حركات صادرة تحتاج مراجعة',
};

export const NON_REVENUE_TREASURY_LABEL =
  'هذه حركة خزنة وليست إيراد ربح';

export interface CashMoveForReportInput extends CashMoveAuditInput {
  inOut: string;
  amount: number;
}

export interface CategoryForReportInput extends CategoryAuditInput {}

export function classifyCategoryForReport(
  input: CategoryForReportInput,
): CategoryAuditResult {
  return classifyCategoryForFinancialAudit(input);
}

export function classifyCashMoveForReport(
  input: CashMoveForReportInput,
): CashMoveAuditResult {
  return classifyCashMoveForFinancialAudit(input);
}

export function getCashMoveClassificationBucket(
  row: CashMoveAuditResult,
  inOut: string,
): ReportClassificationBucket {
  if (row.revenueClass === 'sales_revenue') return 'salesRevenue';
  if (row.revenueClass === 'other_business_income') return 'otherBusinessIncome';
  if (row.revenueClass === 'non_revenue_cash_in') return 'nonRevenueCashIn';
  if (row.revenueClass === 'legacy_employee_income_mirror') {
    return 'legacyEmployeeIncomeMirror';
  }
  if (row.expenseClass === 'operating_expense') return 'operatingExpense';
  if (row.expenseClass === 'employee_advance') return 'employeeAdvances';
  if (row.expenseClass === 'employee_payout') return 'employeePayouts';
  if (row.expenseClass === 'legacy_payroll_expense') return 'legacyPayrollExpense';
  if (row.expenseClass === 'non_expense_cash_out') return 'internalTransfers';

  if (row.classificationGuess === 'unknown_flow') {
    return inOut === 'in' ? 'uncategorizedCashIn' : 'uncategorizedCashOut';
  }

  if (inOut === 'in') return 'uncategorizedCashIn';
  if (inOut === 'out') return 'uncategorizedCashOut';
  return 'uncategorizedCashOut';
}

export function isRealRevenue(row: CashMoveAuditResult): boolean {
  return (
    row.revenueClass === 'sales_revenue'
    || row.revenueClass === 'other_business_income'
  );
}

export function isProfitExpense(row: CashMoveAuditResult): boolean {
  return row.expenseClass === 'operating_expense';
}

export function isEmployeeLedgerRelated(row: CashMoveAuditResult): boolean {
  return row.isEmployeeLedgerRelated;
}

export function buildCashMoveReportClassification(
  input: CashMoveForReportInput,
): CashMoveReportClassification {
  const audit = classifyCashMoveForReport(input);
  const bucket = getCashMoveClassificationBucket(audit, input.inOut);
  const isNonRevenueCashIn =
    bucket === 'nonRevenueCashIn'
    || bucket === 'legacyEmployeeIncomeMirror'
    || bucket === 'uncategorizedCashIn';

  return {
    bucket,
    label: REPORT_BUCKET_LABELS[bucket],
    isRealRevenue: isRealRevenue(audit),
    isProfitExpense: isProfitExpense(audit),
    isEmployeeLedgerRelated: isEmployeeLedgerRelated(audit),
    isNonRevenueCashIn,
    treasuryLabel: isNonRevenueCashIn ? NON_REVENUE_TREASURY_LABEL : undefined,
  };
}

export function createEmptyClassifiedTotals(): ClassifiedTotalsShape {
  return {
    salesRevenue: 0,
    otherBusinessIncome: 0,
    nonRevenueCashIn: 0,
    legacyEmployeeIncomeMirror: 0,
    operatingExpense: 0,
    employeeAdvances: 0,
    employeePayouts: 0,
    payrollExpenseFromLedger: 0,
    legacyPayrollExpense: 0,
    internalTransfers: 0,
    uncategorizedCashIn: 0,
    uncategorizedCashOut: 0,
    cashInTotal: 0,
    cashOutTotal: 0,
    cleanNetProfit: 0,
  };
}

export interface ClassifiedTotalsShape {
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

export function computeCleanNetProfit(totals: ClassifiedTotalsShape): number {
  return roundMoney(
    totals.salesRevenue
    + totals.otherBusinessIncome
    - totals.operatingExpense
    - totals.payrollExpenseFromLedger,
  );
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function aggregateClassifiedCashMoves(
  rows: Array<CashMoveForReportInput>,
): {
  classifiedTotals: ClassifiedTotalsShape;
  classificationBreakdown: Array<{
    bucket: string;
    label: string;
    amount: number;
    transactionCount: number;
  }>;
} {
  const totals = createEmptyClassifiedTotals();
  const breakdownMap = new Map<
    ReportClassificationBucket,
    { amount: number; transactionCount: number }
  >();

  for (const row of rows) {
    const audit = classifyCashMoveForReport(row);
    const bucket = getCashMoveClassificationBucket(audit, row.inOut);
    const amount = Number(row.amount) || 0;

    if (row.inOut === 'in') totals.cashInTotal += amount;
    if (row.inOut === 'out') totals.cashOutTotal += amount;

    totals[bucket] += amount;

    const existing = breakdownMap.get(bucket) ?? { amount: 0, transactionCount: 0 };
    existing.amount += amount;
    existing.transactionCount += 1;
    breakdownMap.set(bucket, existing);
  }

  totals.salesRevenue = roundMoney(totals.salesRevenue);
  totals.otherBusinessIncome = roundMoney(totals.otherBusinessIncome);
  totals.nonRevenueCashIn = roundMoney(totals.nonRevenueCashIn);
  totals.legacyEmployeeIncomeMirror = roundMoney(totals.legacyEmployeeIncomeMirror);
  totals.operatingExpense = roundMoney(totals.operatingExpense);
  totals.employeeAdvances = roundMoney(totals.employeeAdvances);
  totals.employeePayouts = roundMoney(totals.employeePayouts);
  totals.legacyPayrollExpense = roundMoney(totals.legacyPayrollExpense);
  totals.internalTransfers = roundMoney(totals.internalTransfers);
  totals.uncategorizedCashIn = roundMoney(totals.uncategorizedCashIn);
  totals.uncategorizedCashOut = roundMoney(totals.uncategorizedCashOut);
  totals.cashInTotal = roundMoney(totals.cashInTotal);
  totals.cashOutTotal = roundMoney(totals.cashOutTotal);
  totals.cleanNetProfit = computeCleanNetProfit(totals);

  const classificationBreakdown = [...breakdownMap.entries()]
    .filter(([, v]) => v.amount !== 0 || v.transactionCount > 0)
    .map(([bucket, v]) => ({
      bucket,
      label: REPORT_BUCKET_LABELS[bucket],
      amount: roundMoney(v.amount),
      transactionCount: v.transactionCount,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { classifiedTotals: totals, classificationBreakdown };
}

export type { CashMoveReportClassification };
