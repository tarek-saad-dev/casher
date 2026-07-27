/**
 * Booking Phase 2 — services catalog cache branch isolation + invalidation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: (...args: unknown[]) => query(...args),
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
  tblCatSortOrderSelect: () => 'CAST(10 AS INT) AS SortOrder',
}));

function ctx(code: string, name: string) {
  return {
    branchId: code === 'GLEEM' ? 1 : 3,
    branchCode: code,
    branchName: name,
    shortName: code,
    address: null,
    phone: null,
    timezone: 'Africa/Cairo',
    publicBookingEnabled: true,
    bookingEnabled: true,
    operatingHours: { openTime: '11:00', closeTime: '01:30' },
    businessDayCutoffTime: '04:00:00',
  };
}

const serviceRows = [
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
    ImageUrl: null,
  },
];

describe('bookingServiceCatalogCache', () => {
  beforeEach(() => {
    query.mockReset();
    vi.resetModules();
  });

  it('isolates cache by branchCode and invalidates on catalog change', async () => {
    query.mockImplementation(async (sqlText: string) => {
      if (String(sqlText).includes('ProCount')) {
        return {
          recordset: [
            {
              ProCount: 1,
              ActiveCount: 1,
              ProIdSum: 9,
              PriceSum: 200,
              DurSum: 30,
              CatSum: 19,
              CatSortSum: 10,
            },
          ],
        };
      }
      return { recordset: serviceRows };
    });

    const mod = await import('@/lib/booking/publicBookingServices');
    mod.invalidatePublicBookingServicesCache();

    const gleem1 = await mod.getPublicBookingServicesCatalog(ctx('GLEEM', 'جليم'));
    const gleem2 = await mod.getPublicBookingServicesCatalog(ctx('GLEEM', 'جليم'));
    expect(gleem1.meta.serviceCount).toBe(1);
    expect(gleem2.branch.branchCode).toBe('GLEEM');

    // Same catalog version → service rows query should not run again for GLEEM
    const rowQueriesBefore = query.mock.calls.filter((c) =>
      String(c[0]).includes('FROM dbo.TblPro p'),
    ).length;

    await mod.getPublicBookingServicesCatalog(ctx('GLEEM', 'جليم'));
    const rowQueriesAfter = query.mock.calls.filter((c) =>
      String(c[0]).includes('FROM dbo.TblPro p'),
    ).length;
    expect(rowQueriesAfter).toBe(rowQueriesBefore);

    // Different branch still gets its own key (even with global prices)
    const other = await mod.getPublicBookingServicesCatalog(ctx('OTHER', 'آخر'));
    expect(other.branch.branchCode).toBe('OTHER');
    expect(other.branch.branchCode).not.toBe('GLEEM');

    // Invalidate + version bump forces reload
    mod.invalidatePublicBookingServicesCache('GLEEM');
    query.mockImplementation(async (sqlText: string) => {
      if (String(sqlText).includes('ProCount')) {
        return {
          recordset: [
            {
              ProCount: 1,
              ActiveCount: 1,
              ProIdSum: 9,
              PriceSum: 250,
              DurSum: 30,
              CatSum: 19,
              CatSortSum: 10,
            },
          ],
        };
      }
      return {
        recordset: [{ ...serviceRows[0], SPrice1: 250 }],
      };
    });
    const refreshed = await mod.getPublicBookingServicesCatalog(ctx('GLEEM', 'جليم'));
    expect(refreshed.services[0]?.price).toBe(250);
  });
});
