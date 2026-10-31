/**
 * Store / branch income (إيراد للمحل) — EmpID stays NULL.
 * Maps onto existing financial report revenue classes (no parallel P&L logic).
 */

export const STORE_OTHER_BUSINESS_INCOME_CATEGORY = 'إيراد آخر للمحل';
export const STORE_NON_REVENUE_CASH_IN_CATEGORY = 'تحصيل غير ربحي';

export type StoreIncomeKind = 'other_business_income' | 'non_revenue_cash_in';

export const STORE_INCOME_KIND_LABELS: Record<StoreIncomeKind, string> = {
  other_business_income: 'إيراد آخر للمحل',
  non_revenue_cash_in: 'تحصيل غير ربحي',
};

export function storeIncomeCategoryName(kind: StoreIncomeKind): string {
  return kind === 'non_revenue_cash_in'
    ? STORE_NON_REVENUE_CASH_IN_CATEGORY
    : STORE_OTHER_BUSINESS_INCOME_CATEGORY;
}

export function parseStoreIncomeKind(value: unknown): StoreIncomeKind | null {
  if (value === 'other_business_income' || value === 'non_revenue_cash_in') {
    return value;
  }
  return null;
}

export function isStoreIncomeCategoryName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  return (
    n === STORE_OTHER_BUSINESS_INCOME_CATEGORY
    || n === STORE_NON_REVENUE_CASH_IN_CATEGORY
  );
}
