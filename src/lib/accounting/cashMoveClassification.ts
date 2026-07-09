/**
 * Read-only accounting classification heuristics for TblCashMove rows.
 * Supports admin-controlled mappings/rules via ClassificationSettingsBundle.
 */

import type {
  ClassificationSettingsBundle,
  KeywordClassificationRule,
  MatchedRuleSource,
} from './accountingSettingsTypes';
import { emptySettingsBundle } from './accountingSettingsTypes';

export type ClassificationConfidence = 'high' | 'medium' | 'low';

export type PnlImpact = 'revenue' | 'expense' | 'contra_expense' | 'none';

export type PartyType =
  | 'customer'
  | 'employee'
  | 'partner'
  | 'partner_or_person'
  | 'internal'
  | 'unknown'
  | 'none'
  | 'employee_or_unknown';

export interface LinkedPayrollTxn {
  source: 'TblEmpPayrollTxn' | 'TblEmpDailyPayroll';
  id: number;
  empId: number;
  empName?: string | null;
  txnType?: string | null;
  linkRole?: 'expense' | 'income';
}

export interface CashMoveClassificationInput {
  cashMoveId: number;
  invDate: string;
  amount: number;
  inOut: string;
  invType: string;
  expInId: number | null;
  categoryName: string | null;
  notes: string | null;
  empId: number | null;
  isPayrollDeduction: boolean;
  isEmployeePayrollIncome: boolean;
  linkedPayrollTxn: LinkedPayrollTxn | null;
  empIdFromCategoryMap: number | null;
}

export interface CashMoveClassification {
  cashMoveId: number;
  invDate: string;
  amount: number;
  inOut: string;
  invType: string;
  expInId: number | null;
  categoryName: string | null;
  notes: string | null;
  linkedPayrollTxn: LinkedPayrollTxn | null;
  suggestedFlowGroup: string;
  suggestedFlowKind: string;
  suggestedPnlImpact: PnlImpact;
  suggestedPartyType: PartyType;
  suggestedEmpId: number | null;
  confidence: ClassificationConfidence;
  needsReview: boolean;
  reason: string;
  matchedRuleSource: MatchedRuleSource;
  matchedRuleId: number | null;
  matchedKeyword: string | null;
  fromAdminMapping: boolean;
}

interface RuleMatch {
  flowGroup: string;
  flowKind: string;
  pnlImpact: PnlImpact;
  partyType: PartyType;
  confidence: ClassificationConfidence;
  reason: string;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  matchedRuleSource: MatchedRuleSource;
  matchedRuleId: number | null;
  matchedKeyword: string | null;
  fromAdminMapping: boolean;
}

const SALES_INV_TYPES = new Set(['مبيعات', 'مبيعات بالكارت']);

const FALLBACK_CATEGORY_RULES: Array<{ patterns: string[]; match: Omit<RuleMatch, 'matchedRuleSource' | 'matchedRuleId' | 'matchedKeyword' | 'fromAdminMapping'> }> = [
  {
    patterns: ['تحويل', 'تحويلات', 'بين طرق الدفع'],
    match: {
      flowGroup: 'transfer', flowKind: 'internal_transfer', pnlImpact: 'none', partyType: 'internal',
      confidence: 'high', reason: 'فئة تحويل داخلي (افتراضي)', requiresEmployee: false, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['تمويل من موظف'],
    match: {
      flowGroup: 'employee_funding', flowKind: 'employee_funding_in', pnlImpact: 'none', partyType: 'employee',
      confidence: 'high', reason: 'تمويل من موظف للمحل — التزام وليس إيراد', requiresEmployee: true, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['شريك', 'رأس مال', 'راس مال', 'تمويل', 'ضخ'],
    match: {
      flowGroup: 'capital', flowKind: 'partner_capital_in', pnlImpact: 'none', partyType: 'partner',
      confidence: 'high', reason: 'فئة رأس مال (افتراضي)', requiresEmployee: false, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['خصم', 'غياب', 'تأخير'],
    match: {
      flowGroup: 'payroll', flowKind: 'salary_deduction', pnlImpact: 'contra_expense', partyType: 'employee',
      confidence: 'high', reason: 'فئة خصم/غياب (افتراضي)', requiresEmployee: true, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['سلف', 'سلفة', 'سلفه'],
    match: {
      flowGroup: 'employee_advance', flowKind: 'employee_advance_out', pnlImpact: 'expense', partyType: 'employee',
      confidence: 'high', reason: 'فئة سلفة (افتراضي)', requiresEmployee: true, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['تارجت', 'عمولة', 'بونص', 'bonus', 'commission'],
    match: {
      flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee',
      confidence: 'high', reason: 'فئة عمولة/بونص (افتراضي)', requiresEmployee: true, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['مرتب', 'راتب', 'مرتبات', 'يومية', 'يوميات', 'يوميه'],
    match: {
      flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee',
      confidence: 'high', reason: 'فئة مرتب/يومية (افتراضي)', requiresEmployee: true, needsReviewByDefault: false,
    },
  },
  {
    patterns: ['تبس', 'tips'],
    match: {
      flowGroup: 'tips', flowKind: 'tips_collected', pnlImpact: 'none', partyType: 'employee_or_unknown',
      confidence: 'medium', reason: 'تبس/إكراميات (افتراضي)', requiresEmployee: false, needsReviewByDefault: true,
    },
  },
];

export function normalizeForMatch(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/\u0640/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

function wrapFallback(match: Omit<RuleMatch, 'matchedRuleSource' | 'matchedRuleId' | 'matchedKeyword' | 'fromAdminMapping'>): RuleMatch {
  return {
    ...match,
    matchedRuleSource: 'fallback',
    matchedRuleId: null,
    matchedKeyword: null,
    fromAdminMapping: false,
  };
}

function matchKeywordRule(
  rule: KeywordClassificationRule,
  categoryText: string,
  notesText: string,
): boolean {
  const kw = normalizeForMatch(rule.keyword);
  if (!kw) return false;
  const cat = categoryText;
  const notes = notesText;
  const targets =
    rule.matchTarget === 'category' ? [cat]
    : rule.matchTarget === 'notes' ? [notes]
    : [cat, notes, `${cat} ${notes}`];

  return targets.some((t) => {
    if (!t) return false;
    if (rule.matchMode === 'exact') return t === kw;
    return t.includes(kw);
  });
}

function matchAdminKeywordRules(
  settings: ClassificationSettingsBundle,
  categoryText: string,
  notesText: string,
): RuleMatch | null {
  for (const rule of settings.keywordRules) {
    if (!rule.isActive) continue;
    if (!matchKeywordRule(rule, categoryText, notesText)) continue;
    return {
      flowGroup: rule.flowGroup,
      flowKind: rule.flowKind,
      pnlImpact: rule.pnlImpact,
      partyType: rule.partyType,
      confidence: rule.confidence,
      reason: rule.flowKind === 'employee_final_settlement'
        ? `تصفية حساب موظف قديم — كلمة مفتاحية: "${rule.keyword}"`
        : `قاعدة كلمة مفتاحية إدارية: "${rule.keyword}"`,
      requiresEmployee: rule.requiresEmployee,
      needsReviewByDefault: rule.needsReviewByDefault,
      matchedRuleSource: 'keyword_rule',
      matchedRuleId: rule.id,
      matchedKeyword: rule.keyword,
      fromAdminMapping: true,
    };
  }
  return null;
}

function matchAdminCategoryMapping(
  settings: ClassificationSettingsBundle,
  expInId: number | null,
): RuleMatch | null {
  if (expInId == null) return null;
  const mapping = settings.categoryMappingsByExpInId.get(expInId);
  if (!mapping || !mapping.isActive) return null;
  return {
    flowGroup: mapping.flowGroup,
    flowKind: mapping.flowKind,
    pnlImpact: mapping.pnlImpact,
    partyType: mapping.partyType,
    confidence: mapping.confidence,
    reason: mapping.notes?.trim()
      ? mapping.notes.trim()
      : `تعيين إداري للفئة${mapping.catName ? `: ${mapping.catName}` : ''}`,
    requiresEmployee: mapping.requiresEmployee,
    needsReviewByDefault: mapping.needsReviewByDefault,
    matchedRuleSource: 'category_mapping',
    matchedRuleId: mapping.id,
    matchedKeyword: null,
    fromAdminMapping: true,
  };
}

function matchFallbackCategoryRule(searchText: string): RuleMatch | null {
  for (const rule of FALLBACK_CATEGORY_RULES) {
    if (rule.patterns.some((p) => searchText.includes(normalizeForMatch(p)))) {
      return wrapFallback(rule.match);
    }
  }
  return null;
}

function classifySales(): RuleMatch {
  return {
    flowGroup: 'sales',
    flowKind: 'sales_revenue',
    pnlImpact: 'revenue',
    partyType: 'customer',
    confidence: 'high',
    reason: 'فاتورة مبيعات (invType = مبيعات)',
    requiresEmployee: false,
    needsReviewByDefault: false,
    matchedRuleSource: 'structural',
    matchedRuleId: null,
    matchedKeyword: null,
    fromAdminMapping: false,
  };
}

function classifyPayrollStructural(input: CashMoveClassificationInput): RuleMatch | null {
  if (input.isPayrollDeduction) {
    return {
      flowGroup: 'payroll', flowKind: 'salary_deduction', pnlImpact: 'contra_expense', partyType: 'employee',
      confidence: 'high', reason: 'حركة خصم مرتب (IsPayrollDeduction)', requiresEmployee: true, needsReviewByDefault: false,
      matchedRuleSource: 'structural', matchedRuleId: null, matchedKeyword: null, fromAdminMapping: false,
    };
  }
  if (input.isEmployeePayrollIncome) {
    return {
      flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'none', partyType: 'employee',
      confidence: 'medium', reason: 'مرآة إيراد يومية موظف (IsEmployeePayrollIncome)', requiresEmployee: true, needsReviewByDefault: false,
      matchedRuleSource: 'structural', matchedRuleId: null, matchedKeyword: null, fromAdminMapping: false,
    };
  }
  if (input.linkedPayrollTxn?.source === 'TblEmpDailyPayroll') {
    return {
      flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee',
      confidence: 'high', reason: 'مرتبط بيومية موظف (TblEmpDailyPayroll)', requiresEmployee: true, needsReviewByDefault: false,
      matchedRuleSource: 'structural', matchedRuleId: input.linkedPayrollTxn.id, matchedKeyword: null, fromAdminMapping: false,
    };
  }
  if (input.linkedPayrollTxn?.source === 'TblEmpPayrollTxn') {
    const txnType = input.linkedPayrollTxn.txnType ?? '';
    if (txnType === 'advance') {
      return {
        flowGroup: 'employee_advance', flowKind: 'employee_advance_out', pnlImpact: 'expense', partyType: 'employee',
        confidence: 'high', reason: 'مرتبط بمعاملة سلفة (TblEmpPayrollTxn)', requiresEmployee: true, needsReviewByDefault: false,
        matchedRuleSource: 'structural', matchedRuleId: input.linkedPayrollTxn.id, matchedKeyword: null, fromAdminMapping: false,
      };
    }
    if (txnType === 'deduction') {
      return {
        flowGroup: 'payroll', flowKind: 'salary_deduction', pnlImpact: 'contra_expense', partyType: 'employee',
        confidence: 'high', reason: 'مرتبط بمعاملة خصم (TblEmpPayrollTxn)', requiresEmployee: true, needsReviewByDefault: false,
        matchedRuleSource: 'structural', matchedRuleId: input.linkedPayrollTxn.id, matchedKeyword: null, fromAdminMapping: false,
      };
    }
    if (txnType === 'commission' || txnType === 'bonus') {
      return {
        flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee',
        confidence: 'high', reason: 'مرتبط بمعاملة عمولة/بونص (TblEmpPayrollTxn)', requiresEmployee: true, needsReviewByDefault: false,
        matchedRuleSource: 'structural', matchedRuleId: input.linkedPayrollTxn.id, matchedKeyword: null, fromAdminMapping: false,
      };
    }
    return {
      flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee',
      confidence: 'high', reason: 'مرتبط بمعاملة مرتب (TblEmpPayrollTxn)', requiresEmployee: true, needsReviewByDefault: false,
      matchedRuleSource: 'structural', matchedRuleId: input.linkedPayrollTxn.id, matchedKeyword: null, fromAdminMapping: false,
    };
  }
  return null;
}

function classifyInvTypeFallback(invType: string, inOut: string): RuleMatch {
  const normalized = normalizeForMatch(invType);
  if (normalized === normalizeForMatch('مصروفات')) {
    return wrapFallback({
      flowGroup: 'operating', flowKind: 'operating_expense', pnlImpact: 'expense', partyType: 'unknown',
      confidence: 'low', reason: 'مصروف عام بدون فئة محددة', requiresEmployee: false, needsReviewByDefault: true,
    });
  }
  if (normalized === normalizeForMatch('ايرادات')) {
    return wrapFallback({
      flowGroup: 'other_income', flowKind: 'misc_income', pnlImpact: inOut === 'in' ? 'revenue' : 'none', partyType: 'unknown',
      confidence: 'low', reason: 'إيراد عام بدون فئة محددة', requiresEmployee: false, needsReviewByDefault: true,
    });
  }
  return {
    flowGroup: 'unclassified', flowKind: 'unknown', pnlImpact: 'none', partyType: 'unknown',
    confidence: 'low', reason: 'تعذر تصنيف الحركة', requiresEmployee: false, needsReviewByDefault: true,
    matchedRuleSource: 'unknown', matchedRuleId: null, matchedKeyword: null, fromAdminMapping: false,
  };
}

export function resolveEmployeeId(
  input: CashMoveClassificationInput,
  settings: ClassificationSettingsBundle,
  searchText: string,
): { empId: number | null; viaAlias: boolean; aliasText?: string } {
  if (input.empId != null && input.empId > 0) return { empId: input.empId, viaAlias: false };
  if (input.linkedPayrollTxn?.empId) return { empId: input.linkedPayrollTxn.empId, viaAlias: false };
  if (input.empIdFromCategoryMap != null && input.empIdFromCategoryMap > 0) {
    return { empId: input.empIdFromCategoryMap, viaAlias: false };
  }

  const text = normalizeForMatch(searchText);
  for (const alias of settings.employeeAliases) {
    if (!alias.isActive) continue;
    const a = normalizeForMatch(alias.aliasText);
    if (a && text.includes(a)) {
      return { empId: alias.empId, viaAlias: true, aliasText: alias.aliasText };
    }
  }

  for (const emp of settings.employees) {
    const name = normalizeForMatch(emp.empName);
    if (name.length >= 3 && text.includes(name)) {
      return { empId: emp.empId, viaAlias: false };
    }
  }

  return { empId: null, viaAlias: false };
}

export function classifyCashMove(
  input: CashMoveClassificationInput,
  settings: ClassificationSettingsBundle = emptySettingsBundle(),
): CashMoveClassification {
  const categoryText = normalizeForMatch(input.categoryName);
  const notesText = normalizeForMatch(input.notes);
  const searchText = normalizeForMatch(
    [input.categoryName, input.notes, input.invType].filter(Boolean).join(' '),
  );

  let match: RuleMatch | null = null;

  if (SALES_INV_TYPES.has(input.invType.trim())) {
    match = classifySales();
  }

  if (!match) {
    match = classifyPayrollStructural(input);
  }

  if (!match && settings.loaded) {
    match = matchAdminCategoryMapping(settings, input.expInId);
  }

  if (!match && settings.loaded) {
    match = matchAdminKeywordRules(settings, categoryText, notesText);
  }

  if (!match) {
    match = matchFallbackCategoryRule(searchText);
  }

  if (!match) {
    match = classifyInvTypeFallback(input.invType, input.inOut);
  }

  const shouldResolveEmployeeFromText =
    match.requiresEmployee ||
    match.partyType === 'employee' ||
    match.flowGroup === 'payroll' ||
    match.flowGroup === 'employee_advance' ||
    match.partyType === 'employee_or_unknown';

  const empResolution = shouldResolveEmployeeFromText
    ? resolveEmployeeId(input, settings, searchText)
    : {
        empId: input.empId != null && input.empId > 0 ? input.empId : null,
        viaAlias: false,
      };
  let suggestedEmpId = empResolution.empId;

  const employeeExpected =
    match.requiresEmployee ||
    match.partyType === 'employee' ||
    match.flowGroup === 'payroll' ||
    match.flowGroup === 'employee_advance';

  let confidence = match.confidence;
  let needsReview = match.needsReviewByDefault;
  let reason = match.reason;

  if (empResolution.viaAlias && empResolution.aliasText) {
    reason = `${reason} — موظف من الاسم المستعار: ${empResolution.aliasText}`;
  }

  if (employeeExpected && !suggestedEmpId) {
    needsReview = true;
    if (confidence === 'high') confidence = 'medium';
    reason = `${reason} — لم يُحدد الموظف`;
  }

  if (confidence === 'low') needsReview = true;

  let pnlImpact = match.pnlImpact;
  if (
    match.flowGroup === 'employee_advance' &&
    (match.flowKind === 'employee_advance_out' || match.flowKind === 'employee_advance') &&
    input.inOut === 'in'
  ) {
    pnlImpact = 'contra_expense';
    if (match.flowKind === 'employee_advance') {
      match = { ...match, flowKind: 'employee_advance_repayment' };
    }
    reason = `${match.reason} — سداد/استرداد سلفة`;
  }

  return {
    cashMoveId: input.cashMoveId,
    invDate: input.invDate,
    amount: input.amount,
    inOut: input.inOut,
    invType: input.invType,
    expInId: input.expInId,
    categoryName: input.categoryName,
    notes: input.notes,
    linkedPayrollTxn: input.linkedPayrollTxn,
    suggestedFlowGroup: match.flowGroup,
    suggestedFlowKind: match.flowKind,
    suggestedPnlImpact: pnlImpact,
    suggestedPartyType: match.partyType,
    suggestedEmpId,
    confidence,
    needsReview,
    reason,
    matchedRuleSource: match.matchedRuleSource,
    matchedRuleId: match.matchedRuleId,
    matchedKeyword: match.matchedKeyword,
    fromAdminMapping: match.fromAdminMapping,
  };
}

export interface ClassificationSummaryBucket {
  key: string;
  count: number;
  totalAmount: number;
  inAmount: number;
  outAmount: number;
}

export interface ClassificationAuditSummary {
  totalRows: number;
  byFlowGroup: ClassificationSummaryBucket[];
  byFlowKind: ClassificationSummaryBucket[];
  byPnlImpact: ClassificationSummaryBucket[];
  byConfidence: ClassificationSummaryBucket[];
  byNeedsReview: ClassificationSummaryBucket[];
}

function addToBucket(
  map: Map<string, ClassificationSummaryBucket>,
  key: string,
  amount: number,
  inOut: string,
) {
  const existing = map.get(key) ?? { key, count: 0, totalAmount: 0, inAmount: 0, outAmount: 0 };
  existing.count += 1;
  existing.totalAmount += amount;
  if (inOut === 'in') existing.inAmount += amount;
  else existing.outAmount += amount;
  map.set(key, existing);
}

function bucketsFromMap(map: Map<string, ClassificationSummaryBucket>): ClassificationSummaryBucket[] {
  return [...map.values()].sort((a, b) => b.totalAmount - a.totalAmount);
}

export function summarizeClassifications(rows: CashMoveClassification[]): ClassificationAuditSummary {
  const byFlowGroup = new Map<string, ClassificationSummaryBucket>();
  const byFlowKind = new Map<string, ClassificationSummaryBucket>();
  const byPnlImpact = new Map<string, ClassificationSummaryBucket>();
  const byConfidence = new Map<string, ClassificationSummaryBucket>();
  const byNeedsReview = new Map<string, ClassificationSummaryBucket>();

  for (const row of rows) {
    const amount = Math.abs(row.amount);
    addToBucket(byFlowGroup, row.suggestedFlowGroup, amount, row.inOut);
    addToBucket(byFlowKind, row.suggestedFlowKind, amount, row.inOut);
    addToBucket(byPnlImpact, row.suggestedPnlImpact, amount, row.inOut);
    addToBucket(byConfidence, row.confidence, amount, row.inOut);
    addToBucket(byNeedsReview, row.needsReview ? 'true' : 'false', amount, row.inOut);
  }

  return {
    totalRows: rows.length,
    byFlowGroup: bucketsFromMap(byFlowGroup),
    byFlowKind: bucketsFromMap(byFlowKind),
    byPnlImpact: bucketsFromMap(byPnlImpact),
    byConfidence: bucketsFromMap(byConfidence),
    byNeedsReview: bucketsFromMap(byNeedsReview),
  };
}

// Re-export for convenience
export { emptySettingsBundle };
