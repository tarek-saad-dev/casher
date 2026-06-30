import { describe, it, expect } from 'vitest';
import {
  filterOperatingExpenseCategories,
  isExcludedPartnersExpenseCategory,
  normalizePartnersCategoryName,
} from '@/lib/reports/partnersExpenseCategories';

describe('isExcludedPartnersExpenseCategory', () => {
  it('matches advance and target category name variants', () => {
    expect(isExcludedPartnersExpenseCategory('سلفة (زياد)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('سلف (طارق)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('سلفة (كريم)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('سلف كريم')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('سلفات الموظفين')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تارجت (زياد)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تارجت (كريم)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('Target Bonus')).toBe(true);
  });

  it('matches employee daily payment category variants', () => {
    expect(isExcludedPartnersExpenseCategory('يوميات الموظفين')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('يوميات موظفين')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('يومية الموظفين')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('يوميات الموظف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('يوميه الموظفين')).toBe(true);
  });

  it('matches exact excluded category names with formatting variations', () => {
    expect(isExcludedPartnersExpenseCategory('تحويلات')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('  تحويلات')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('(تحويلات)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('غير مصنف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('غير  مصنف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('(غير مصنف)')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تحويل بين طرق الدفع - مصروف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تحويل بين طرق الدفع–مصروف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تحويل بين طرق الدفع — مصروف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('تحويل بين طرق الدفع مصروف')).toBe(true);
    expect(isExcludedPartnersExpenseCategory('(تحويل بين طرق الدفع - مصروف)')).toBe(true);
  });

  it('does not exclude unrelated daily or transfer-like categories', () => {
    expect(isExcludedPartnersExpenseCategory('يوميات نقل')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('يوميات')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('تحويل بنكي')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('تحويلات خارجية')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('مصروفات تشغيل')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('طرق الدفع')).toBe(false);
  });

  it('does not match normal operating categories', () => {
    expect(isExcludedPartnersExpenseCategory('بضاعة')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('التزامات شهرية')).toBe(false);
    expect(isExcludedPartnersExpenseCategory('مرتبات الصنايعية')).toBe(false);
  });

  it('normalizes Arabic variants before matching', () => {
    expect(normalizePartnersCategoryName('  سَلَفَة  (زياد) ')).toContain('سلف');
    expect(isExcludedPartnersExpenseCategory('  سَلَفَة  (زياد) ')).toBe(true);
  });
});

describe('filterOperatingExpenseCategories', () => {
  const categories = [
    { categoryId: 1, categoryName: 'تحويلات', transactionCount: 2, totalAmount: 10000 },
    { categoryId: 2, categoryName: 'بضاعة', transactionCount: 1, totalAmount: 5000 },
    { categoryId: 3, categoryName: 'سلفة (زياد)', transactionCount: 3, totalAmount: 8000 },
    { categoryId: 4, categoryName: 'تارجت (كريم)', transactionCount: 1, totalAmount: 2000 },
    { categoryId: 5, categoryName: 'يوميات الموظفين', transactionCount: 4, totalAmount: 3000 },
    { categoryId: 6, categoryName: 'يوميات نقل', transactionCount: 1, totalAmount: 1500 },
    { categoryId: 7, categoryName: 'غير مصنف', transactionCount: 2, totalAmount: 2500 },
    { categoryId: 8, categoryName: 'تحويل بين طرق الدفع - مصروف', transactionCount: 3, totalAmount: 4200 },
  ];

  it('excludes settlement and exact categories, then recalculates percentages', () => {
    const result = filterOperatingExpenseCategories(categories, 36200);

    expect(result.operatingCategories).toHaveLength(2);
    expect(result.operatingCategories.map((row) => row.categoryName)).toEqual([
      'بضاعة',
      'يوميات نقل',
    ]);
    expect(result.operatingExpenses).toBe(6500);
    expect(result.excludedEmployeeSettlementExpenses).toBe(29700);
    expect(result.operatingCategories[0].percentage).toBeCloseTo(76.92, 2);
    expect(result.operatingCategories[1].percentage).toBeCloseTo(23.08, 2);

    const percentageTotal = result.operatingCategories.reduce(
      (sum, row) => sum + row.percentage,
      0
    );
    expect(percentageTotal).toBeCloseTo(100, 2);
  });

  it('excludes hidden category transaction counts from visible totals', () => {
    const result = filterOperatingExpenseCategories(categories, 36200);
    const visibleTransactionCount = result.operatingCategories.reduce(
      (sum, row) => sum + row.transactionCount,
      0
    );
    expect(visibleTransactionCount).toBe(2);
  });

  it('table total equals sum of visible rows', () => {
    const result = filterOperatingExpenseCategories(categories, 36200);
    const visibleTotal = result.operatingCategories.reduce(
      (sum, row) => sum + row.totalAmount,
      0
    );
    expect(visibleTotal).toBe(result.operatingExpenses);
  });

  it('handles zero operating expenses without division errors', () => {
    const result = filterOperatingExpenseCategories(
      [{ categoryId: 1, categoryName: 'سلفة (زياد)', transactionCount: 1, totalAmount: 100 }],
      100
    );
    expect(result.operatingCategories).toHaveLength(0);
    expect(result.operatingExpenses).toBe(0);
    expect(result.excludedEmployeeSettlementExpenses).toBe(100);
  });
});
