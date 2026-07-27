/**
 * Booking Phase 2 — public services route security + contract (source + assembly).
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
import { publicBookingErrorBody } from '@/lib/booking/publicBookingErrorCatalog';

describe('bookingServiceCatalogSecurity', () => {
  const routeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/services/route.ts'),
    'utf8',
  );

  it('uses Phase 1 branch context and rejects legacy fallback', () => {
    expect(routeSrc).toContain('resolvePublicBookingBranchContext');
    expect(routeSrc).toContain("purpose: 'public_booking'");
    expect(routeSrc).not.toContain('resolvePublicBranchCode');
    expect(routeSrc).not.toMatch(/branchCode\s*\|\|\s*['"]GLEEM['"]/);
  });

  it('ignores BranchID / includeDeleted / type unlockers; blocks preview escalation', () => {
    expect(routeSrc).toContain("searchParams.get('BranchID')");
    expect(routeSrc).toContain("searchParams.get('includeDeleted')");
    expect(routeSrc).toContain('previewQueryParam');
    expect(routeSrc).not.toContain('includeDeleted=true');
    expect(routeSrc).not.toMatch(/ORDER BY \$\{/);
  });

  it('returns nested Phase 1 errors including catalog codes', () => {
    for (const code of [
      'BRANCH_REQUIRED',
      'BRANCH_NOT_FOUND',
      'BRANCH_NOT_PUBLIC',
      'BRANCH_BOOKING_DISABLED',
      'SERVICES_NOT_CONFIGURED',
      'SERVICE_CATALOG_UNAVAILABLE',
    ] as const) {
      const body = publicBookingErrorBody(code);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBeTruthy();
      expect(body.error.technicalMessage).toBeTruthy();
    }
  });

  it('OPTIONS and CORS headers exist; no cost/stock/supplier fields in catalog', () => {
    expect(routeSrc).toContain('OPTIONS');
    expect(routeSrc).toContain('publicBookingOptionsResponse');
    expect(routeSrc).toContain('PUBLIC_BOOKING_ROUTE_CORS');

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
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(/PPrice|Bonus|Qty|Barcode|supplier|cost|isDeleted|ProType/i);
    expect(catalog.services[0]?.price).toBe(200);
    expect(Number.isInteger(catalog.services[0]?.durationMinutes)).toBe(true);
    expect(catalog.pricingScope).toBe('global');
  });

  it('excludes products, deleted, test rows from assembled catalog', () => {
    const catalog = buildPublicServicesCatalog(
      [
        {
          ProID: 1,
          ProName: 'Ok',
          ProNameAr: 'حسنا',
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
          ProID: 2,
          ProName: 'Gone',
          ProNameAr: null,
          SPrice1: 100,
          DurationMinutes: 20,
          isDeleted: 1,
          ProType: 'serv',
          CatID: 1,
          CatName: 'Hair Cut',
          CatType: 'serv',
          SortOrder: 10,
        },
        {
          ProID: 3,
          ProName: '[TEST] Smoke',
          ProNameAr: null,
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
          ProID: 4,
          ProName: 'Shampoo',
          ProNameAr: null,
          SPrice1: 80,
          DurationMinutes: 5,
          isDeleted: 0,
          ProType: 'pro',
          CatID: 11,
          CatName: 'منتجات اونكس',
          CatType: 'pro',
          SortOrder: 90,
        },
      ],
      { branchCode: 'GLEEM', branchName: 'جليم' },
      'v',
    );
    expect(catalog.services.map((s) => s.serviceId)).toEqual([1]);
  });
});
