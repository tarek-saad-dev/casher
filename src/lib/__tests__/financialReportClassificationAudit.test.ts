import { describe, it, expect } from 'vitest';
import {
  classifyCashMoveForFinancialAudit,
  classifyCategoryForFinancialAudit,
  READ_ONLY_FINANCIAL_AUDIT_GUARD,
  EMPLOYEE_FUNDING_CATEGORY_NAME,
  PAYOUT_EXPENSE_CATEGORY_NAME,
} from '@/lib/accounting/financialReportClassificationAudit';

describe('READ_ONLY_FINANCIAL_AUDIT_GUARD', () => {
  it('disallows all writes', () => {
    expect(READ_ONLY_FINANCIAL_AUDIT_GUARD.allowWrites).toBe(false);
    expect(READ_ONLY_FINANCIAL_AUDIT_GUARD.allowCashMoveUpdates).toBe(false);
    expect(READ_ONLY_FINANCIAL_AUDIT_GUARD.allowLedgerUpdates).toBe(false);
  });
});

describe('classifyCategoryForFinancialAudit', () => {
  it('classifies payout category as employee_payout', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 1,
      categoryName: PAYOUT_EXPENSE_CATEGORY_NAME,
      expInType: 'مصروفات',
      txnKind: null,
      mappedEmpId: null,
    });
    expect(r.expenseClass).toBe('employee_payout');
    expect(r.ledgerCashClass).toBe('payout');
    expect(r.countsAsOperatingExpense).toBe(false);
  });

  it('classifies advance mapping TxnKind=advance as employee_advance', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 2,
      categoryName: 'سلف(احمد)',
      expInType: 'مصروفات',
      txnKind: 'advance',
      mappedEmpId: 3,
    });
    expect(r.expenseClass).toBe('employee_advance');
    expect(r.ledgerCashClass).toBe('advance');
  });

  it('classifies employee funding as non_revenue_cash_in', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 3,
      categoryName: EMPLOYEE_FUNDING_CATEGORY_NAME,
      expInType: 'ايرادات',
      txnKind: null,
      mappedEmpId: null,
    });
    expect(r.revenueClass).toBe('non_revenue_cash_in');
    expect(r.ledgerCashClass).toBe('employee_funding');
    expect(r.countsAsRealRevenue).toBe(false);
  });

  it('classifies advance repayment income as non_revenue_cash_in', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 4,
      categoryName: 'رد سلفة موظف',
      expInType: 'ايرادات',
      txnKind: null,
      mappedEmpId: 5,
    });
    expect(r.revenueClass).toBe('non_revenue_cash_in');
    expect(r.ledgerCashClass).toBe('advance_repayment');
    expect(r.countsAsRealRevenue).toBe(false);
  });

  it('classifies employee revenue map as legacy mirror category', () => {
    const r = classifyCategoryForFinancialAudit({
      expInId: 5,
      categoryName: 'إيراد محمد',
      expInType: 'ايرادات',
      txnKind: 'revenue',
      mappedEmpId: 7,
    });
    expect(r.revenueClass).toBe('legacy_employee_income_mirror');
    expect(r.countsAsRealRevenue).toBe(false);
  });
});

describe('classifyCashMoveForFinancialAudit', () => {
  it('classifies sales invType as sales_revenue', () => {
    const r = classifyCashMoveForFinancialAudit({
      invType: 'مبيعات',
      inOut: 'in',
      categoryName: null,
      isPayrollDeduction: false,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: null,
    });
    expect(r.revenueClass).toBe('sales_revenue');
    expect(r.countsAsRealRevenue).toBe(true);
  });

  it('classifies legacy payroll income mirror flag separately', () => {
    const r = classifyCashMoveForFinancialAudit({
      invType: 'ايرادات',
      inOut: 'in',
      categoryName: 'إيراد موظف',
      isPayrollDeduction: false,
      isEmployeePayrollIncome: true,
      txnKind: 'revenue',
      empIdFromMap: 7,
      empId: 7,
    });
    expect(r.revenueClass).toBe('legacy_employee_income_mirror');
    expect(r.countsAsRealRevenue).toBe(false);
  });

  it('classifies legacy payroll expense flag', () => {
    const r = classifyCashMoveForFinancialAudit({
      invType: 'مصروفات',
      inOut: 'out',
      categoryName: 'يوميات الموظفين',
      isPayrollDeduction: true,
      isEmployeePayrollIncome: false,
      txnKind: null,
      empIdFromMap: null,
      empId: 7,
    });
    expect(r.expenseClass).toBe('legacy_payroll_expense');
    expect(r.countsAsOperatingExpense).toBe(false);
  });

  it('does not imply TblCashMove writes', () => {
    expect(READ_ONLY_FINANCIAL_AUDIT_GUARD.allowCashMoveUpdates).toBe(false);
  });
});
