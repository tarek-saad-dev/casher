/**
 * Phase 1E unit tests — branch partner shares helpers (mocked DB, no live connection).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

function mockDb(recordset: Record<string, unknown>[]) {
  vi.doMock('@/lib/db', () => ({
    getPool: vi.fn(async () => ({
      request: () => {
        const api: any = {
          input: () => api,
          query: async () => ({ recordset }),
        };
        return api;
      },
    })),
    sql: { Int: 'Int', Date: 'Date', NVarChar: () => 'NVarChar', BigInt: 'BigInt', Bit: 'Bit', Decimal: () => 'Decimal' },
  }));
}

describe('Phase 1E partnerShares — pure helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('PARTNER_SHARE_SUM_TOLERANCE is a tight tolerance around 100%', async () => {
    const { PARTNER_SHARE_SUM_TOLERANCE } = await import('@/lib/branch/partnerShares');
    expect(PARTNER_SHARE_SUM_TOLERANCE).toBe(0.0001);
  });

  it('toPartnerPercentageList maps SQL share records to the Partner[] shape', async () => {
    const { toPartnerPercentageList } = await import('@/lib/branch/partnerShares');
    const list = toPartnerPercentageList([
      {
        branchPartnerShareId: 1,
        branchId: 9,
        partnerUserId: null,
        partnerCode: 'ZIAD',
        partnerName: 'زياد',
        sharePercent: 36.66666666666667,
        effectiveFrom: '2026-06-01',
        effectiveTo: null,
        isActive: true,
        notes: null,
      },
    ]);
    expect(list).toEqual([{ name: 'زياد', percentage: 36.66666666666667, partnerCode: 'ZIAD' }]);
  });

  it('toPartnerPercentageList returns an empty array for no shares', async () => {
    const { toPartnerPercentageList } = await import('@/lib/branch/partnerShares');
    expect(toPartnerPercentageList([])).toEqual([]);
  });
});

describe('Phase 1E partnerShares — getEffectiveBranchPartnerShares (mocked DB)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns mapped, sorted shares when the sum is within tolerance of 100%', async () => {
    mockDb([
      {
        BranchPartnerShareID: 1,
        BranchID: 9,
        PartnerUserID: null,
        PartnerCode: 'A',
        PartnerName: 'Partner A',
        SharePercent: 60,
        EffectiveFrom: '2026-06-01',
        EffectiveTo: null,
        IsActive: 1,
        Notes: null,
      },
      {
        BranchPartnerShareID: 2,
        BranchID: 9,
        PartnerUserID: null,
        PartnerCode: 'B',
        PartnerName: 'Partner B',
        SharePercent: 40.00005,
        EffectiveFrom: '2026-06-01',
        EffectiveTo: null,
        IsActive: 1,
        Notes: null,
      },
    ]);

    const { getEffectiveBranchPartnerShares } = await import('@/lib/branch/partnerShares');
    const shares = await getEffectiveBranchPartnerShares(9, '2026-07-01');
    expect(shares).toHaveLength(2);
    expect(shares.map((s) => s.partnerCode)).toEqual(['A', 'B']);
  });

  it('throws PartnerShareConfigError when no active shares exist for the branch/date', async () => {
    mockDb([]);
    const { getEffectiveBranchPartnerShares, PartnerShareConfigError } = await import(
      '@/lib/branch/partnerShares'
    );
    await expect(getEffectiveBranchPartnerShares(9, '2026-07-01')).rejects.toThrow(
      PartnerShareConfigError,
    );
    await expect(getEffectiveBranchPartnerShares(9, '2026-07-01')).rejects.toMatchObject({
      code: 'PARTNER_SHARE_MISSING',
    });
  });

  it('throws PartnerShareConfigError when shares do not sum to 100% within tolerance', async () => {
    mockDb([
      {
        BranchPartnerShareID: 1,
        BranchID: 9,
        PartnerUserID: null,
        PartnerCode: 'A',
        PartnerName: 'Partner A',
        SharePercent: 60,
        EffectiveFrom: '2026-06-01',
        EffectiveTo: null,
        IsActive: 1,
        Notes: null,
      },
      {
        BranchPartnerShareID: 2,
        BranchID: 9,
        PartnerUserID: null,
        PartnerCode: 'B',
        PartnerName: 'Partner B',
        SharePercent: 39,
        EffectiveFrom: '2026-06-01',
        EffectiveTo: null,
        IsActive: 1,
        Notes: null,
      },
    ]);

    const { getEffectiveBranchPartnerShares, PartnerShareConfigError } = await import(
      '@/lib/branch/partnerShares'
    );
    await expect(getEffectiveBranchPartnerShares(9, '2026-07-01')).rejects.toThrow(
      PartnerShareConfigError,
    );
    await expect(getEffectiveBranchPartnerShares(9, '2026-07-01')).rejects.toMatchObject({
      code: 'PARTNER_SHARE_TOTAL_INVALID',
    });
  });
});

describe('Phase 1E partnerShares — overlap detection in createBranchPartnerSharePeriod', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects a new period that overlaps an existing active period for the same partner', async () => {
    // getPartnerShareConfigurationTimeline returns one open-ended active period for ZIAD.
    mockDb([
      {
        BranchPartnerShareID: 1,
        BranchID: 9,
        PartnerUserID: null,
        PartnerCode: 'ZIAD',
        PartnerName: 'زياد',
        SharePercent: 36.6667,
        EffectiveFrom: '2026-06-01',
        EffectiveTo: null,
        IsActive: 1,
        Notes: null,
      },
    ]);

    const { createBranchPartnerSharePeriod, PartnerShareConfigError } = await import(
      '@/lib/branch/partnerShares'
    );
    await expect(
      createBranchPartnerSharePeriod({
        branchId: 9,
        partnerCode: 'ZIAD',
        partnerName: 'زياد',
        sharePercent: 40,
        effectiveFrom: '2026-08-01',
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_SHARE_OVERLAP' });
    await expect(
      createBranchPartnerSharePeriod({
        branchId: 9,
        partnerCode: 'ZIAD',
        partnerName: 'زياد',
        sharePercent: 40,
        effectiveFrom: '2026-08-01',
      }),
    ).rejects.toBeInstanceOf(PartnerShareConfigError);
  });

  it('allows a new period for the same partner once the prior period has ended', async () => {
    // Prior period for ZIAD ended 2026-07-31 — a period starting 2026-08-01 does not overlap.
    let call = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            input: () => api,
            query: async () => {
              call += 1;
              // 1st call: timeline SELECT; 2nd: INSERT OUTPUT
              if (call === 1) {
                return {
                  recordset: [
                    {
                      BranchPartnerShareID: 1,
                      BranchID: 9,
                      PartnerUserID: null,
                      PartnerCode: 'ZIAD',
                      PartnerName: 'زياد',
                      SharePercent: 36.6667,
                      EffectiveFrom: '2026-06-01',
                      EffectiveTo: '2026-07-31',
                      IsActive: 1,
                      Notes: null,
                    },
                  ],
                };
              }
              return {
                recordset: [
                  {
                    BranchPartnerShareID: 2,
                    BranchID: 9,
                    PartnerUserID: null,
                    PartnerCode: 'ZIAD',
                    PartnerName: 'زياد',
                    SharePercent: 40,
                    EffectiveFrom: '2026-08-01',
                    EffectiveTo: null,
                    IsActive: 1,
                    Notes: null,
                  },
                ],
              };
            },
          };
          return api;
        },
      })),
      sql: {
        Int: 'Int',
        Date: 'Date',
        NVarChar: () => 'NVarChar',
        BigInt: 'BigInt',
        Bit: 'Bit',
        Decimal: () => 'Decimal',
      },
    }));

    const { createBranchPartnerSharePeriod } = await import('@/lib/branch/partnerShares');
    const created = await createBranchPartnerSharePeriod({
      branchId: 9,
      partnerCode: 'ZIAD',
      partnerName: 'زياد',
      sharePercent: 40,
      effectiveFrom: '2026-08-01',
    });
    expect(created.partnerCode).toBe('ZIAD');
    expect(created.sharePercent).toBe(40);
  });
});
