import { describe, expect, it } from 'vitest';
import { filterExpenseCategories, matchesExpenseCategorySearch } from '@/lib/expenseCategorySearch';

describe('expenseCategorySearch', () => {
  const categories = [
    { ExpINID: 1, CatName: 'سلفة (كريم)', UsageCount: 12 },
    { ExpINID: 2, CatName: 'بوفيه', UsageCount: 8 },
    { ExpINID: 3, CatName: 'تحويلات', UsageCount: 1 },
  ];

  it('matches employee names inside category labels', () => {
    expect(matchesExpenseCategorySearch(categories[0], 'كريم')).toBe(true);
    expect(matchesExpenseCategorySearch(categories[0], 'سلف')).toBe(true);
  });

  it('normalizes common Arabic letter variants during search', () => {
    expect(matchesExpenseCategorySearch(categories[0], 'سلفه')).toBe(true);
  });

  it('filters categories by partial query', () => {
    expect(filterExpenseCategories(categories, 'بو')).toHaveLength(1);
    expect(filterExpenseCategories(categories, 'لا توجد')).toHaveLength(0);
  });
});
