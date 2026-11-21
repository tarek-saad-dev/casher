// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosReferralRewardWallet from '@/components/pos/PosReferralRewardWallet';

const NOW = '2026-11-01T00:00:00.000Z';
function walletResponse(clientId: number, ids: number[]) {
  return { ok: true, previewOnly: true, clientId,
    vouchers: ids.map(voucherId => ({
      voucherId, discountPercent: 20, issuedAtUtc: NOW, expiresAtUtc: null,
    })),
  };
}
function stubResponse(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('staff POS wallet selector — no early voucher usage (#233)', () => {
  it('requests only tenant-authenticated GET for the selected customer and requires explicit Apply', async () => {
    const fetcher = stubResponse(walletResponse(45, [301, 302]));
    const onApply = vi.fn();
    render(<PosReferralRewardWallet clientId={45} canApply
      onApply={onApply} onRemove={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('wallet-apply-301')).toBeEnabled());
    expect(onApply).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/pos/referrals/wallet?clientId=45');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    expect(options.body).toBeUndefined();
    fireEvent.click(screen.getByTestId('wallet-apply-301'));
    expect(onApply).toHaveBeenCalledWith(301, 45);
    // Not a preconsume POST /api/pos/client-inventory/use
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('disables Apply when invoice has an incompatible discount', async () => {
    stubResponse(walletResponse(45, [301]));
    const onApply = vi.fn();
    render(<PosReferralRewardWallet clientId={45} canApply={false}
      onApply={onApply} onRemove={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('wallet-apply-301')).toBeDisabled());
    fireEvent.click(screen.getByTestId('wallet-apply-301'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('gives an explicit Remove button for a reward applied to draft', async () => {
    stubResponse(walletResponse(45, [301]));
    const onRemove = vi.fn();
    render(<PosReferralRewardWallet clientId={45} appliedVoucherId={301} canApply={false}
      onApply={vi.fn()} onRemove={onRemove} />);
    expect(screen.getByTestId('wallet-remove')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wallet-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders empty wallet with no Apply button', async () => {
    stubResponse(walletResponse(45, []));
    render(<PosReferralRewardWallet clientId={45} canApply
      onApply={vi.fn()} onRemove={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('wallet-empty')).toBeInTheDocument());
    expect(screen.queryByText('تطبيق')).not.toBeInTheDocument();
  });

  it('fails closed on malformed/wrong-client wallet API response', async () => {
    const fetcher = stubResponse(walletResponse(99, [301]));
    render(<PosReferralRewardWallet clientId={45} canApply
      onApply={vi.fn()} onRemove={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذر تحميل محفظة'));
    expect(screen.queryByTestId('wallet-apply-301')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('handles 503/missing backend as unavailable rather than granting client-side voucher', async () => {
    stubResponse({ ok: false }, 503);
    render(<PosReferralRewardWallet clientId={45} canApply
      onApply={vi.fn()} onRemove={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('مفيش مكافأة هتتطبق'));
  });
});
