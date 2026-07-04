import { normalizeSearchText } from '@/lib/serviceSearch';
import {
  extractExpenseCategorySecondaryLabel,
  QUICK_EXPENSE_DAILY_PINNED_NAMES,
} from '@/lib/expenseCategoryGroups';

export interface SearchableExpenseCategory {
  ExpINID: number;
  CatName: string;
  UsageCount?: number;
  DailyUsageCount?: number;
}

export function normalizeExpenseSearchText(value: string): string {
  return normalizeSearchText(value).replace(/ة/g, 'ه');
}

function buildCategorySearchBlob(category: SearchableExpenseCategory): string {
  const secondary = extractExpenseCategorySecondaryLabel(category.CatName);
  return [category.CatName, secondary].filter(Boolean).join(' ');
}

export function matchesExpenseCategorySearch(
  category: SearchableExpenseCategory,
  query: string,
): boolean {
  const normalizedQuery = normalizeExpenseSearchText(query);
  if (!normalizedQuery) return true;

  const compactQuery = normalizeExpenseSearchText(query).replace(/\s+/g, '');
  const blob = normalizeExpenseSearchText(buildCategorySearchBlob(category));
  const compactBlob = normalizeExpenseSearchText(buildCategorySearchBlob(category)).replace(/\s+/g, '');

  if (blob.includes(normalizedQuery) || compactBlob.includes(compactQuery)) {
    return true;
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return tokens.every((token) => blob.includes(token) || compactBlob.includes(token));
}

export function filterExpenseCategories<T extends SearchableExpenseCategory>(
  categories: T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return categories;
  return categories.filter((category) => matchesExpenseCategorySearch(category, trimmed));
}

export function findCategoryForPinnedName<T extends SearchableExpenseCategory>(
  categories: T[],
  pinnedName: string,
): T | undefined {
  const normPinned = normalizeExpenseSearchText(pinnedName);

  const exact = categories.find(
    (category) => normalizeExpenseSearchText(category.CatName) === normPinned,
  );
  if (exact) return exact;

  const startsWithMatch = categories.find((category) =>
    normalizeExpenseSearchText(category.CatName).startsWith(normPinned),
  );
  if (startsWithMatch) return startsWithMatch;

  return categories.find((category) =>
    normalizeExpenseSearchText(category.CatName).includes(normPinned),
  );
}

export function resolveQuickExpenseDailyPinnedCategories<
  T extends SearchableExpenseCategory,
>(categories: T[]): T[] {
  const pinned: T[] = [];
  const usedIds = new Set<number>();

  for (const pinnedName of QUICK_EXPENSE_DAILY_PINNED_NAMES) {
    const match = findCategoryForPinnedName(
      categories.filter((category) => !usedIds.has(category.ExpINID)),
      pinnedName,
    );
    if (match) {
      pinned.push(match);
      usedIds.add(match.ExpINID);
    }
  }

  return pinned;
}
