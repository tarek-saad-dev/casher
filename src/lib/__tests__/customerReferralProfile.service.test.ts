import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({
  results: [] as Array<Record<string, unknown>[]>,
  calls: [] as Array<{ query: string; params: Record<string, unknown> }>,
}));
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => new (class {
      params: Record<string, unknown> = {};
      input(k: string, _type: unknown, value: unknown) {
        this.params[k] = value; return this;
      }
      async query(query: string) {
        mock.calls.push({ query, params: { ...this.params } });
        return { recordset: mock.results.shift() ?? [] };
      }
    })(),
  })),
  sql: { UniqueIdentifier: 'UUID', Int: 'INT' },
}));

import { getTenantCustomerReferralProfile } from '@/lib/referrals/customerReferralProfile.service';

const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const input = { tenantId, clientId: 45 };
const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const ready = [{ Ready: 1 }];
const owned = [{ ClientID: 45 }];
const totals = [{ TotalClaims: '3', Successful: '2', Refunded: '1' }];
const vouchers = [{ Earned: '3', Available: '1', Used: '2' }];

beforeEach(() => {
  mock.calls = []; mock.results = [];
  delete process.env.POS_REFERRAL_PROFILE_ENABLED;
});

describe('staff Customer Referral Profile, tenant-only read-only SQL (#237)', () => {
  it('is OFF by default and refuses to touch SQL', async () => {
    await expect(getTenantCustomerReferralProfile(input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRALS_DISABLED', status: 503 }),
    );
    expect(mock.calls).toHaveLength(0);
  });

  it('fails closed on absent DRVO-023 schema', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [[{ Ready: 0 }]];
    await expect(getTenantCustomerReferralProfile(input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_SCHEMA_UNAVAILABLE', status: 503 }),
    );
    expect(mock.calls).toHaveLength(1);
  });

  it('refuses bad IDs before hitting DB', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    await expect(getTenantCustomerReferralProfile({ tenantId, clientId: 2 ** 33 }))
      .rejects.toThrowError(expect.objectContaining({ status: 400 }));
    expect(mock.calls).toHaveLength(0);
  });

  it('does not query code or rewards for a client from another tenant', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [ready, []];
    await expect(getTenantCustomerReferralProfile(input)).rejects.toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[1]?.params).toEqual(input);
    expect(mock.calls[1]?.query).toContain('TenantId = @tenantId');
  });

  it('shows only an activated true code, with refunded-claim reward still honored', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [
      ready, owned, [{ Code: CODE, ActivatedAtUtc: new Date() }], totals, vouchers,
    ];
    const res = await getTenantCustomerReferralProfile(input);
    expect(res).toEqual({
      clientId: 45, code: CODE, codeActivated: true,
      successfulReferrals: 2, refundedReferrals: 1,
      totalRewardedReferrals: 3, earnedRewards: 3, availableRewards: 1, usedRewards: 2,
    });
    expect(mock.calls).toHaveLength(5);
    for (const call of mock.calls.slice(1)) {
      expect(call.params).toMatchObject(input);
    }
    expect(mock.calls[3]?.query).toContain("Status IN (N'APPLIED', N'REVERSED')");
    expect(mock.calls[4]?.query).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    expect(mock.calls[4]?.query).toContain("v.Status = N'ACTIVE'");
    expect(mock.calls[4]?.query).toContain('SYSUTCDATETIME()');
    expect(mock.calls.every(c => !/INSERT INTO|UPDATE dbo|DELETE FROM/i.test(c.query))).toBe(true);
  });

  it('does not fabricate or disclose an unactivated code', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [ready, owned,
      [{ Code: CODE, ActivatedAtUtc: null }],
      [{ TotalClaims: 0, Successful: 0, Refunded: 0 }],
      [{ Earned: 0, Available: 0, Used: 0 }],
    ];
    const res = await getTenantCustomerReferralProfile(input);
    expect(res.code).toBeNull();
    expect(res.codeActivated).toBe(false);
    expect(res.availableRewards).toBe(0);
  });

  it('allows zero codes for a customer before the first paid invoice', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [ready, owned, [],
      [{ TotalClaims: 0, Successful: 0, Refunded: 0 }],
      [{ Earned: 0, Available: 0, Used: 0 }]];
    const res = await getTenantCustomerReferralProfile(input);
    expect(res.code).toBeNull();
    expect(res.totalRewardedReferrals).toBe(0);
  });

  it('rejects an active malformed code instead of sharing invalid or guessed data', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [ready, owned, [{ Code: 'CUT-123', ActivatedAtUtc: new Date() }]];
    await expect(getTenantCustomerReferralProfile(input)).rejects.toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });

  it('rejects inconsistent counts rather than fabricating reward totals', async () => {
    process.env.POS_REFERRAL_PROFILE_ENABLED = 'true';
    mock.results = [ready, owned, [], [{ TotalClaims: 2, Successful: 1, Refunded: 0 }]];
    await expect(getTenantCustomerReferralProfile(input)).rejects.toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });
});
