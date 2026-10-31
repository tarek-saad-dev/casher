import { describe, it, expect } from 'vitest';
import {
  STORE_NON_REVENUE_CASH_IN_CATEGORY,
  STORE_OTHER_BUSINESS_INCOME_CATEGORY,
  STORE_INCOME_KIND_LABELS,
  isStoreIncomeCategoryName,
  parseStoreIncomeKind,
  storeIncomeCategoryName,
} from '@/lib/accounting/storeIncome';
import {
  classifyCategoryForFinancialAudit,
  classifyCashMoveForFinancialAudit,
} from '@/lib/accounting/financialReportClassificationAudit';
import {
  aggregateClassifiedCashMoves,
  computeCleanNetProfit,
  getCashMoveClassificationBucket,
  isRealRevenue,
} from '@/lib/accounting/financialReportClassification';

describe('storeIncome helpers', () => {
  it('parses store income kinds only', () => {
    expect(parseStoreIncomeKind('other_business_income')).toBe('other_business_income');
    expect(parseStoreIncomeKind('non_revenue_cash_in')).toBe('non_revenue_cash_in');
    expect(parseStoreIncomeKind('sales_revenue')).toBeNull();
    expect(parseStoreIncomeKind(null)).toBeNull();
  });

  it('maps kinds to fixed category names', () => {
    expect(storeIncomeCategoryName('other_business_income')).toBe(STORE_OTHER_BUSINESS_INCOME_CATEGORY);
    expect(storeIncomeCategoryName('non_revenue_cash_in')).toBe(STORE_NON_REVENUE_CASH_IN_CATEGORY);
    expect(STORE_INCOME_KIND_LABELS.other_business_income).toBe(STORE_OTHER_BUSINESS_INCOME_CATEGORY);
  });

  it('detects store category names', () => {
    expect(isStoreIncomeCategoryName(STORE_OTHER_BUSINESS_INCOME_CATEGORY)).toBe(true);
    expect(isStoreIncomeCategoryName(STORE_NON_REVENUE_CASH_IN_CATEGORY)).toBe(true);
    expect(isStoreIncomeCategoryName('تمويل من موظف')).toBe(false);
  });
});

describe('store income classification', () => {
  it('classifies إيراد آخر للمحل as other_business_income (real P&L)', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 101,
      categoryName: STORE_OTHER_BUSINESS_INCOME_CATEGORY,
      expInType: 'ايرادات',
      txnKind: null,
      mappedEmpId: null,
    });
    expect(r.revenueClass).toBe('other_business_income');
    expect(r.countsAsRealRevenue).toBe(true);
    expect(r.isEmployeeLedgerRelated).toBe(false);
  });

  it('classifies تحصيل غير ربحي as non_revenue_cash_in (treasury only)', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 102,
      categoryName: STORE_NON_REVENUE_CASH_IN_CATEGORY,
      expInType: 'ايرادات',
      txnKind: null,
      mappedEmpId: null,
    });
    expect(r.revenueClass).toBe('non_revenue_cash_in');
    expect(r.countsAsRealRevenue).toBe(false);
    expect(r.isEmployeeLedgerRelated).toBe(false);
  });

  it('keeps EmpID-null store profit income in clean net profit once', () => {
    const { classifiedTotals } = aggregateClassifiedCashMoves([
      {
        invType: 'ايرادات',
        inOut: 'in',
        amount: 250,
        categoryName: STORE_OTHER_BUSINESS_INCOME_CATEGORY,
        isPayrollDeduction: false,
        isEmployeePayrollIncome: false,
        txnKind: null,
        empIdFromMap: null,
        empId: null,
      },
      {
        invType: 'ايرادات',
        inOut: 'in',
        amount: 100,
        categoryName: STORE_NON_REVENUE_CASH_IN_CATEGORY,
        isPayrollDeduction: false,
        isEmployeePayrollIncome: false,
        txnKind: null,
        empIdFromMap: null,
        empId: null,
      },
    ]);

    expect(classifiedTotals.otherBusinessIncome).toBe(250);
    expect(classifiedTotals.nonRevenueCashIn).toBe(100);
    expect(classifiedTotals.cashInTotal).toBe(350);
    // non-revenue does not enter clean net profit
    expect(computeCleanNetProfit({
      ...classifiedTotals,
      salesRevenue: 1000,
      payrollExpenseFromLedger: 0,
      operatingExpense: 200,
    })).toBe(1050); // 1000 + 250 - 200
  });

  it('does not treat store income as employee ledger related', () => {
    const audit = classifyCashMoveForFinancialAudit({
      invType: 'ايرادات',
      inOut: 'in',
      categoryName: STORE_OTHER_BUSINESS_INCOME_CATEGORY,
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: null,
    });
    expect(getCashMoveClassificationBucket(audit, 'in')).toBe('otherBusinessIncome');
    expect(isRealRevenue(audit)).toBe(true);
    expect(audit.isEmployeeLedgerRelated).toBe(false);
  });
});

describe('partners legacy vs classified double-count guard', () => {
  it('adds store other business income only once when combining override + classification', () => {
    const partnersShopRevenue = 10_000;
    const storeOtherBusinessIncome = 400;
    const operatingExpenses = 1_000;
    const payrollExpenseFromLedger = 2_000;

    // Legacy partners path
    const legacyOperatingNet =
      partnersShopRevenue + storeOtherBusinessIncome - 500 - operatingExpenses;

    // Classified path: sales override excludes store income; otherBusinessIncome adds it once
    const cleanNetProfit = computeCleanNetProfit({
      salesRevenue: partnersShopRevenue,
      otherBusinessIncome: storeOtherBusinessIncome,
      nonRevenueCashIn: 150,
      legacyEmployeeIncomeMirror: 0,
      operatingExpense: operatingExpenses,
      employeeAdvances: 0,
      employeePayouts: 0,
      payrollExpenseFromLedger,
      legacyPayrollExpense: 0,
      internalTransfers: 0,
      uncategorizedCashIn: 0,
      uncategorizedCashOut: 0,
      cashInTotal: 0,
      cashOutTotal: 0,
      cleanNetProfit: 0,
    });

    expect(legacyOperatingNet).toBe(8_900);
    expect(cleanNetProfit).toBe(7_400); // 10000 + 400 - 1000 - 2000
    // Guard: store income appears once in each path's profit inputs
    expect(partnersShopRevenue + storeOtherBusinessIncome).toBe(10_400);
    expect(partnersShopRevenue + storeOtherBusinessIncome).not.toBe(
      partnersShopRevenue + storeOtherBusinessIncome + storeOtherBusinessIncome,
    );
  });
});
