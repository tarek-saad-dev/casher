import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const mockGetPool = vi.fn();
let txQueryResults: { recordset: unknown[]; rowsAffected?: number[] }[] = [];
let txQueryIdx = 0;

vi.mock('@/lib/db', () => ({
  getPool: (...args: unknown[]) => mockGetPool(...args),
  sql: {
    Int: () => ({}),
    Decimal: () => ({}),
    NVarChar: () => ({}),
    Transaction: class FakeTx {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    Request: class FakeRequest {
      input() {
        return this;
      }
      async query() {
        const res = txQueryResults[txQueryIdx] ?? { recordset: [], rowsAffected: [1] };
        txQueryIdx++;
        return res;
      }
    },
    ISOLATION_LEVEL: { READ_COMMITTED: 0 },
  },
}));

vi.mock('@/lib/loyalty/helpers', () => ({
  getRewardById: vi.fn((id: number) =>
    id === 1
      ? {
          id: 1,
          titleAr: 'خصم',
          titleEn: 'Discount',
          requiredPoints: 100,
          minTierCode: 'BRONZE',
        }
      : null,
  ),
  canClientAccessReward: vi.fn(() => true),
  generateRewardRedeemCode: vi.fn(() => 'REDEEM-1-1-ABC'),
}));

describe('loyalty redeem public route', () => {
  beforeEach(() => {
    vi.resetModules();
    txQueryIdx = 0;
    txQueryResults = [];
    mockGetPool.mockReset();
  });

  function makeFakeDb(results: { recordset: unknown[] }[]) {
    let idx = 0;
    return {
      request: vi.fn(() => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async () => results[idx++] ?? { recordset: [] }),
      })),
    };
  }

  it('returns 404 for unknown reward', async () => {
    mockGetPool.mockResolvedValue(makeFakeDb([]));
    const { POST } = await import(
      '@/app/api/public/client/loyalty/rewards/[rewardId]/redeem/route'
    );
    const res = await POST(
      new NextRequest(
        'http://localhost/api/public/client/loyalty/rewards/99/redeem?clientId=1',
        { method: 'POST', body: JSON.stringify({ confirm: true }) },
      ),
      { params: Promise.resolve({ rewardId: '99' }) },
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Reward not found' });
  });

  it('returns 400 for insufficient points', async () => {
    mockGetPool.mockResolvedValue(
      makeFakeDb([
        {
          recordset: [
            {
              ClientLoyaltyID: 10,
              PointsBalance: 10,
              LifetimeRedeemedPoints: 0,
              TierCode: 'BRONZE',
            },
          ],
        },
      ]),
    );
    const { POST } = await import(
      '@/app/api/public/client/loyalty/rewards/[rewardId]/redeem/route'
    );
    const res = await POST(
      new NextRequest(
        'http://localhost/api/public/client/loyalty/rewards/1/redeem?clientId=1',
        { method: 'POST', body: JSON.stringify({ confirm: true }) },
      ),
      { params: Promise.resolve({ rewardId: '1' }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('غير كافي');
  });

  it('returns successful redemption contract', async () => {
    mockGetPool.mockResolvedValue(
      makeFakeDb([
        {
          recordset: [
            {
              ClientLoyaltyID: 10,
              PointsBalance: 200,
              LifetimeRedeemedPoints: 0,
              TierCode: 'BRONZE',
            },
          ],
        },
      ]),
    );
    txQueryResults = [{ recordset: [] }, { recordset: [] }];

    const { POST } = await import(
      '@/app/api/public/client/loyalty/rewards/[rewardId]/redeem/route'
    );
    const res = await POST(
      new NextRequest(
        'http://localhost/api/public/client/loyalty/rewards/1/redeem?clientId=1',
        { method: 'POST', body: JSON.stringify({ confirm: true }) },
      ),
      { params: Promise.resolve({ rewardId: '1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      message: 'تم استبدال المكافأة بنجاح',
      newBalance: 100,
      redemption: {
        rewardId: 1,
        pointsCost: 100,
        code: 'REDEEM-1-1-ABC',
      },
    });
  });
});
