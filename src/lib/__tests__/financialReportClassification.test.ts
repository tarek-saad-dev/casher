import { describe, it, expect } from 'vitest';
import {
  aggregateClassifiedCashMoves,
  classifyCashMoveForReport,
  computeCleanNetProfit,
  createEmptyClassifiedTotals,
  getCashMoveClassificationBucket,
  isRealRevenue,
  isProfitExpense,
  isEmployeeLedgerRelated,
} from '@/lib/accounting/financialReportClassification';
import {
  EMPLOYEE_FUNDING_CATEGORY_NAME,
  PAYOUT_EXPENSE_CATEGORY_NAME,
} from '@/lib/accounting/financialReportClassificationAudit';

describe('financialReportClassification', () => {
  it('uses audit category constants for classification', () => {
    expect(EMPLOYEE_FUNDING_CATEGORY_NAME).toBe('تمويل من موظف');
    expect(PAYOUT_EXPENSE_CATEGORY_NAME).toBe('صرف مستحقات الموظفين');
  });

  it('classifies employee funding as nonRevenueCashIn bucket', () => {
    const audit = classifyCashMoveForReport({
      invType: 'ايرادات',
      inOut: 'in',
      amount: 500,
      categoryName: EMPLOYEE_FUNDING_CATEGORY_NAME,
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: null,
    });
    expect(getCashMoveClassificationBucket(audit, 'in')).toBe('nonRevenueCashIn');
    expect(isRealRevenue(audit)).toBe(false);
  });

  it('classifies advance repayment as nonRevenueCashIn', () => {
    const audit = classifyCashMoveForReport({
      invType: 'ايرادات',
      inOut: 'in',
      amount: 200,
      categoryName: 'رد سلفة موظف',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: 3,
      empId: 3,
    });
    expect(getCashMoveClassificationBucket(audit, 'in')).toBe('nonRevenueCashIn');
  });

  it('classifies employee mapped income mirror', () => {
    const audit = classifyCashMoveForReport({
      invType: 'ايرادات',
      inOut: 'in',
      amount: 300,
      categoryName: 'إيراد محمد',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: true,
      txnKind: 'revenue',
      empIdFromMap: 7,
      empId: 7,
    });
    expect(getCashMoveClassificationBucket(audit, 'in')).toBe('legacyEmployeeIncomeMirror');
    expect(isRealRevenue(audit)).toBe(false);
  });

  it('classifies employee advance expense', () => {
    const audit = classifyCashMoveForReport({
      invType: 'مصروفات',
      inOut: 'out',
      amount: 150,
      categoryName: 'سلف(احمد)',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: 'advance',
      empIdFromMap: 3,
      empId: 3,
    });
    expect(getCashMoveClassificationBucket(audit, 'out')).toBe('employeeAdvances');
    expect(isProfitExpense(audit)).toBe(false);
  });

  it('classifies employee payout expense', () => {
    const audit = classifyCashMoveForReport({
      invType: 'مصروفات',
      inOut: 'out',
      amount: 400,
      categoryName: PAYOUT_EXPENSE_CATEGORY_NAME,
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: null,
    });
    expect(getCashMoveClassificationBucket(audit, 'out')).toBe('employeePayouts');
    expect(isProfitExpense(audit)).toBe(false);
  });

  it('classifies internal transfer out', () => {
    const audit = classifyCashMoveForReport({
      invType: 'مصروفات',
      inOut: 'out',
      amount: 100,
      categoryName: 'تحويلات',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: null,
    });
    expect(getCashMoveClassificationBucket(audit, 'out')).toBe('internalTransfers');
  });

  it('puts unknown inflow into uncategorizedCashIn', () => {
    const audit = classifyCashMoveForReport({
      invType: 'unknown',
      inOut: 'in',
      amount: 50,
      categoryName: '',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: null,
    });
    expect(getCashMoveClassificationBucket(audit, 'in')).toBe('uncategorizedCashIn');
  });

  it('aggregates classified totals and clean net profit', () => {
    const { classifiedTotals } = aggregateClassifiedCashMoves([
      {
        invType: 'مبيعات',
        inOut: 'in',
        amount: 1000,
        categoryName: null,
        isPayrollDeduction: false,
        isEmployeePayrollIncome: false,
        txnKind: null,
        empIdFromMap: null,
        empId: null,
      },
      {
        invType: 'ايرادات',
        inOut: 'in',
        amount: 200,
        categoryName: EMPLOYEE_FUNDING_CATEGORY_NAME,
        isPayrollDeduction: false,
        isEmployeePayrollIncome: false,
        txnKind: null,
        empIdFromMap: null,
        empId: null,
      },
      {
        invType: 'مصروفات',
        inOut: 'out',
        amount: 300,
        categoryName: 'إيجار',
        isPayrollDeduction: false,
        isEmployeePayrollIncome: false,
        txnKind: null,
        empIdFromMap: null,
        empId: null,
      },
      {
        invType: 'مصروفات',
        inOut: 'out',
        amount: 100,
        categoryName: PAYOUT_EXPENSE_CATEGORY_NAME,
        isPayrollDeduction: false,
        isEmployeePayrollIncome: false,
        txnKind: null,
        empIdFromMap: null,
        empId: null,
      },
    ]);

    classifiedTotals.payrollExpenseFromLedger = 250;
    classifiedTotals.cleanNetProfit = computeCleanNetProfit(classifiedTotals);

    expect(classifiedTotals.salesRevenue).toBe(1000);
    expect(classifiedTotals.nonRevenueCashIn).toBe(200);
    expect(classifiedTotals.operatingExpense).toBe(300);
    expect(classifiedTotals.employeePayouts).toBe(100);
    expect(classifiedTotals.cleanNetProfit).toBe(450);
    expect(classifiedTotals.cashInTotal).toBe(1200);
    expect(classifiedTotals.cashOutTotal).toBe(400);
  });

  it('employee payout is not payroll expense from ledger', () => {
    const totals = createEmptyClassifiedTotals();
    totals.employeePayouts = 500;
    totals.payrollExpenseFromLedger = 800;
    totals.salesRevenue = 2000;
    totals.operatingExpense = 400;
    totals.cleanNetProfit = computeCleanNetProfit(totals);
    expect(totals.cleanNetProfit).toBe(800);
  });

  it('marks employee ledger related rows', () => {
    const audit = classifyCashMoveForReport({
      invType: 'مصروفات',
      inOut: 'out',
      amount: 100,
      categoryName: 'سلف',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: 'advance',
      empIdFromMap: 2,
      empId: 2,
    });
    expect(isEmployeeLedgerRelated(audit)).toBe(true);
  });
});
