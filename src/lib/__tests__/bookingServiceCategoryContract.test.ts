/**
 * Booking Phase 2 — category + catalog assembly contract.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: async () => ({ recordset: [] }),
    }),
  }),
  sql: { Int: 0 },
}));

vi.mock('@/lib/migrations/ensureServiceImageUrl', () => ({
  ensureTblProImageUrlColumn: async () => false,
  tblProImageUrlSelect: () => 'CAST(NULL AS NVARCHAR(1000)) AS ImageUrl',
}));

vi.mock('@/lib/migrations/ensureCategorySortOrder', () => ({
  ensureTblCatSortOrderColumn: async () => true,
  tblCatSortOrderSelect: () => 'c.SortOrder',
}));

import { buildPublicServicesCatalog } from '@/lib/booking/publicBookingServices';
import {
  compareCategories,
  compareServices,
  resolveCategoryNames,
  UNCATEGORIZED_CATEGORY_ID,
} from '@/lib/booking/publicBookingServicePolicy';

describe('bookingServiceCategoryContract', () => {
  it('orders categories by sortOrder then Arabic name', () => {
    const a = { sortOrder: 20, nameAr: 'ب', categoryId: '2' };
    const b = { sortOrder: 10, nameAr: 'أ', categoryId: '1' };
    expect(compareCategories(b, a)).toBeLessThan(0);
  });

  it('orders services by Arabic name then serviceId when sort equal', () => {
    const a = { sortOrder: 0, nameAr: 'قص', serviceId: 2 };
    const b = { sortOrder: 0, nameAr: 'قص', serviceId: 1 };
    expect(compareServices(b, a)).toBeLessThan(0);
  });

  it('maps known English category labels temporarily', () => {
    const names = resolveCategoryNames('Hair Cut');
    expect(names.nameEn).toBe('Hair Cut');
    expect(names.nameAr).toContain('قص');
  });

  it('places uncategorized eligible services in أخرى and omits empty cats', () => {
    const catalog = buildPublicServicesCatalog(
      [
        {
          ProID: 1,
          ProName: 'A Cut',
          ProNameAr: 'قصة أ',
          SPrice1: 100,
          DurationMinutes: 30,
          isDeleted: 0,
          ProType: 'serv',
          CatID: null,
          CatName: null,
          CatType: null,
          SortOrder: null,
        },
        {
          ProID: 2,
          ProName: 'B Cut',
          ProNameAr: 'قصة ب',
          SPrice1: 120,
          DurationMinutes: 30,
          isDeleted: 0,
          ProType: 'serv',
          CatID: 19,
          CatName: 'Hair Cut',
          CatType: 'serv',
          SortOrder: 10,
        },
        {
          ProID: 3,
          ProName: 'Product X',
          ProNameAr: null,
          SPrice1: 50,
          DurationMinutes: 10,
          isDeleted: 0,
          ProType: 'pro',
          CatID: 99,
          CatName: 'Empty Product Cat',
          CatType: 'pro',
          SortOrder: 1,
        },
      ],
      { branchCode: 'GLEEM', branchName: 'فرع جليم' },
      'test-ver',
      '2026-07-24T00:00:00.000Z',
    );

    expect(catalog.categories.some((c) => c.categoryId === UNCATEGORIZED_CATEGORY_ID)).toBe(true);
    expect(catalog.categories.find((c) => c.categoryId === UNCATEGORIZED_CATEGORY_ID)?.nameAr).toBe(
      'أخرى',
    );
    expect(catalog.categories.every((c) => c.services.length > 0)).toBe(true);
    expect(catalog.categories.some((c) => c.categoryId === '99')).toBe(false);
    expect(catalog.meta.serviceCount).toBe(2);

    const hair = catalog.services.find((s) => s.serviceId === 2)!;
    expect(hair.nameAr).toBe('قصة ب');
    expect(hair.nameEn).toBe('B Cut');
    expect(hair.categoryNameAr).toBeTruthy();
    expect(hair.categoryNameEn).toBe('Hair Cut');
    expect(catalog.groups[0]?.categoryNameAr).toBeTruthy();
    expect(catalog.groups[0]?.categoryNameEn).toBeTruthy();
  });

  it('does not duplicate service IDs across categories', () => {
    const catalog = buildPublicServicesCatalog(
      [
        {
          ProID: 10,
          ProName: 'Dup',
          ProNameAr: 'مكرر',
          SPrice1: 100,
          DurationMinutes: 20,
          isDeleted: 0,
          ProType: 'serv',
          CatID: 1,
          CatName: 'Hair Cut',
          CatType: 'serv',
          SortOrder: 10,
        },
        {
          ProID: 10,
          ProName: 'Dup',
          ProNameAr: 'مكرر',
          SPrice1: 100,
          DurationMinutes: 20,
          isDeleted: 0,
          ProType: 'serv',
          CatID: 2,
          CatName: 'Beard Cut',
          CatType: 'serv',
          SortOrder: 20,
        },
      ],
      { branchCode: 'GLEEM', branchName: 'جليم' },
      'v',
    );
    const ids = catalog.services.map((s) => s.serviceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([10]);
  });
});
