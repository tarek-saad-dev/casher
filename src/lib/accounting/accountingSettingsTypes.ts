import type { ClassificationConfidence, PartyType, PnlImpact } from './cashMoveClassification';

export type MatchedRuleSource =
  | 'structural'
  | 'category_mapping'
  | 'keyword_rule'
  | 'employee_alias'
  | 'fallback'
  | 'unknown';

export type KeywordMatchTarget = 'category' | 'notes' | 'both';
export type KeywordMatchMode = 'contains' | 'exact';

export const FLOW_GROUPS = [
  'sales', 'operating', 'payroll', 'employee_advance', 'tips', 'transfer', 'capital',
  'other_income', 'unclassified',
] as const;

export const FLOW_KINDS = [
  'sales_revenue', 'operating_expense', 'salary_payout', 'salary_deduction',
  'bonus_or_commission_payout', 'employee_advance', 'employee_advance_out',
  'employee_advance_repayment', 'employee_final_settlement', 'tips_collected', 'internal_transfer',
  'partner_capital_in', 'loan_to_business', 'misc_income', 'unknown',
] as const;

export const PNL_IMPACTS: PnlImpact[] = ['revenue', 'expense', 'contra_expense', 'none'];
export const PARTY_TYPES: PartyType[] = [
  'customer', 'employee', 'partner', 'partner_or_person', 'internal', 'unknown', 'none', 'employee_or_unknown',
];
export const CONFIDENCE_LEVELS: ClassificationConfidence[] = ['high', 'medium', 'low'];

export interface CategoryClassificationMap {
  id: number;
  expInId: number;
  catName?: string;
  expInType?: string;
  flowGroup: string;
  flowKind: string;
  pnlImpact: PnlImpact;
  partyType: PartyType;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  confidence: ClassificationConfidence;
  notes: string | null;
  isActive: boolean;
}

export interface KeywordClassificationRule {
  id: number;
  keyword: string;
  matchTarget: KeywordMatchTarget;
  matchMode: KeywordMatchMode;
  flowGroup: string;
  flowKind: string;
  pnlImpact: PnlImpact;
  partyType: PartyType;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  confidence: ClassificationConfidence;
  priority: number;
  isActive: boolean;
}

export interface EmployeeAlias {
  id: number;
  empId: number;
  empName?: string;
  aliasText: string;
  isActive: boolean;
}

export interface EmployeeNameRef {
  empId: number;
  empName: string;
}

export interface ClassificationSettingsBundle {
  categoryMappingsByExpInId: Map<number, CategoryClassificationMap>;
  keywordRules: KeywordClassificationRule[];
  employeeAliases: EmployeeAlias[];
  employees: EmployeeNameRef[];
  loaded: boolean;
}

export interface ClassificationRuleOutputs {
  flowGroup: string;
  flowKind: string;
  pnlImpact: PnlImpact;
  partyType: PartyType;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  confidence: ClassificationConfidence;
  reason: string;
  matchedRuleSource: MatchedRuleSource;
  matchedRuleId: number | null;
  matchedKeyword: string | null;
  fromAdminMapping: boolean;
}

export function emptySettingsBundle(): ClassificationSettingsBundle {
  return {
    categoryMappingsByExpInId: new Map(),
    keywordRules: [],
    employeeAliases: [],
    employees: [],
    loaded: false,
  };
}

export function isAllowedEnum<T extends string>(value: string, allowed: readonly T[] | T[]): value is T {
  return (allowed as string[]).includes(value);
}
