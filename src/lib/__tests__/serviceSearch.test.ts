import { describe, it, expect } from 'vitest';
import type { Service } from '@/lib/types';
import {
  compactSearchText,
  normalizeSearchText,
  searchServices,
  resolveVisibleServices,
  SEARCH_TIER,
  buildSearchableService,
} from '@/lib/serviceSearch';

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    ProID: 1,
    ProName: 'Hair Cut',
    ProNameAr: 'حلاقة شعر',
    SPrice1: 100,
    Bonus: 0,
    CatID: 1,
    CatName: 'حلاقة',
    SalesCount: 10,
    ImageUrl: null,
    ...overrides,
  };
}

const catalog: Service[] = [
  makeService({ ProID: 1, ProName: 'Hair Cut', ProNameAr: 'حلاقة شعر', CatName: 'حلاقة', CatID: 1 }),
  makeService({ ProID: 2, ProName: 'Fade Cut', ProNameAr: 'قص فيد', CatName: 'حلاقة', CatID: 1 }),
  makeService({ ProID: 3, ProName: 'Beard Trim', ProNameAr: 'تهذيب الدقن', CatName: 'لحية', CatID: 2 }),
  makeService({ ProID: 4, ProName: 'Skin Clean', ProNameAr: 'تنظيف بشرة', CatName: 'عناية', CatID: 4 }),
  makeService({ ProID: 5, ProName: 'Face Mask', ProNameAr: 'ماسك وجه', CatName: 'عناية', CatID: 4 }),
  makeService({ ProID: 6, ProName: 'Hair and Beard', ProNameAr: 'شعر ودقن', CatName: 'باقات', CatID: 3 }),
];

describe('normalizeSearchText', () => {
  it('normalizes Arabic letter variants and diacritics', () => {
    expect(normalizeSearchText('  حَلَاقَة  ')).toBe('حلاقة');
    expect(normalizeSearchText('إبراهيم')).toBe('ابراهيم');
    expect(normalizeSearchText('مدينة')).toBe('مدينة');
  });

  it('normalizes English punctuation and spacing', () => {
    expect(normalizeSearchText('Hair, Cut!')).toBe('hair cut');
    expect(compactSearchText('Hair Cut')).toBe('haircut');
  });
});

describe('searchServices', () => {
  it('matches Arabic typo "حلاقه" to "حلاقة شعر"', () => {
    const results = searchServices(catalog, 'حلاقه');
    expect(results.some((s) => s.ProNameAr === 'حلاقة شعر')).toBe(true);
  });

  it('matches "تنضيف بشره" to "تنظيف بشرة"', () => {
    const results = searchServices(catalog, 'تنضيف بشره');
    expect(results[0]?.ProNameAr).toBe('تنظيف بشرة');
  });

  it('matches "hair cut" to Hair Cut / haircut', () => {
    const results = searchServices(catalog, 'hair cut');
    expect(results[0]?.ProName).toBe('Hair Cut');
  });

  it('matches "هير كت" to Hair Cut via aliases', () => {
    const results = searchServices(catalog, 'هير كت');
    expect(results.some((s) => s.ProName === 'Hair Cut')).toBe(true);
  });

  it('matches "فيد" to Fade Cut', () => {
    const results = searchServices(catalog, 'فيد');
    expect(results.some((s) => s.ProName === 'Fade Cut')).toBe(true);
  });

  it('supports multi-token queries in any order', () => {
    const forward = searchServices(catalog, 'شعر دقن');
    const reverse = searchServices(catalog, 'دقن شعر');

    expect(forward.some((s) => s.ProNameAr === 'شعر ودقن')).toBe(true);
    expect(reverse.some((s) => s.ProNameAr === 'شعر ودقن')).toBe(true);
  });

  it('ranks exact matches above fuzzy matches', () => {
    const results = searchServices(catalog, 'حلاقة شعر');
    expect(results[0]?.ProNameAr).toBe('حلاقة شعر');

    const record = buildSearchableService(makeService({ ProNameAr: 'حلاقة شعر' }));
    expect(record.normAr).toBe('حلاقة شعر');
    expect(SEARCH_TIER.EXACT_AR).toBeGreaterThan(SEARCH_TIER.FUZZY);
  });

  it('returns the original list when query is cleared', () => {
    const subset = catalog.filter((s) => s.CatID === 1);
    expect(searchServices(subset, '')).toEqual(subset);
    expect(searchServices(subset, '   ')).toEqual(subset);
  });

  it('does not fuzzy-match unrelated services for one-character queries', () => {
    expect(searchServices(catalog, 'z')).toHaveLength(0);
    expect(searchServices(catalog, 'س').length).toBeLessThan(catalog.length);
  });
});

function getHotServices(allServices: Service[]): Service[] {
  return allServices
    .filter((s) => s.SalesCount > 0)
    .sort((a, b) => b.SalesCount - a.SalesCount)
    .slice(0, 10);
}

describe('resolveVisibleServices', () => {
  const allServices: Service[] = [
    ...catalog,
    makeService({
      ProID: 99,
      ProName: 'Rare Treatment',
      ProNameAr: 'خدمة نادرة',
      CatName: 'أخرى',
      CatID: 9,
      SalesCount: 0,
    }),
  ];

  const hotServices = getHotServices(allServices);
  const haircutCategoryServices = allServices.filter((s) => s.CatID === 1);

  it('finds a non-popular service while the hot category is selected', () => {
    expect(hotServices.some((s) => s.ProID === 99)).toBe(false);

    const visible = resolveVisibleServices(allServices, hotServices, 'خدمة نادرة');
    expect(visible.some((s) => s.ProID === 99)).toBe(true);
  });

  it('finds a service from another category while a category filter is selected', () => {
    expect(haircutCategoryServices.every((s) => s.CatID === 1)).toBe(true);

    const visible = resolveVisibleServices(allServices, haircutCategoryServices, 'بشرة');
    expect(visible.some((s) => s.ProNameAr === 'تنظيف بشرة')).toBe(true);
    expect(visible.every((s) => s.CatID === 1)).toBe(false);
  });

  it('restores the selected category results when the query is cleared', () => {
    const searched = resolveVisibleServices(allServices, hotServices, 'بشرة');
    expect(searched.length).toBeGreaterThan(0);

    expect(resolveVisibleServices(allServices, hotServices, '')).toEqual(hotServices);
    expect(resolveVisibleServices(allServices, hotServices, '   ')).toEqual(hotServices);
  });

  it('does not alter the category source list when searching', () => {
    const categorySnapshot = [...hotServices];
    resolveVisibleServices(allServices, hotServices, 'ماسك');

    expect(hotServices).toEqual(categorySnapshot);
  });

  it('ranks search results across the full services list', () => {
    const visible = resolveVisibleServices(allServices, hotServices, 'حلاقة شعر');
    expect(visible[0]?.ProNameAr).toBe('حلاقة شعر');
  });
});
