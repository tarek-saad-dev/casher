import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isExcludedPartnersExpenseCategory } from '@/lib/reports/partnersExpenseCategories';
import type { PartnersExpenseCategoryTransaction } from '@/lib/types/partners-report';
import { sumPartnersExpenseCategoryTransactions } from '@/lib/reports/partnersExpenseCategoryDetails';

describe('partners expense category details', () => {
  it('rejects excluded categories before loading transactions', () => {
    expect(isExcludedPartnersExpenseCategory('سلفة (زياد)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تحويلات')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('بضاعة')).toBe(false);
  });

  it('sums transaction amounts to the category total', () => {
    const transactions: PartnersExpenseCategoryTransaction[] = [
      {
        id: 1,
        categoryId: 10,
        categoryName: 'بضاعة',
        date: '2026-06-01',
        time: '10:30',
        notes: 'مشتريات',
        paymentMethod: 'كاش',
        amount: 1500,
      },
      {
        id: 2,
        categoryId: 10,
        categoryName: 'بضاعة',
        date: '2026-06-15',
        time: null,
        notes: null,
        paymentMethod: null,
        amount: 3500,
      },
    ];

    expect(sumPartnersExpenseCategoryTransactions(transactions)).toBe(5000);
    expect(transactions).toHaveLength(2);
  });
});
