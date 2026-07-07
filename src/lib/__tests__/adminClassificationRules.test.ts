import { describe, it, expect } from 'vitest';
import {
  classifyCashMove,
  emptySettingsBundle,
  type CashMoveClassificationInput,
} from '@/lib/accounting/cashMoveClassification';
import type {
  CategoryClassificationMap,
  ClassificationSettingsBundle,
  EmployeeAlias,
  KeywordClassificationRule,
} from '@/lib/accounting/accountingSettingsTypes';

function baseInput(overrides: Partial<CashMoveClassificationInput> = {}): CashMoveClassificationInput {
  return {
    cashMoveId: 1,
    invDate: '2026-03-01',
    amount: 500,
    inOut: 'out',
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

function categoryMapping(overrides: Partial<CategoryClassificationMap>): CategoryClassificationMap {
  return {
    id: 1,
    expInId: 10,
    catName: 'بوفيه',
    flowGroup: 'operating',
    flowKind: 'operating_expense',
    pnlImpact: 'expense',
    partyType: 'none',
    requiresEmployee: false,
    needsReviewByDefault: false,
    confidence: 'high',
    notes: null,
    isActive: true,
    ...overrides,
  };
}

function buildSettings(partial: {
  categories?: CategoryClassificationMap[];
  keywords?: KeywordClassificationRule[];
  aliases?: EmployeeAlias[];
  employees?: { empId: number; empName: string }[];
}): ClassificationSettingsBundle {
  const categoryMappingsByExpInId = new Map<number, CategoryClassificationMap>();
  for (const c of partial.categories ?? []) {
    categoryMappingsByExpInId.set(c.expInId, c);
  }
  return {
    categoryMappingsByExpInId,
    keywordRules: partial.keywords ?? [],
    employeeAliases: partial.aliases ?? [],
    employees: partial.employees ?? [],
    loaded: true,
  };
}

describe('admin classification rules', () => {
  it('category mapping overrides fallback for بوفيه', () => {
    const settings = buildSettings({
      categories: [categoryMapping({ expInId: 10, catName: 'بوفيه' })],
    });
    const result = classifyCashMove(
      baseInput({ expInId: 10, categoryName: 'بوفيه' }),
      settings,
    );
    expect(result.suggestedFlowGroup).toBe('operating');
    expect(result.confidence).toBe('high');
    expect(result.needsReview).toBe(false);
    expect(result.matchedRuleSource).toBe('category_mapping');
    expect(result.fromAdminMapping).toBe(true);
  });

  it('كهرباء and بضاعة via admin mapping', () => {
    for (const [id, name] of [[11, 'كهرباء'], [12, 'بضاعة']] as const) {
      const settings = buildSettings({
        categories: [categoryMapping({ expInId: id, catName: name })],
      });
      const result = classifyCashMove(baseInput({ expInId: id, categoryName: name }), settings);
      expect(result.confidence).toBe('high');
      expect(result.needsReview).toBe(false);
      expect(result.suggestedFlowKind).toBe('operating_expense');
    }
  });

  it('تبس => tips_collected with review', () => {
    const settings = buildSettings({
      categories: [
        categoryMapping({
          expInId: 20,
          catName: 'تبس',
          flowGroup: 'tips',
          flowKind: 'tips_collected',
          pnlImpact: 'none',
          partyType: 'employee_or_unknown',
          needsReviewByDefault: true,
          confidence: 'medium',
        }),
      ],
    });
    const result = classifyCashMove(
      baseInput({ expInId: 20, categoryName: 'تبس', inOut: 'in', invType: 'ايرادات' }),
      settings,
    );
    expect(result.suggestedFlowKind).toBe('tips_collected');
    expect(result.suggestedPnlImpact).toBe('none');
    expect(result.needsReview).toBe(true);
  });

  it('سد ذياد => capital loan_to_business, no PnL, category mapping beats سد keyword', () => {
    const settings = buildSettings({
      categories: [
        categoryMapping({
          expInId: 30,
          catName: 'سد ذياد',
          flowGroup: 'capital',
          flowKind: 'loan_to_business',
          pnlImpact: 'none',
          partyType: 'partner',
          requiresEmployee: false,
          needsReviewByDefault: false,
          confidence: 'high',
          notes: 'فلوس داخلة من شريك/طرف للمحل ولا تؤثر على الربح',
        }),
      ],
      keywords: [{
        id: 1, keyword: 'سد', matchTarget: 'both', matchMode: 'contains',
        flowGroup: 'employee_advance', flowKind: 'employee_advance_repayment',
        pnlImpact: 'contra_expense', partyType: 'employee',
        requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium',
        priority: 20, isActive: true,
      }],
      aliases: [{ id: 1, empId: 3, aliasText: 'ذياد', isActive: true, empName: 'Zeyad' }],
      employees: [{ empId: 3, empName: 'Zeyad' }],
    });
    const result = classifyCashMove(
      baseInput({ expInId: 30, categoryName: 'سد ذياد', inOut: 'in', invType: 'ايرادات' }),
      settings,
    );
    expect(result.suggestedFlowGroup).toBe('capital');
    expect(result.suggestedFlowKind).toBe('loan_to_business');
    expect(result.suggestedPnlImpact).toBe('none');
    expect(result.needsReview).toBe(false);
    expect(result.confidence).toBe('high');
    expect(result.matchedRuleSource).toBe('category_mapping');
    expect(result.suggestedEmpId).toBeNull();
    expect(result.reason).toContain('لا تؤثر على الربح');
  });

  it('طارق => capital loan_to_business, no PnL', () => {
    const settings = buildSettings({
      categories: [
        categoryMapping({
          expInId: 31,
          catName: 'طارق',
          flowGroup: 'capital',
          flowKind: 'loan_to_business',
          pnlImpact: 'none',
          partyType: 'partner_or_person',
          requiresEmployee: false,
          needsReviewByDefault: false,
          confidence: 'high',
          notes: 'فلوس داخلة من شخص/طرف للمحل ولا تؤثر على الربح',
        }),
      ],
    });
    const result = classifyCashMove(
      baseInput({ expInId: 31, categoryName: 'طارق', inOut: 'in', invType: 'ايرادات' }),
      settings,
    );
    expect(result.suggestedFlowGroup).toBe('capital');
    expect(result.suggestedFlowKind).toBe('loan_to_business');
    expect(result.suggestedPnlImpact).toBe('none');
    expect(result.needsReview).toBe(false);
    expect(result.confidence).toBe('high');
  });

  it('تارجت(كريم) with alias => bonus with employee', () => {
    const settings = buildSettings({
      keywords: [{
        id: 2, keyword: 'تارجت', matchTarget: 'both', matchMode: 'contains',
        flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout',
        pnlImpact: 'expense', partyType: 'employee',
        requiresEmployee: true, needsReviewByDefault: false, confidence: 'high',
        priority: 40, isActive: true,
      }],
      aliases: [{ id: 2, empId: 4, aliasText: 'كريم', isActive: true }],
      employees: [{ empId: 4, empName: 'Kareem' }],
    });
    const result = classifyCashMove(
      baseInput({ categoryName: 'تارجت(كريم)' }),
      settings,
    );
    expect(result.suggestedFlowKind).toBe('bonus_or_commission_payout');
    expect(result.suggestedEmpId).toBe(4);
    expect(result.needsReview).toBe(false);
  });

  it('assets + notes يوميه عامل قديم => employee final settlement', () => {
    const settings = buildSettings({
      keywords: [
        {
          id: 3, keyword: 'يوميه عامل قديم', matchTarget: 'both', matchMode: 'contains',
          flowGroup: 'payroll', flowKind: 'employee_final_settlement',
          pnlImpact: 'expense', partyType: 'employee',
          requiresEmployee: false, needsReviewByDefault: true, confidence: 'medium',
          priority: 28, isActive: true,
        },
        {
          id: 4, keyword: 'يوميه', matchTarget: 'notes', matchMode: 'contains',
          flowGroup: 'payroll', flowKind: 'salary_payout',
          pnlImpact: 'expense', partyType: 'employee',
          requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium',
          priority: 33, isActive: true,
        },
      ],
    });
    const result = classifyCashMove(
      baseInput({ categoryName: 'assets', notes: 'يوميه عامل قديم' }),
      settings,
    );
    expect(result.suggestedFlowKind).toBe('employee_final_settlement');
    expect(result.suggestedPnlImpact).toBe('expense');
    expect(result.needsReview).toBe(true);
    expect(result.suggestedEmpId).toBeNull();
    expect(result.reason).toContain('تصفية حساب موظف قديم');
  });

  it('keyword priority: higher priority rule wins', () => {
    const settings = buildSettings({
      keywords: [
        {
          id: 1, keyword: 'سد', matchTarget: 'both', matchMode: 'contains',
          flowGroup: 'employee_advance', flowKind: 'employee_advance_repayment',
          pnlImpact: 'contra_expense', partyType: 'employee',
          requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium',
          priority: 10, isActive: true,
        },
        {
          id: 2, keyword: 'سداد', matchTarget: 'both', matchMode: 'contains',
          flowGroup: 'transfer', flowKind: 'internal_transfer',
          pnlImpact: 'none', partyType: 'internal',
          requiresEmployee: false, needsReviewByDefault: false, confidence: 'high',
          priority: 100, isActive: true,
        },
      ],
    });
    const result = classifyCashMove(baseInput({ categoryName: 'سداد ذياد' }), settings);
    expect(result.suggestedFlowGroup).toBe('employee_advance');
    expect(result.matchedKeyword).toBe('سد');
  });

  it('inactive keyword rules are ignored', () => {
    const settings = buildSettings({
      keywords: [{
        id: 1, keyword: 'بوفيه', matchTarget: 'category', matchMode: 'contains',
        flowGroup: 'transfer', flowKind: 'internal_transfer',
        pnlImpact: 'none', partyType: 'internal',
        requiresEmployee: false, needsReviewByDefault: false, confidence: 'high',
        priority: 1, isActive: false,
      }],
    });
    const result = classifyCashMove(
      baseInput({ categoryName: 'بوفيه' }),
      settings,
    );
    expect(result.matchedRuleSource).not.toBe('keyword_rule');
  });
});
