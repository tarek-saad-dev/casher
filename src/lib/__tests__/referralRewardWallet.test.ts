import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({
  results: [] as Array<Record<string, unknown>[]>,
  calls: [] as Array<{ query: string; parameters: Record<string, unknown> }>,
}));
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => new (class {
      parameters: Record<string, unknown> = {};
      input(key: string, _type: unknown, value: unknown) {
        this.parameters[key] = value;
        return this;
      }
      async query(query: string) {
        mock.calls.push({ query, parameters: { ...this.parameters } });
        return { recordset: mock.results.shift() ?? [] };
      }
    })(),
  })),
  sql: { UniqueIdentifier: 'UUID', Int: 'INT' },
}));

import { listTenantReferralRewardWallet } from '@/lib/referrals/referralRewardWallet.service';
const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const input = { tenantId, clientId: 90 };

beforeEach(() => { mock.results = []; mock.calls = []; });

describe('staff-only read-only referral wallet service', () => {
  it('refuses bad customer ids without SQL', async () => {
    await expect(listTenantReferralRewardWallet({ tenantId, clientId: -1 }))
      .rejects.toThrowError(expect.objectContaining({ status: 400 }));
    expect(mock.calls).toHaveLength(0);
  });

  it('fails closed if DRVO-023 schema is absent', async () => {
    mock.results = [[{ Ready: 0 }]];
    await expect(listTenantReferralRewardWallet(input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_SCHEMA_UNAVAILABLE', status: 503 }),
    );
    expect(mock.calls).toHaveLength(1);
  });

  it('does not disclose foreign-tenant or missing client vouchers', async () => {
    mock.results = [[{ Ready: 1 }], []];
    await expect(listTenantReferralRewardWallet(input)).rejects.toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[1]?.parameters).toMatchObject(input);
  });

  it('only returns tenant-owned, ACTIVE, unexpired vouchers with honored APPLIED/REVERSED source claim', async () => {
    mock.results = [
      [{ Ready: 1 }], [{ ClientID: 90 }],
      [{ VoucherID: 50, DiscountPercent: 20,
        IssuedAtUtc: new Date('2026-10-01T00:00:00Z'), ExpiresAtUtc: null }],
    ];
    const result = await listTenantReferralRewardWallet(input);
    expect(result).toEqual([{
      voucherId: 50, discountPercent: 20, issuedAtUtc: '2026-10-01T00:00:00.000Z',
      expiresAtUtc: null,
    }]);
    expect(mock.calls[2]?.query).toContain("v.Status = N'ACTIVE'");
    expect(mock.calls[2]?.query).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    expect(mock.calls[2]?.query).toContain('v.ExpiresAtUtc > SYSUTCDATETIME()');
    expect(mock.calls[2]?.query).toContain('v.ReferrerClientID = @clientId');
    expect(mock.calls[2]?.parameters).toMatchObject(input);
  });

  it('rejects an invalid database reward or unsafe bigint for browser', async () => {
    mock.results = [
      [{ Ready: 1 }], [{ ClientID: 90 }],
      [{ VoucherID: 9007199254740992, DiscountPercent: 20,
        IssuedAtUtc: new Date('2026-10-01T00:00:00Z'), ExpiresAtUtc: null }],
    ];
    await expect(listTenantReferralRewardWallet(input)).rejects.toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });
});
