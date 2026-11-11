// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({
  session: { TenantId: '01234567-89ab-4cde-8fab-0123456789ab', UserID: 3 } as object | null,
  getProfile: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireTenantSession: vi.fn(async () => mock.session ??
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
}));
vi.mock('@/lib/referrals/customerReferralProfile.service', () => ({
  getTenantCustomerReferralProfile: (...args: unknown[]) => mock.getProfile(...args),
}));
import { GET } from '@/app/api/pos/referrals/customer-profile/route';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const URL = 'http://localhost/api/pos/referrals/customer-profile?clientId=45';
function req(url: string): import('next/server').NextRequest {
  return new Request(url) as unknown as import('next/server').NextRequest;
}
beforeEach(() => {
  mock.session = { TenantId: '01234567-89ab-4cde-8fab-0123456789ab', UserID: 3 };
  mock.getProfile.mockReset().mockResolvedValue({
    clientId: 45, code: CODE, codeActivated: true,
    successfulReferrals: 2, refundedReferrals: 1,
    totalRewardedReferrals: 3, earnedRewards: 3, availableRewards: 1, usedRewards: 2,
  });
});
afterEach(() => mock.getProfile.mockReset());

describe('GET /api/pos/referrals/customer-profile (staff only)', () => {
  it('requires staff authentication', async () => {
    mock.session = null;
    const response = await GET(req(URL));
    expect(response.status).toBe(401);
    expect(mock.getProfile).not.toHaveBeenCalled();
  });
  it('validates integer ID and rejects injection/overflow without DB', async () => {
    for (const bad of ['0', '-1', '1%3Bdrop', '1e2', '9999999999999999', '']) {
      const response = await GET(req(URL.replace('45', bad)));
      expect(response.status).toBe(400);
    }
    expect(mock.getProfile).not.toHaveBeenCalled();
  });
  it('always uses tenant from staff session and never from request query', async () => {
    const response = await GET(req(URL + '&tenantId=00000000-0000-0000-0000-000000000001'));
    expect(response.status).toBe(200);
    expect(mock.getProfile).toHaveBeenCalledWith({
      clientId: 45, tenantId: '01234567-89ab-4cde-8fab-0123456789ab',
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).profile.code).toBe(CODE);
  });
  it('does not mask a missing/foreign client as a successful profile', async () => {
    const { ReferralCheckoutError } = await import('@/lib/referrals/referralCheckoutPolicy');
    mock.getProfile.mockRejectedValue(new ReferralCheckoutError(
      'REFERRAL_CLIENT_REQUIRED', 'العميل غير موجود', 404,
    ));
    const response = await GET(req(URL));
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).profile).toBeUndefined();
  });
  it('returns a safe 503 when feature/schema is disabled', async () => {
    const { ReferralCheckoutError } = await import('@/lib/referrals/referralCheckoutPolicy');
    mock.getProfile.mockRejectedValue(new ReferralCheckoutError(
      'REFERRAL_SCHEMA_UNAVAILABLE', 'جداول الإحالات غير متاحة', 503,
    ));
    const response = await GET(req(URL));
    expect(response.status).toBe(503);
  });
});
