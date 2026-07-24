import { describe, expect, it } from 'vitest';
import {
  buildCatalogMeta,
  groupServicesByCategory,
  normalizeCatalogQuery,
} from '@/lib/catalog/serviceCatalog';
import type { ServiceCatalogRow } from '@/lib/catalog/serviceCatalog.types';

function row(partial: Partial<ServiceCatalogRow> & Pick<ServiceCatalogRow, 'ProID' | 'ProName'>): ServiceCatalogRow {
  return {
    ProNameAr: null,
    SPrice1: 100,
    Bonus: 0,
    DurationMinutes: 30,
    ImageUrl: null,
    isDeleted: 0,
    SalesCount: 0,
    CatID: 1,
    CatName: 'حلاقة',
    CatType: 'serv',
    ...partial,
  };
}

describe('serviceCatalog', () => {
  it('normalizes defaults to active serv catalog', () => {
    expect(normalizeCatalogQuery({})).toEqual({
      activeOnly: true,
      type: 'serv',
      categoryId: null,
      search: null,
      includeEmpty: false,
    });
  });

  it('groups services under categories with bilingual names', () => {
    const categories = groupServicesByCategory([
      row({
        ProID: 1,
        ProName: 'Basic Cut',
        ProNameAr: 'حلاقة عادية',
        CatID: 1,
        CatName: 'حلاقة',
        SalesCount: 50,
      }),
      row({
        ProID: 2,
        ProName: 'Advanced Cut',
        ProNameAr: 'حلاقة متقدمة',
        CatID: 1,
        CatName: 'حلاقة',
        SalesCount: 10,
      }),
      row({
        ProID: 3,
        ProName: 'Basic Skin Care',
        ProNameAr: 'عناية بشرة',
        CatID: 2,
        CatName: 'Skincare',
        CatType: 'serv',
        SalesCount: 5,
      }),
    ]);

    expect(categories).toHaveLength(2);
    expect(categories[0].name).toBe('حلاقة');
    expect(categories[0].serviceCount).toBe(2);
    expect(categories[0].services[0]).toMatchObject({
      id: 1,
      nameEn: 'Basic Cut',
      nameAr: 'حلاقة عادية',
      salesCount: 50,
    });
    expect(categories[1].services[0].nameEn).toBe('Basic Skin Care');
  });

  it('excludes product categories when type=serv', () => {
    const categories = groupServicesByCategory([
      row({ ProID: 1, ProName: 'Cut', CatType: 'serv' }),
      row({
        ProID: 9,
        ProName: 'Shampoo',
        CatID: 9,
        CatName: 'منتجات',
        CatType: 'pro',
      }),
    ]);

    expect(categories).toHaveLength(1);
    expect(categories[0].services.map((s) => s.id)).toEqual([1]);
  });

  it('filters soft-deleted by default and search on ar/en', () => {
    const rows = [
      row({ ProID: 1, ProName: 'Basic Cut', ProNameAr: 'حلاقة عادية' }),
      row({ ProID: 2, ProName: 'Gone', isDeleted: 1 }),
      row({ ProID: 3, ProName: 'Beard', ProNameAr: 'ذقن' }),
    ];

    const active = groupServicesByCategory(rows);
    expect(active[0].services.map((s) => s.id)).toEqual([1, 3]);

    const searchAr = groupServicesByCategory(rows, { search: 'ذقن' });
    expect(searchAr[0].services.map((s) => s.id)).toEqual([3]);

    const searchEn = groupServicesByCategory(rows, { search: 'basic' });
    expect(searchEn[0].services.map((s) => s.id)).toEqual([1]);
  });

  it('builds meta counts from grouped categories', () => {
    const categories = groupServicesByCategory([
      row({ ProID: 1, ProName: 'A' }),
      row({ ProID: 2, ProName: 'B', CatID: 2, CatName: 'Other' }),
    ]);
    const meta = buildCatalogMeta(categories);
    expect(meta.categoryCount).toBe(2);
    expect(meta.serviceCount).toBe(2);
    expect(meta.filters.type).toBe('serv');
    expect(meta.generatedAt).toMatch(/^\d{4}-/);
  });
});
