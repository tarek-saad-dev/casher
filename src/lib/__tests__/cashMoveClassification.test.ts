import { describe, it, expect } from 'vitest';
import {
  classifyCashMove,
  normalizeForMatch,
  summarizeClassifications,
  type CashMoveClassificationInput,
} from '@/lib/accounting/cashMoveClassification';

function baseInput(
  overrides: Partial<CashMoveClassificationInput> = {},
): CashMoveClassificationInput {
  return {
    cashMoveId: 1,
    invDate: '2026-03-01',
    amount: 500,
    inOut: 'in',
    invType: 'مصروفات',
    expInId: 10,
    categoryName: null,
    notes: null,
    empId: null,
    isPayrollDeduction: false,
    isEmployeePayrollIncome: false,
    linkedPayrollTxn: null,
    empIdFromCategoryMap: null,
    ...overrides,
  };
}

describe('normalizeForMatch', () => {
  it('normalizes Arabic alef and ta marbuta variants', () => {
    expect(normalizeForMatch('سلفة')).toContain('سلف');
    expect(normalizeForMatch('رأس مال')).toContain('راس');
  });
});

describe('classifyCashMove', () => {
  it('classifies sales invoices as sales revenue', () => {
    const result = classifyCashMove(baseInput({ invType: 'مبيعات', inOut: 'in', amount: 1200 }));
    expect(result.suggestedFlowGroup).toBe('sales');
    expect(result.suggestedFlowKind).toBe('sales_revenue');
    expect(result.suggestedPnlImpact).toBe('revenue');
    expect(result.confidence).toBe('high');
    expect(result.needsReview).toBe(false);
  });

  it('classifies advance categories as employee_advance', () => {
    const result = classifyCashMove(
      baseInput({ categoryName: 'سلف الموظفين', inOut: 'out', empId: 7 }),
    );
    expect(result.suggestedFlowGroup).toBe('employee_advance');
    expect(result.suggestedFlowKind).toBe('employee_advance_out');
    expect(result.suggestedPartyType).toBe('employee');
    expect(result.suggestedEmpId).toBe(7);
    expect(result.needsReview).toBe(false);
  });

  it('flags employee payroll rows missing EmpID for review', () => {
    const result = classifyCashMove(
      baseInput({ categoryName: 'مرتبات', inOut: 'out' }),
    );
    expect(result.suggestedFlowKind).toBe('salary_payout');
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe('medium');
  });

  it('classifies deductions as contra_expense', () => {
    const result = classifyCashMove(
      baseInput({ categoryName: 'خصم غياب', empId: 3, inOut: 'in' }),
    );
    expect(result.suggestedFlowKind).toBe('salary_deduction');
    expect(result.suggestedPnlImpact).toBe('contra_expense');
  });

  it('classifies transfers with no PnL impact', () => {
    const result = classifyCashMove(
      baseInput({ categoryName: 'تحويلات بين طرق الدفع', inOut: 'out' }),
    );
    expect(result.suggestedFlowGroup).toBe('transfer');
    expect(result.suggestedPnlImpact).toBe('none');
  });

  it('marks unclassified rows for review', () => {
    const result = classifyCashMove(
      baseInput({ invType: 'حركة غير معروفة', categoryName: null }),
    );
    expect(result.suggestedFlowGroup).toBe('unclassified');
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe('low');
  });

  it('uses linked TblEmpPayrollTxn for salary classification', () => {
    const result = classifyCashMove(
      baseInput({
        linkedPayrollTxn: {
          source: 'TblEmpPayrollTxn',
          id: 99,
          empId: 12,
          txnType: 'salary',
        },
      }),
    );
    expect(result.suggestedFlowGroup).toBe('payroll');
    expect(result.suggestedEmpId).toBe(12);
    expect(result.confidence).toBe('high');
  });
});

describe('summarizeClassifications', () => {
  it('aggregates totals by flow group and needsReview', () => {
    const rows = [
      classifyCashMove(baseInput({ cashMoveId: 1, invType: 'مبيعات', amount: 100, inOut: 'in' })),
      classifyCashMove(
        baseInput({ cashMoveId: 2, categoryName: 'سلفة', amount: 50, inOut: 'out', empId: 1 }),
      ),
    ];
    const summary = summarizeClassifications(rows);
    expect(summary.totalRows).toBe(2);
    expect(summary.byFlowGroup.find((b) => b.key === 'sales')?.count).toBe(1);
    expect(summary.byFlowGroup.find((b) => b.key === 'employee_advance')?.count).toBe(1);
    expect(summary.byNeedsReview.some((b) => b.key === 'false')).toBe(true);
  });
});
