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

beforeEach(() => mockedFetch.mockReset());
afterEach(cleanup);

function typeCode(text: string) {
  fireEvent.change(screen.getByTestId('referral-code-input'), { target: { value: text } });
}

function check() {
  fireEvent.click(screen.getByTestId('referral-check-button'));
}

describe('POS customer referral preview UI', () => {
  it('keeps every preview explicitly non-financial', () => {
    mockedFetch.mockResolvedValue({ state: 'eligible', reason: null, discountPercent: 50 });
    render(<PosReferralPreview clientId={23} />);
    expect(screen.getByTestId('referral-preview-disclaimer')).toHaveTextContent('لن يُطبّق أي خصم');
    expect(screen.queryByTestId('referral-preview-result')).not.toBeInTheDocument();
  });

  it('rejects malformed codes locally without reaching the server', async () => {
    render(<PosReferralPreview clientId={23} />);
    typeCode('CUT-123');
    check();
    expect(screen.getByRole('alert')).toHaveTextContent('اكتب الكود كامل');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows eligible preview but never claims the invoice discount is applied', async () => {
    mockedFetch.mockResolvedValue({ state: 'eligible', reason: null, discountPercent: 50 });
    render(<PosReferralPreview clientId={45} />);
    typeCode(CODE.toLowerCase());
    check();
    await waitFor(() => expect(screen.getByTestId('referral-preview-result')).toHaveTextContent('صالح مبدئيًا'));
    expect(screen.getByTestId('referral-preview-result')).toHaveTextContent('مش مطبّق');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe(45);
    expect(mockedFetch.mock.calls[0]?.[1]).toBe(CODE);
  });

  it('does not retain a previous result when cashier edits the code', async () => {
    mockedFetch.mockResolvedValue({ state: 'eligible', reason: null, discountPercent: 50 });
    render(<PosReferralPreview clientId={45} />);
    typeCode(CODE);
    check();
    await waitFor(() => expect(screen.getByTestId('referral-preview-result')).toBeInTheDocument());
    typeCode('CUT-123');
    expect(screen.queryByTestId('referral-preview-result')).not.toBeInTheDocument();
  });

  it('prevents a slow old response from overwriting a changed code', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchPosReferralPreview>>) => void;
    mockedFetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<PosReferralPreview clientId={45} />);
    typeCode(CODE);
    check();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const signal = mockedFetch.mock.calls[0]![2];
    typeCode('CUT-123');
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ state: 'eligible', reason: null, discountPercent: 50 }); });
    expect(screen.queryByTestId('referral-preview-result')).not.toBeInTheDocument();
  });

  it('discards previous customer code and state on keyed customer switch', async () => {
    mockedFetch.mockResolvedValue({ state: 'eligible', reason: null, discountPercent: 50 });
    const { rerender } = render(<PosReferralPreview key="45" clientId={45} />);
    typeCode(CODE);
    check();
    await waitFor(() => expect(screen.getByTestId('referral-preview-result')).toBeInTheDocument());
    rerender(<PosReferralPreview key="46" clientId={46} />);
    expect(screen.getByTestId('referral-code-input')).toHaveValue('');
    expect(screen.queryByTestId('referral-preview-result')).not.toBeInTheDocument();
  });

  it('shows service unavailability, duplicate claim, and generic failures', async () => {
    const scenarios = [
      [{ state: 'not_ready' } as const, 'غير متاح'],
      [{ state: 'ineligible', reason: 'ALREADY_CLAIMED', discountPercent: 0 } as const, 'استخدم إحالة قبل كده'],
      [{ state: 'not_found' } as const, 'غير موجود'],
      [{ state: 'unauthorized' } as const, 'سجّل الدخول'],
      [{ state: 'error' } as const, 'تعذر فحص الكود'],
    ];
    const { unmount } = render(<PosReferralPreview clientId={23} />);
    for (const [outcome, message] of scenarios) {
      mockedFetch.mockResolvedValueOnce(outcome);
      typeCode(CODE);
      check();
      await waitFor(() => expect(screen.getByTestId('referral-preview-result')).toHaveTextContent(message));
      typeCode('');
    }
    unmount();
  });
});
