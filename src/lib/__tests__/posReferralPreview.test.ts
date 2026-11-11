import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  fetchPosReferralPreview,
  normalizePosReferralCode,
  REFERRAL_PREVIEW_ENABLED,
} from '@/lib/referrals/posReferralPreview';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';

afterEach(() => { vi.unstubAllGlobals(); });

function response(status: number, body?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('POS referral read-only request contract', () => {
  it('defaults off until explicitly enabled', () => {
    // CI does not set this opt-in flag. The default must not activate public checkout UI.
    expect(REFERRAL_PREVIEW_ENABLED).toBe(false);
  });

  it('normalizes code and rejects bad input', () => {
    expect(normalizePosReferralCode('  cut-abcdef0123456789abcdef01 ')).toBe(CODE);
    for (const v of ['', 'CUT-123', 'CUT-ABCD;DROP', '123456', 'CUT-ABCDEFGH12345678ABCDEFGH']) {
      expect(normalizePosReferralCode(v)).toBeNull();
    }
  });

  it('sends GET, session cookies and no tenant/discount/payment payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      ok: true, previewOnly: true, eligible: true, discountPercent: 50, reason: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = await fetchPosReferralPreview(123, CODE.toLowerCase(), controller.signal);
    expect(result).toEqual({ state: 'eligible', reason: null, discountPercent: 50 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/pos/referrals/preview?code=CUT-ABCDEF0123456789ABCDEF01&referredClientId=123');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    expect(options.body).toBeUndefined();
  });

  it('never sends a call when client ID is invalid or code malformed', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    for (const id of [0, -1, 2.5, 2147483648, NaN]) {
      expect(await fetchPosReferralPreview(id, CODE, signal)).toMatchObject({ state: 'error' });
    }
    expect(await fetchPosReferralPreview(12, 'CUT-12', signal)).toMatchObject({ state: 'error' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not_found'],
    [503, 'not_ready'],
    [500, 'error'],
  ] as const)('handles HTTP %i without an eligibility claim', async (status, state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status)));
    await expect(fetchPosReferralPreview(5, CODE, new AbortController().signal))
      .resolves.toMatchObject({ state });
  });

  it('accepts only explicit read-only, internally consistent eligible responses', async () => {
    const cases = [
      { ok: true, previewOnly: false, eligible: true, discountPercent: 50, reason: null },
      { ok: true, previewOnly: true, eligible: true, discountPercent: 0, reason: null },
      { ok: true, previewOnly: true, eligible: false, discountPercent: 50, reason: 'ALREADY_CLAIMED' },
      { ok: true, previewOnly: true, eligible: false, discountPercent: 0, reason: 'OTHER' },
      { ok: true, previewOnly: true, eligible: true, discountPercent: 50, reason: 'SELF_REFERRAL' },
      { ok: false, previewOnly: true, eligible: true, discountPercent: 50, reason: null },
      { ok: true, eligible: true, discountPercent: 50, reason: null },
    ];
    for (const body of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, body)));
      expect(await fetchPosReferralPreview(5, CODE, new AbortController().signal))
        .toMatchObject({ state: 'error' });
    }
  });

  it('maps known denied reasons without converting them into discounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, {
      ok: true, previewOnly: true, eligible: false, discountPercent: 0, reason: 'ALREADY_CLAIMED',
    })));
    await expect(fetchPosReferralPreview(10, CODE, new AbortController().signal))
      .resolves.toEqual({ state: 'ineligible', reason: 'ALREADY_CLAIMED', discountPercent: 0 });
  });

  it('fails closed when the backend reply is invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200, ok: true, json: () => Promise.reject(new Error('invalid JSON')),
    }));
    await expect(fetchPosReferralPreview(7, CODE, new AbortController().signal))
      .resolves.toMatchObject({ state: 'error' });
  });
});
