import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockRequireTenantSession, mockPreview } = vi.hoisted(() => ({
  mockRequireTenantSession: vi.fn(),
  mockPreview: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireTenantSession: mockRequireTenantSession }));
vi.mock('@/lib/referrals/referralPreview.service', () => ({
  getTenantReferralPreview: mockPreview,
  ReferralPreviewNotFoundError: class ReferralPreviewNotFoundError extends Error {},
  ReferralPreviewUnavailableError: class ReferralPreviewUnavailableError extends Error {},
}));

import { GET } from '@/app/api/pos/referrals/preview/route';
import {
  ReferralPreviewNotFoundError,
  ReferralPreviewUnavailableError,
} from '@/lib/referrals/referralPreview.service';

const url = 'http://localhost/api/pos/referrals/preview?code=CUT-ABCDEF0123456789ABCDEF01&referredClientId=34';
const tenant = '01234567-89ab-4cde-8fab-0123456789ab';

describe('staff-only referral code preview API', () => {
  beforeEach(() => {
    mockRequireTenantSession.mockReset();
    mockPreview.mockReset();
    mockRequireTenantSession.mockResolvedValue({ TenantId: tenant });
    mockPreview.mockResolvedValue({
      ok: true, eligible: true, discountPercent: 50, reason: null, previewOnly: true,
    });
  });

  it('blocks unauthenticated requests before touching customer data', async () => {
    mockRequireTenantSession.mockResolvedValue(
      NextResponse.json({ error: 'login required' }, { status: 401 }),
    );
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(401);
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('accepts a valid staff request and binds tenant from the session, not the URL', async () => {
    const response = await GET(new NextRequest(url + '&tenantId=another-tenant'));
    expect(response.status).toBe(200);
    expect(mockPreview).toHaveBeenCalledExactlyOnceWith({
      tenantId: tenant,
      referredClientId: 34,
      code: 'CUT-ABCDEF0123456789ABCDEF01',
    });
    expect(await response.json()).toMatchObject({ previewOnly: true, discountPercent: 50 });
  });

  it.each([
    url.replace('referredClientId=34', 'referredClientId=01012345678'),
    url.replace('referredClientId=34', 'referredClientId=2147483648'),
    url.replace('referredClientId=34', 'referredClientId=34x'),
    url.replace('CUT-ABCDEF0123456789ABCDEF01', 'BAD'),
  ])('returns 400 without reading DB for invalid request', async (invalidUrl) => {
    const response = await GET(new NextRequest(invalidUrl));
    expect(response.status).toBe(400);
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('responds with the same non-disclosing 404 for missing code or missing customer', async () => {
    mockPreview.mockRejectedValue(new ReferralPreviewNotFoundError());
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not fail open when schema has not been installed', async () => {
    mockPreview.mockRejectedValue(new ReferralPreviewUnavailableError());
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'REFERRALS_NOT_READY' });
  });
});
