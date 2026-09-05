/**
 * Phase B — BookingServiceSelect popular/category selection semantics (pure helpers + source checks).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOpsPopularServices } from '@/lib/operations/opsPopularServices';

const root = process.cwd();

describe('BookingServiceSelect Phase B', () => {
  it('Case 6 — Popular and full list share the same service id (no duplicate logical selection)', () => {
    const catalog = [
      { ProID: 9, ProName: 'حلاقة شعر', SPrice: 200, DurationMinutes: 30, CatName: 'قص الشعر', CatID: '19' },
      { ProID: 20, ProName: 'شعر ودقن', SPrice: 250, DurationMinutes: 45, CatName: 'خدمات اللحية', CatID: '20' },
      { ProID: 11, ProName: 'تنظيف بشرة عادي', SPrice: 200, DurationMinutes: 20, CatName: 'عناية البشرة', CatID: '9' },
    ];
    const popular = resolveOpsPopularServices(catalog);
    const hair = popular.find((p) => p.key === 'hair')!.service;
    // Selecting ProID once covers both Popular strip and catalog row.
    const selectedIds = [hair.ProID];
    expect(selectedIds.includes(hair.ProID)).toBe(true);
    expect(catalog.filter((s) => selectedIds.includes(s.ProID))).toHaveLength(1);
  });

  it('Case 7 — categories derive from real CatName/CatID fields', () => {
    const src = readFileSync(
      join(root, 'src/components/operations/BookingServiceSelect.tsx'),
      'utf8',
    );
    expect(src).toContain('CatID');
    expect(src).toContain('CatName');
    expect(src).toContain('التصنيفات');
    expect(src).not.toContain('ADDON_CATEGORIES');
    expect(src).not.toContain('PRIMARY_SLOTS');
  });

  it('Case 8 — search uses shared Arabic-capable searchServices', () => {
    const src = readFileSync(
      join(root, 'src/components/operations/BookingServiceSelect.tsx'),
      'utf8',
    );
    expect(src).toContain('searchServices');
    expect(src).toContain('ServiceSearchInput');
    expect(src).toContain('الأكثر طلبًا');
    expect(src).toContain('resolveOpsPopularServices');
  });
});
