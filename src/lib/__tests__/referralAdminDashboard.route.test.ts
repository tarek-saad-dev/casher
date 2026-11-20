// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({
  auth: { ok: true, tenantId: '01234567-89ab-4cde-8fab-0123456789ab', userId: 7 } as Record<string, unknown> | null,
  getDashboard: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireAdmin: vi.fn(async () => mock.auth ??
    NextResponse.json({ error: 'Forbidden' }, { status: 403 })),
  isAuthResult: (value: unknown) =>
    Boolean(value && typeof value === 'object' && (value as {ok?:boolean}).ok === true),
}));
vi.mock('@/lib/referrals/referralAdminDashboard.service', async () => {
  const { ReferralCheckoutError } = await import('@/lib/referrals/referralCheckoutPolicy');
  return {
  getTenantReferralAdminDashboard: (...args: unknown[]) => mock.getDashboard(...args),
  parseReferralAdminQuery: (url: URL) => {
    const view = url.searchParams.get('view') ?? 'claims';
    const status = url.searchParams.get('status') ?? 'all';
    const page = Number(url.searchParams.get('page') ?? '1');
    if (!['claims', 'codes'].includes(view) || !Number.isSafeInteger(page) || page < 1 ||
      !['all', 'APPLIED', 'REVERSED', 'PENDING', 'CANCELLED', 'active', 'inactive'].includes(status)) {
      throw new ReferralCheckoutError('REFERRAL_NOT_ELIGIBLE', 'bad request', 400);
    }
    return { view, status, page, search: url.searchParams.get('search') ?? '' };
  },
  };
});

import { GET } from '@/app/api/admin/cut-club/referrals/route';
import { ReferralCheckoutError } from '@/lib/referrals/referralCheckoutPolicy';
function request(suffix = ''): import('next/server').NextRequest {
  return new Request('https://test.invalid/api/admin/cut-club/referrals' + suffix) as
    unknown as import('next/server').NextRequest;
}
beforeEach(() => {
  mock.auth = { ok: true, tenantId: '01234567-89ab-4cde-8fab-0123456789ab', userId: 7 };
  mock.getDashboard.mockReset().mockResolvedValue({
    view: 'claims', page: 1, status: 'all', search: '',
    pageSize: 20, total: 0, totalPages: 0, claims: [], codes: [],
    summary: { issuedCodes: 0, activeCodes: 0,
      successfulReferrals: 0, refundedReferrals: 0,
      rewardsIssued: 0, rewardsAvailable: 0, rewardsUsed: 0 },
  });
});

describe('admin/cut-club/referrals GET auth and tenant guards', () => {
  it('blocks non-admin before querying SQL or disclosing business data', async () => {
    mock.auth = null;
    const r = await GET(request());
    expect(r.status).toBe(403);
    expect(mock.getDashboard).not.toHaveBeenCalled();
  });

  it('uses only authenticated manager tenant, ignores browser tenantId completely', async () => {
    const r = await GET(request(
      '?view=claims&status=REVERSED&page=2&search=' + encodeURIComponent('كريم') +
      '&tenantId=00000000-0000-0000-0000-000000000001',
    ));
    expect(r.status).toBe(200);
    expect(mock.getDashboard).toHaveBeenCalledWith({
      tenantId: '01234567-89ab-4cde-8fab-0123456789ab',
      view: 'claims', status: 'REVERSED', page: 2, search: 'كريم',
    });
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('fails closed when reward schema or admin flag unavailable (503)', async () => {
    mock.getDashboard.mockRejectedValue(new ReferralCheckoutError(
      'REFERRAL_SCHEMA_UNAVAILABLE', 'schema absent', 503,
    ));
    const r = await GET(request());
    expect(r.status).toBe(503);
    expect((await r.json()).dashboard).toBeUndefined();
  });

  it('keeps unsafe filters a 400 error rather than running a full report', async () => {
    mock.getDashboard.mockRejectedValue(new ReferralCheckoutError(
      'REFERRAL_NOT_ELIGIBLE', 'invalid filter', 400,
    ));
    const r = await GET(request('?view=claims&status=FAKE'));
    expect(r.status).toBe(400);
  });
});
