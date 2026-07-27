/**
 * Booking Phase 2 — public services catalog route contract (source-level + assembly range).
 */
import fs from 'fs';
import path from 'path';
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

describe('bookingPublicServicesCatalog', () => {
  const routeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/services/route.ts'),
    'utf8',
  );

  it('requires branchCode via central resolver (BRANCH_REQUIRED path)', () => {
    expect(routeSrc).toContain('extractPublicBranchCode');
    expect(routeSrc).toContain('publicBookingErrorResponse');
    expect(routeSrc).toContain('PublicBookingBranchContextError');
  });

  it('OPTIONS returns CORS via publicBookingCors', () => {
    expect(routeSrc).toMatch(/export async function OPTIONS/);
    expect(routeSrc).toContain('publicBookingOptionsResponse');
    expect(routeSrc).toContain('PUBLIC_BOOKING_ROUTE_CORS');
  });

  it('GLEEM-shaped catalog keeps numeric prices and positive durations', () => {
    const rows = Array.from({ length: 28 }, (_, i) => ({
      ProID: 1000 + i,
      ProName: `Service ${i}`,
      ProNameAr: `خدمة ${i}`,
      SPrice1: 50 + i,
      DurationMinutes: 10 + (i % 5) * 5,
      isDeleted: 0,
      ProType: 'serv',
      CatID: (i % 3) + 1,
      CatName: ['Hair Cut', 'Beard Cut', 'Skincare'][i % 3],
      CatType: 'serv',
      SortOrder: (i % 3 + 1) * 10,
    }));
    const catalog = buildPublicServicesCatalog(
      rows,
      { branchCode: 'GLEEM', branchName: 'فرع جليم' },
      'live-like',
    );
    // Expected live range ~25–40; do not hardcode exact 30
    expect(catalog.meta.serviceCount).toBeGreaterThanOrEqual(20);
    expect(catalog.meta.serviceCount).toBeLessThanOrEqual(40);
    expect(catalog.pricingScope).toBe('global');
    expect(catalog.currency).toBe('EGP');
    for (const s of catalog.services) {
      expect(typeof s.price).toBe('number');
      expect(s.price).toBeGreaterThan(0);
      expect(Number.isInteger(s.durationMinutes)).toBe(true);
      expect(s.durationMinutes).toBeGreaterThan(0);
      expect(s.bookable).toBe(true);
    }
    const ids = catalog.services.map((s) => s.serviceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps flat services + groups for GLEEM widget compatibility', () => {
    const catalog = buildPublicServicesCatalog(
      [
        {
          ProID: 9,
          ProName: 'Hair Cut',
          ProNameAr: 'حلاقة',
          SPrice1: 200,
          DurationMinutes: 30,
          isDeleted: 0,
          ProType: 'serv',
          CatID: 19,
          CatName: 'Hair Cut',
          CatType: 'serv',
          SortOrder: 10,
        },
      ],
      { branchCode: 'GLEEM', branchName: 'جليم' },
      'v',
    );
    expect(catalog.services[0]?.id).toBe(9);
    expect(catalog.services[0]?.name).toBeTruthy();
    expect(catalog.groups[0]?.categoryName).toBeTruthy();
    expect(catalog.categories[0]?.services[0]?.serviceId).toBe(9);
  });
});
