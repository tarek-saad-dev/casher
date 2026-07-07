import { describe, it, expect } from 'vitest';
import {
  assignLabBucket,
  computeReadiness,
  getRiskTypes,
  isRiskyRow,
} from '@/lib/accounting/classificationLabMetrics';
import {
  classifyCashMove,
  summarizeClassifications,
  type CashMoveClassificationInput,
} from '@/lib/accounting/cashMoveClassification';

function row(overrides: Partial<CashMoveClassificationInput> = {}) {
  return classifyCashMove({
    cashMoveId: 1,
    invDate: '2026-03-01',
    amount: 100,
    inOut: 'out',
    invType: 'مصروفات',
    expInId: 1,
    categoryName: null,
    notes: null,
    empId: null,
    isPayrollDeduction: false,
    isEmployeePayrollIncome: false,
    linkedPayrollTxn: null,
    empIdFromCategoryMap: null,
    ...overrides,
  });
}

describe('classificationLabMetrics', () => {
  it('assigns sales bucket', () => {
    const r = row({ invType: 'مبيعات', inOut: 'in' });
    expect(assignLabBucket(r)).toBe('sales');
  });

  it('computes readiness from summary', () => {
    const rows = [
      row({ cashMoveId: 1, invType: 'مبيعات', inOut: 'in' }),
      row({ cashMoveId: 2, categoryName: 'مرتبات', empId: 5 }),
    ];
    const summary = summarizeClassifications(rows);
    const readiness = computeReadiness(rows, summary);
    expect(readiness.score).toBeGreaterThanOrEqual(0);
    expect(readiness.score).toBeLessThanOrEqual(100);
  });

  it('flags risky payroll without employee', () => {
    const r = row({ categoryName: 'مرتبات' });
    expect(isRiskyRow(r)).toBe(true);
    expect(getRiskTypes(r)).toContain('missing_employee');
  });
});
