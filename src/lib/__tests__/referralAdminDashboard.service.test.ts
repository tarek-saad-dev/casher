import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({
  calls: [] as Array<{ query: string; params: Record<string, unknown> }>,
  results: [] as Array<Record<string, unknown>[]>,
}));
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => new (class {
      params: Record<string, unknown> = {};
      input(key: string, _type: unknown, value: unknown) {
        this.params[key] = value;
        return this;
      }
      async query(query: string) {
        mock.calls.push({ query, params: { ...this.params } });
        return { recordset: mock.results.shift() ?? [] };
      }
    })(),
  })),
  sql: { UniqueIdentifier: 'UUID', NVarChar: () => 'NVARCHAR', Int: 'INT' },
}));
import {
  getTenantReferralAdminDashboard,
  parseReferralAdminQuery,
} from '@/lib/referrals/referralAdminDashboard.service';

const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const code = 'CUT-ABCDEF0123456789ABCDEF01';
const params = {
  tenantId, view: 'claims' as const, status: 'all' as const, page: 1, search: '',
};
const summary = {
  IssuedCodes: '6', ActiveCodes: '5', SuccessfulReferrals: '2',
  RefundedReferrals: '1', RewardsIssued: '3', RewardsAvailable: '1', RewardsUsed: '2',
};
const claim = {
  ClaimID: 50, Code: code, ReferrerName: 'محمود',
  ReferredName: 'أحمد', Status: 'REVERSED',
  FirstPaidInvID: 222, ClaimedAtUtc: new Date('2026-11-01T00:00:00Z'),
  AppliedAtUtc: new Date('2026-11-03T00:00:00Z'),
  ReversedAtUtc: new Date('2026-11-05T00:00:00Z'),
  RewardStatus: 'ACTIVE',
};
function results(rows: Record<string, unknown>[] = [claim]) {
  mock.results = [[{ Ready: 1 }], [summary], [{ Total: rows.length }], rows];
}
beforeEach(() => {
  delete process.env.POS_REFERRAL_ADMIN_ENABLED;
  mock.calls = [];
  mock.results = [];
});
afterEach(() => delete process.env.POS_REFERRAL_ADMIN_ENABLED);

describe('Admin referral report: strict filters and one-tenant SQL (#240)', () => {
  it('is OFF by default and never touches SQL', async () => {
    await expect(getTenantReferralAdminDashboard(params))
      .rejects.toThrowError(expect.objectContaining({ code: 'REFERRALS_DISABLED', status: 503 }));
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects invalid user-controlled search/status/page without querying database', async () => {
    for (const url of [
      '?view=other', '?view=claims&status=DROP', '?view=codes&status=APPLIED',
      '?page=0', '?page=1.5', '?page=10001', '?page=999999999999',
      '?search=' + 'z'.repeat(81), '?search=hello%0Aevil',
    ]) {
      expect(() => parseReferralAdminQuery(new URL('https://example.org/admin?' + url.slice(1))))
        .toThrowError(expect.objectContaining({ status: 400 }));
    }
    expect(mock.calls).toHaveLength(0);
  });

  it('allows literal UTF-8 search (not concatenated SQL) and valid filters', () => {
    expect(parseReferralAdminQuery(
      new URL('https://example.org/admin?view=claims&status=REVERSED&page=2&search=' +
        encodeURIComponent('كريم % _')),
    )).toEqual({
      view: 'claims', status: 'REVERSED', page: 2, search: 'كريم % _',
    });
    expect(parseReferralAdminQuery(new URL('https://example.org/admin?view=codes&status=inactive')))
      .toMatchObject({ view: 'codes', status: 'inactive', page: 1 });
  });

  it('returns 503 when migration tables do not exist yet', async () => {
    process.env.POS_REFERRAL_ADMIN_ENABLED = 'true';
    mock.results = [[{ Ready: 0 }]];
    await expect(getTenantReferralAdminDashboard(params))
      .rejects.toThrowError(expect.objectContaining({ code: 'REFERRAL_SCHEMA_UNAVAILABLE', status: 503 }));
    expect(mock.calls).toHaveLength(1);
  });

  it('returns real APPLIED/REVERSED rewards with no invented money/coins/invites', async () => {
    process.env.POS_REFERRAL_ADMIN_ENABLED = 'true';
    results();
    const dashboard = await getTenantReferralAdminDashboard(params);
    expect(dashboard.summary).toEqual({
      issuedCodes: 6, activeCodes: 5, successfulReferrals: 2,
      refundedReferrals: 1, rewardsIssued: 3, rewardsAvailable: 1, rewardsUsed: 2,
    });
    expect(dashboard.claims).toEqual([{
      id: 50, code, referrerName: 'محمود', referredName: 'أحمد',
      status: 'REVERSED', originalInvoiceId: 222,
      claimedAtUtc: '2026-11-01T00:00:00.000Z',
      appliedAtUtc: '2026-11-03T00:00:00.000Z',
      reversedAtUtc: '2026-11-05T00:00:00.000Z', rewardStatus: 'ACTIVE',
    }]);
    expect(dashboard.codes).toEqual([]);
    expect(dashboard.total).toBe(1);
    expect(dashboard.totalPages).toBe(1);
    expect(mock.calls).toHaveLength(4);
    expect(mock.calls[3]?.query).toContain('OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY');
    expect(mock.calls[3]?.params).toMatchObject({
      tenantId, status: 'all', search: '', offset: 0, pageSize: 20,
    });
    for (const c of mock.calls.slice(1)) {
      expect(c.params.tenantId).toBe(tenantId);
      expect(c.query).not.toContain('01234567-89ab-4cde');
      expect(c.query).not.toContain('محمود');
    }
    expect(mock.calls[3]?.query).toContain('referrer.TenantId = c.TenantId');
    expect(mock.calls[3]?.query).toContain('referred.TenantId = c.TenantId');
    expect(mock.calls[3]?.query).toContain('v.TenantId = c.TenantId');
    expect(mock.calls[3]?.query).not.toContain('Mobile');
    expect(mock.calls.every(c => !/UPDATE dbo\.|DELETE FROM|INSERT INTO/i.test(c.query))).toBe(true);
  });

  it('uses tenant-isolated, parameterized code inventory and bounded pagination', async () => {
    process.env.POS_REFERRAL_ADMIN_ENABLED = 'true';
    results([{
      ReferralCodeID: 2, Code: code, CustomerName: 'محمود',
      ActivatedAtUtc: new Date('2026-11-02T00:00:00Z'),
      CreatedAtUtc: new Date('2026-10-01T00:00:00Z'),
      Referrals: 3, Refunded: 1, AvailableRewards: 1, UsedRewards: 2,
    }]);
    const dashboard = await getTenantReferralAdminDashboard({
      tenantId, view: 'codes', status: 'active', page: 3, search: 'محمود',
    });
    expect(dashboard.codes).toEqual([{
      id: 2, code, customerName: 'محمود',
      activatedAtUtc: '2026-11-02T00:00:00.000Z',
      createdAtUtc: '2026-10-01T00:00:00.000Z',
      referrals: 3, refunded: 1, availableRewards: 1, usedRewards: 2,
    }]);
    expect(dashboard.claims).toEqual([]);
    expect(mock.calls[2]?.params.search).toBe('محمود');
    expect(mock.calls[3]?.params).toMatchObject({
      tenantId, status: 'active', search: 'محمود', offset: 40, pageSize: 20,
    });
    expect(mock.calls[3]?.query).toContain('owner.TenantId = referralCode.TenantId');
    expect(mock.calls[3]?.query).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    expect(mock.calls[3]?.query).toContain("v.Status = N'ACTIVE'");
  });

  it('handles empty result pages without stale or fake rows', async () => {
    process.env.POS_REFERRAL_ADMIN_ENABLED = 'true';
    results([]);
    const dashboard = await getTenantReferralAdminDashboard(params);
    expect(dashboard.total).toBe(0);
    expect(dashboard.claims).toEqual([]);
    expect(dashboard.codes).toEqual([]);
    expect(dashboard.totalPages).toBe(0);
  });

  it('fails closed on impossible aggregate counts and corrupted voucher statuses', async () => {
    process.env.POS_REFERRAL_ADMIN_ENABLED = 'true';
    mock.results = [[{ Ready: 1 }], [{ ...summary, RewardsAvailable: 10 }]];
    await expect(getTenantReferralAdminDashboard(params)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_SCHEMA_UNAVAILABLE', status: 503 }),
    );
    mock.calls = [];
    results([{ ...claim, RewardStatus: 'FAKE' }]);
    await expect(getTenantReferralAdminDashboard(params)).rejects.toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });
});
