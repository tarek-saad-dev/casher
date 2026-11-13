// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/referrals/posReferralPreview', async (loadActual) => {
  const actual = await loadActual<typeof import('@/lib/referrals/posReferralPreview')>();
  return { ...actual, fetchPosReferralPreview: vi.fn() };
});

import PosReferralPreview from '@/components/pos/PosReferralPreview';
import { fetchPosReferralPreview } from '@/lib/referrals/posReferralPreview';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const mockedFetch = vi.mocked(fetchPosReferralPreview);

beforeEach(() => { mockedFetch.mockReset(); });
afterEach(cleanup);

function inspectCode() {
  fireEvent.change(screen.getByTestId('referral-code-input'), { target: { value: CODE } });
  fireEvent.click(screen.getByTestId('referral-check-button'));
}

describe('cashier explicit referral discount application (#229)', () => {
  it('does not apply from eligible preview until cashier confirms', async () => {
    const onApply = vi.fn();
    mockedFetch.mockResolvedValue({ state: 'eligible', reason: null, discountPercent: 50 });
    render(<PosReferralPreview clientId={123} canApply onApply={onApply} />);
    inspectCode();
    await waitFor(() => expect(screen.getByTestId('referral-apply-button')).toBeEnabled());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('referral-preview-result')).toHaveTextContent('مش مطبّق');
    fireEvent.click(screen.getByTestId('referral-apply-button'));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(CODE, 123);
  });

  it('disables apply for manual discount or no service in invoice', async () => {
    const onApply = vi.fn();
    mockedFetch.mockResolvedValue({ state: 'eligible', reason: null, discountPercent: 50 });
    render(<PosReferralPreview clientId={123} canApply={false} onApply={onApply} />);
    inspectCode();
    await waitFor(() => expect(screen.getByTestId('referral-apply-button')).toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent('خصومات يدوية');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('never offers Apply for a denied or unavailable referral', async () => {
    const onApply = vi.fn();
    mockedFetch.mockResolvedValue({ state: 'ineligible', discountPercent: 0, reason: 'ALREADY_CLAIMED' });
    const { rerender } = render(<PosReferralPreview clientId={123} canApply onApply={onApply} />);
    inspectCode();
    await waitFor(() => expect(screen.getByTestId('referral-preview-result')).toHaveTextContent('استخدم إحالة'));
    expect(screen.queryByTestId('referral-apply-button')).not.toBeInTheDocument();
    mockedFetch.mockResolvedValue({ state: 'not_ready' });
    fireEvent.change(screen.getByTestId('referral-code-input'), { target: { value: '' } });
    inspectCode();
    await waitFor(() => expect(screen.getByTestId('referral-preview-result')).toHaveTextContent('غير متاح'));
    expect(screen.queryByTestId('referral-apply-button')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    rerender(<PosReferralPreview clientId={123} canApply={false} onApply={onApply} />);
  });

  it('shows applied state and can revoke without a voucher write', async () => {
    const onRemove = vi.fn();
    render(<PosReferralPreview clientId={123} appliedCode={CODE} canApply={false} onRemove={onRemove} />);
    expect(screen.getByTestId('referral-remove-button')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('تم تطبيق خصم 50%');
    expect(screen.getByTestId('referral-preview-disclaimer')).toHaveTextContent('السيرفر سيؤكد');
    fireEvent.click(screen.getByTestId('referral-remove-button'));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('removes the applied code immediately if cashier edits code field', () => {
    const onRemove = vi.fn();
    render(<PosReferralPreview clientId={123} appliedCode={CODE} onRemove={onRemove} />);
    fireEvent.change(screen.getByTestId('referral-code-input'), { target: { value: 'CUT-123' } });
    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('referral-preview-result')).not.toBeInTheDocument();
  });

  it('aborts a prior preview when typing a new code before applying', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchPosReferralPreview>>) => void;
    mockedFetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onApply = vi.fn();
    render(<PosReferralPreview clientId={123} onApply={onApply} canApply />);
    inspectCode();
    const signal = mockedFetch.mock.calls[0]?.[2];
    expect(signal).toBeTruthy();
    fireEvent.change(screen.getByTestId('referral-code-input'), { target: { value: 'CUT-123' } });
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ state: 'eligible', reason: null, discountPercent: 50 }); });
    expect(screen.queryByTestId('referral-apply-button')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
