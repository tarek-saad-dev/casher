import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockGetPool } = vi.hoisted(() => ({ mockGetPool: vi.fn() }));
vi.mock('@/lib/db', () => ({
  getPool: mockGetPool,
  sql: {
    Int: 'Int',
    UniqueIdentifier: 'UniqueIdentifier',
    NVarChar: (_size: number) => 'NVarChar',
  },
}));

import {
  getTenantReferralPreview,
  ReferralPreviewNotFoundError,
  ReferralPreviewUnavailableError,
} from '@/lib/referrals/referralPreview.service';

const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const code = 'CUT-ABCDEF0123456789ABCDEF01';

type QueryLog = { statement: string; params: Record<string, unknown> };

function installDb(responses: unknown[][]) {
  const calls: QueryLog[] = [];
  let idx = 0;
  mockGetPool.mockResolvedValue({
    request() {
      const params: Record<string, unknown> = {};
      const request = {
        input(name: string, _type: unknown, value: unknown) {
          params[name] = value;
          return request;
        },
        async query(statement: string) {
          calls.push({ statement, params: { ...params } });
          return { recordset: responses[idx++] ?? [] };
        },
      };
      return request;
    },
  });
  return calls;
}

const ready = [{ Ready: 1 }];
const referred = [{ ClientID: 34 }];
const owner = [{ ReferrerClientID: 12, ActivatedAtUtc: new Date('2026-11-01T00:00:00Z') }];
const goodFacts = [{ ReferrerPaid: 1, ReferredPaid: 0, HasClaim: 0 }];
const input = { tenantId, referredClientId: 34, code };

describe('tenant-owned referral preview repository', () => {
  beforeEach(() => mockGetPool.mockReset());

  it('only uses tenant-qualified customer, code and claim queries', async () => {
    const queries = installDb([ready, referred, owner, goodFacts]);
    const result = await getTenantReferralPreview(input);
    expect(result).toEqual({
      ok: true, eligible: true, discountPercent: 50, reason: null, previewOnly: true,
    });
    expect(queries).toHaveLength(4);
    expect(queries[1].params).toMatchObject({ tenantId, clientId: 34 });
    expect(queries[2].params).toMatchObject({ tenantId, code });
    expect(queries[3].params).toMatchObject({ tenantId, referrerId: 12, referredId: 34 });
    expect(queries[1].statement).toContain('TenantId = @tenantId');
    expect(queries[2].statement).toContain('TenantId = @tenantId');
    expect(queries[3].statement).toContain('TenantId = @tenantId');
    expect(queries[3].statement).toContain('h.Payment >= h.GrandTotal');
  });

  it('does not disclose out-of-tenant code or customer data', async () => {
    const queries = installDb([ready, referred, []]);
    await expect(getTenantReferralPreview(input)).rejects.toBeInstanceOf(ReferralPreviewNotFoundError);
    expect(queries).toHaveLength(3);
    expect(queries[2].params.tenantId).toBe(tenantId);
  });

  it('refuses to run if migration was not applied', async () => {
    const queries = installDb([[{ Ready: 0 }]]);
    await expect(getTenantReferralPreview(input)).rejects.toBeInstanceOf(ReferralPreviewUnavailableError);
    expect(queries).toHaveLength(1);
  });

  it('refuses unknown target customers before looking up a code', async () => {
    const queries = installDb([ready, []]);
    await expect(getTenantReferralPreview(input)).rejects.toBeInstanceOf(ReferralPreviewNotFoundError);
    expect(queries).toHaveLength(2);
  });

  it('fails closed for already-paid customer even with a valid active code', async () => {
    installDb([ready, referred, owner, [{ ReferrerPaid: 1, ReferredPaid: 1, HasClaim: 0 }]]);
    await expect(getTenantReferralPreview(input)).resolves.toMatchObject({
      eligible: false, discountPercent: 0, reason: 'REFERRED_ALREADY_VISITED',
    });
  });

  it('fails closed for existing claim, including cancelled/reversed claims', async () => {
    installDb([ready, referred, owner, [{ ReferrerPaid: 1, ReferredPaid: 0, HasClaim: 1 }]]);
    await expect(getTenantReferralPreview(input)).resolves.toMatchObject({
      eligible: false, discountPercent: 0, reason: 'ALREADY_CLAIMED',
    });
  });

  it('fails closed for invalid/missing DB eligibility facts', async () => {
    installDb([ready, referred, owner, []]);
    await expect(getTenantReferralPreview(input)).rejects.toBeInstanceOf(ReferralPreviewUnavailableError);
  });
});
