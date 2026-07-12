import { describe, it, expect } from 'vitest';
import {
  LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD,
  buildLegacyEmployeeMirrorReview,
  classifyLegacyMirrorConfidence,
  enrichLegacyMirrorRow,
  isLegacyEmployeeIncomeMirrorCandidate,
  summarizeLegacyEmployeeMirrorRows,
  type LegacyMirrorRowInput,
} from '@/lib/accounting/legacyEmployeeMirrorReview';

function baseRow(overrides: Partial<LegacyMirrorRowInput> = {}): LegacyMirrorRowInput {
  return {
    cashMoveId: 1,
    date: '2026-07-10',
    amount: 100,
    invType: 'ايرادات',
    inOut: 'in',
    categoryId: 10,
    categoryName: 'إيراد محمد',
    paymentMethod: 'نقدي',
    notes: null,
    empId: 7,
    empName: 'محمد',
    mappedEmpId: 7,
    mappedEmpName: 'محمد',
    txnKind: 'revenue',
    isEmployeePayrollIncome: false,
    isPayrollDeduction: false,
    ...overrides,
  };
}

describe('LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD', () => {
  it('disallows writes', () => {
    expect(LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD.allowWrites).toBe(false);
    expect(LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD.allowCashMoveUpdates).toBe(false);
    expect(LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD.allowLedgerUpdates).toBe(false);
  });
});

describe('legacyEmployeeMirrorReview', () => {
  it('classifies mapped employee revenue income as high-confidence mirror', () => {
    const row = baseRow();
    expect(isLegacyEmployeeIncomeMirrorCandidate(row)).toBe(true);
    const conf = classifyLegacyMirrorConfidence(row);
    expect(conf.confidence).toBe('high');
    const enriched = enrichLegacyMirrorRow(row);
    expect(enriched?.includedInCleanProfit).toBe(false);
    expect(enriched?.classificationBucket).toBe('legacyEmployeeIncomeMirror');
  });

  it('classifies payroll income flag as high confidence', () => {
    const conf = classifyLegacyMirrorConfidence(
      baseRow({
        txnKind: null,
        mappedEmpId: null,
        isEmployeePayrollIncome: true,
        categoryName: 'إيراد موظف',
      }),
    );
    expect(conf.confidence).toBe('high');
  });

  it('classifies employee-like income without mapping as medium', () => {
    const row = baseRow({
      txnKind: null,
      mappedEmpId: null,
      empId: null,
      isEmployeePayrollIncome: true, // still a mirror candidate via flag
      categoryName: 'إيراد موظف بدون ماب',
    });
    // With flag it is high — medium case needs to NOT be a candidate via flag
    // Medium is for enrich path when candidate via name alone — but candidate requires
    // classifyCashMove audit. Employee-like without flag/txnKind may not be candidate.
    // Spec: medium = employee-like income category without mapping
    // For medium confidence on a candidate, use isEmployeePayrollIncome so it's a candidate
    // but wait - that makes high. Looking at classifyLegacyMirrorConfidence:
    // medium when nameLooksEmployee && !hasMapping && !hasPayrollIncomeFlag
    // But isLegacyEmployeeIncomeMirrorCandidate requires audit revenueClass mirror
    // which needs flag OR txnKind revenue.
    // So medium confidence on actual mirror candidates is rare unless we have
    // a path where audit says mirror but confidence is medium.
    // Looking at audit: txnKind revenue => legacy_employee_income_mirror
    // So txnKind=revenue with incomplete emp mapping:
    const mediumRow = baseRow({
      txnKind: 'revenue',
      mappedEmpId: null,
      empId: null,
      isEmployeePayrollIncome: false,
      categoryName: 'إيراد موظف',
    });
    expect(isLegacyEmployeeIncomeMirrorCandidate(mediumRow)).toBe(true);
    // hasMapping requires txnKind revenue AND (mappedEmpId or empId) — both null => !hasMapping
    // nameLooksEmployee true => medium
    expect(classifyLegacyMirrorConfidence(mediumRow).confidence).toBe('medium');
  });

  it('excludes unrelated income rows', () => {
    const row = baseRow({
      categoryName: 'إيجار محل',
      txnKind: null,
      mappedEmpId: null,
      empId: null,
      isEmployeePayrollIncome: false,
    });
    expect(isLegacyEmployeeIncomeMirrorCandidate(row)).toBe(false);
    expect(enrichLegacyMirrorRow(row)).toBeNull();
  });

  it('summarizes by employee and category', () => {
    const review = buildLegacyEmployeeMirrorReview({
      month: '2026-07',
      rows: [
        baseRow({ cashMoveId: 1, amount: 200, mappedEmpId: 7, mappedEmpName: 'محمد', categoryName: 'إيراد محمد' }),
        baseRow({ cashMoveId: 2, amount: 50, mappedEmpId: 7, mappedEmpName: 'محمد', categoryName: 'إيراد محمد' }),
        baseRow({
          cashMoveId: 3,
          amount: 100,
          mappedEmpId: 3,
          mappedEmpName: 'أحمد',
          empId: 3,
          empName: 'أحمد',
          categoryName: 'إيراد أحمد',
          categoryId: 11,
        }),
      ],
    });

    expect(review.summary.totalAmount).toBe(350);
    expect(review.summary.rowCount).toBe(3);
    expect(review.summary.byEmployee[0].empName).toBe('محمد');
    expect(review.summary.byEmployee[0].total).toBe(250);
    expect(review.summary.byCategory.length).toBeGreaterThan(0);
    expect(review.includedInCleanProfit).toBe(false);
    expect(review.rows.every((r) => r.includedInCleanProfit === false)).toBe(true);
  });

  it('includedInCleanProfit is always false on reviewed rows', () => {
    const rows = [
      enrichLegacyMirrorRow(baseRow({ isEmployeePayrollIncome: true }))!,
      enrichLegacyMirrorRow(baseRow({ cashMoveId: 2, amount: 40 }))!,
    ];
    const summary = summarizeLegacyEmployeeMirrorRows(rows);
    expect(summary.rowCount).toBe(2);
    expect(rows.every((r) => r.includedInCleanProfit === false)).toBe(true);
  });
});
