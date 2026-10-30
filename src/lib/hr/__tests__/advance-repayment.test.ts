import { describe, expect, it } from 'vitest';
import { getMaxEmployeeAdvanceRepayment } from '@/lib/hr/advance-repayment';
import { computePartnersAdvanceExcess } from '@/lib/hr/employee-withdrawal-buckets';
import { classifyCashMoveForReport, computeCleanNetProfit, createEmptyClassifiedTotals } from '@/lib/accounting/financialReportClassification';

describe('employee advance repayments in month-close reports', () => {
  it('caps collection to the smallest outstanding branch/month debt', () => {
    expect(getMaxEmployeeAdvanceRepayment(-1881.6, -1881.6)).toBe(1881.6);
    expect(getMaxEmployeeAdvanceRepayment(-500, -1881.6)).toBe(500);
    expect(getMaxEmployeeAdvanceRepayment(100, -1881.6)).toBe(0);
    expect(getMaxEmployeeAdvanceRepayment(-500, 200)).toBe(0);
    expect(getMaxEmployeeAdvanceRepayment(NaN, -1000)).toBe(0);
  });

  it('reduces legacy operating cash-flow deficit without reclassifying salary', () => {
    const base = {
      advanceDebits: 3500, payoutDebits: 0,
      salaryAndTarget: 1618.4, fundingCredits: 0,
    };
    expect(computePartnersAdvanceExcess(base)).toBe(1881.6);
    expect(computePartnersAdvanceExcess({ ...base, fundingCredits: 1881.6 })).toBe(0);
    expect(computePartnersAdvanceExcess({ ...base, fundingCredits: 1000 })).toBe(881.6);
  });

  it('classifies repayment cash-in as non-revenue, leaving clean profit unchanged', () => {
    const row = classifyCashMoveForReport({
      invType: 'ايرادات', inOut: 'in', amount: 1881.6,
      categoryName: 'سداد سلفة موظف',
      isPayrollDeduction: false, isEmployeePayrollIncome: false,
      txnKind: null, empIdFromMap: null, empId: 12,
    });
    expect(row.revenueClass).toBe('non_revenue_cash_in');
    expect(row.ledgerCashClass).toBe('advance_repayment');
    const profit = createEmptyClassifiedTotals();
    profit.salesRevenue = 20000;
    profit.payrollExpenseFromLedger = 8000;
    const before = computeCleanNetProfit(profit);
    profit.nonRevenueCashIn += 1881.6;
    expect(computeCleanNetProfit(profit)).toBe(before);
  });
});
