import { roundMoney } from '@/lib/reportMonthUtils';

const EXCLUDED_KEYWORDS = [
  'سلف',
  'سلفه',
  'سلفة',
  'سلفات',
  'تارجت',
  'target',
] as const;

export function normalizePartnersCategoryName(categoryName: string): string {
  return categoryName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[()[\]{}«»"'.,،؛:!?\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePartnersExactCategoryName(categoryName: string): string {
  return normalizePartnersCategoryName(categoryName)
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXACT_EXCLUDED_CATEGORY_NAMES = new Set(
  ['تحويلات', 'غير مصنف', 'تحويل بين طرق الدفع مصروف'].map((name) =>
    normalizePartnersExactCategoryName(name)
  )
);

export function isExcludedPartnersExpenseCategory(categoryName: string): boolean {
  const normalized = normalizePartnersCategoryName(categoryName);
  if (!normalized) return false;

  const comparableName = normalizePartnersExactCategoryName(categoryName);
  if (EXACT_EXCLUDED_CATEGORY_NAMES.has(comparableName)) return true;

  const matchesAdvanceOrTarget = EXCLUDED_KEYWORDS.some((keyword) => {
    const normalizedKeyword = normalizePartnersCategoryName(keyword);
    return normalized.includes(normalizedKeyword);
  });
  if (matchesAdvanceOrTarget) return true;

  const hasDailyPaymentTerm =
    normalized.includes('يوميات') ||
    normalized.includes('يوميه');
  const hasEmployeeTerm =
    normalized.includes('موظف') ||
    normalized.includes('موظفين');

  return hasDailyPaymentTerm && hasEmployeeTerm;
}

/** @deprecated Use isExcludedPartnersExpenseCategory */
export const isEmployeeSettlementCategory = isExcludedPartnersExpenseCategory;

export interface PartnersExpenseCategoryInput {
  categoryId: number | null;
  categoryName: string;
  transactionCount: number;
  totalAmount: number;
}

export interface PartnersExpenseCategoryRow extends PartnersExpenseCategoryInput {
  percentage: number;
}

export function filterOperatingExpenseCategories(
  categories: PartnersExpenseCategoryInput[],
  totalExpenses: number
): {
  operatingCategories: PartnersExpenseCategoryRow[];
  operatingExpenses: number;
  excludedEmployeeSettlementExpenses: number;
} {
  const operatingRaw: PartnersExpenseCategoryInput[] = [];
  let excludedEmployeeSettlementExpenses = 0;

  for (const category of categories) {
    if (isExcludedPartnersExpenseCategory(category.categoryName)) {
      excludedEmployeeSettlementExpenses = roundMoney(
        excludedEmployeeSettlementExpenses + category.totalAmount
      );
    } else {
      operatingRaw.push(category);
    }
  }

  const operatingExpenses = roundMoney(
    operatingRaw.reduce((sum, row) => sum + row.totalAmount, 0)
  );

  const operatingCategories = operatingRaw.map((row) => ({
    ...row,
    percentage:
      operatingExpenses > 0
        ? roundMoney((row.totalAmount / operatingExpenses) * 100)
        : 0,
  }));

  const excludedFromTotal = roundMoney(totalExpenses - operatingExpenses);
  if (Math.abs(excludedFromTotal - excludedEmployeeSettlementExpenses) > 0.01) {
    excludedEmployeeSettlementExpenses = excludedFromTotal;
  }

  return {
    operatingCategories,
    operatingExpenses,
    excludedEmployeeSettlementExpenses,
  };
}
