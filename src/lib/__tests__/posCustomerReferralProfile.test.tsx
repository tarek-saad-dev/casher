// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosCustomerReferralProfile, {
  buildCustomerReferralWhatsAppShare,
  parseCustomerReferralProfileResponse,
} from '@/components/pos/PosCustomerReferralProfile';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const profile = {
  clientId: 45, code: CODE, codeActivated: true,
  successfulReferrals: 2, refundedReferrals: 1,
  totalRewardedReferrals: 3, earnedRewards: 3, availableRewards: 1, usedRewards: 2,
};
function stubFetch(payload: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    json: async () => payload,
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('staff-only permanent referral profile + safe share UX (#237)', () => {
  it('refuses invalid code and inconsistent/mismatched server responses', () => {
    for (const response of [
      { ok: true, profile: { ...profile, clientId: 99 } },
      { ok: true, profile: { ...profile, code: 'CUT-123' } },
      { ok: true, profile: { ...profile, code: null, codeActivated: true } },
      { ok: true, profile: { ...profile, totalRewardedReferrals: 9 } },
      { ok: true, profile: { ...profile, availableRewards: 99 } },
      { ok: false, profile },
      { profile },
    ]) {
      expect(() => parseCustomerReferralProfileResponse(response, 45))
        .toThrow('INVALID_REFERRAL_PROFILE');
    }
  });

  it('share URL includes only authentic code and message, no customer PII', () => {
    const link = buildCustomerReferralWhatsAppShare(CODE);
    const url = new URL(link);
    expect(url.hostname).toBe('wa.me');
    const message = url.searchParams.get('text') ?? '';
    expect(message).toContain(CODE);
    expect(message).toContain('Cut Salon');
    expect(message).not.toContain('ClientID=');
    expect(message).not.toContain('رقم الهاتف');
    expect(() => buildCustomerReferralWhatsAppShare('CUT-123')).toThrow();
  });

  it('does not fetch or mutate until staff opens a selected customer profile', async () => {
    const fetcher = stubFetch({ ok: true, profile });
    render(<PosCustomerReferralProfile clientId={45} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('customer-referral-open'));
    await waitFor(() => expect(screen.getByTestId('customer-referral-code')).toHaveTextContent(CODE));
    expect(screen.getByTestId('customer-referral-total')).toHaveTextContent('3');
    expect(screen.getByTestId('customer-referral-available')).toHaveTextContent('1');
    expect(screen.getByTestId('customer-referral-used')).toHaveTextContent('2');
    expect(screen.getByTestId('customer-referral-refunded')).toHaveTextContent('تفضل صالحة');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/pos/referrals/customer-profile?clientId=45');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
    const share = screen.getByTestId('customer-referral-whatsapp') as HTMLAnchorElement;
    expect(share.href).toContain('https://wa.me/?text=');
    expect(share.rel).toBe('noopener noreferrer');
  });

  it('never displays a pre-visit code or share option before activation', async () => {
    stubFetch({ ok: true, profile: {
      ...profile, code: null, codeActivated: false,
      totalRewardedReferrals: 0, successfulReferrals: 0, refundedReferrals: 0,
      earnedRewards: 0, availableRewards: 0, usedRewards: 0,
    } });
    render(<PosCustomerReferralProfile clientId={45} />);
    fireEvent.click(screen.getByTestId('customer-referral-open'));
    await waitFor(() => expect(screen.getByTestId('customer-referral-not-activated')).toBeInTheDocument());
    expect(screen.queryByTestId('customer-referral-whatsapp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('customer-referral-code')).not.toBeInTheDocument();
  });

  it('fails closed on malformed and 503 profile responses', async () => {
    stubFetch({ ok: false, profile }, 503);
    render(<PosCustomerReferralProfile clientId={45} />);
    fireEvent.click(screen.getByTestId('customer-referral-open'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذر تحميل ملف الإحالات'));
    expect(screen.queryByTestId('customer-referral-whatsapp')).not.toBeInTheDocument();
  });

  it('copies the actual code on click, never copies a fabricated code', async () => {
    const fetcher = stubFetch({ ok: true, profile });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PosCustomerReferralProfile clientId={45} />);
    fireEvent.click(screen.getByTestId('customer-referral-open'));
    await waitFor(() => expect(screen.getByTestId('customer-referral-code')).toHaveTextContent(CODE));
    fireEvent.click(screen.getByTestId('customer-referral-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
