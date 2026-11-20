// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ReferralAdminPage, {
  parseReferralAdminResponse,
} from '@/app/admin/cut-club/referrals/page';

const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const summary = {
  issuedCodes: 5, activeCodes: 4, successfulReferrals: 2,
  refundedReferrals: 1, rewardsIssued: 3, rewardsAvailable: 1, rewardsUsed: 2,
};
const claim = {
  id: 22, code: CODE, referrerName: 'محمد السيد',
  referredName: 'أحمد حسن', status: 'REVERSED',
  originalInvoiceId: 500, claimedAtUtc: '2026-11-01T00:00:00.000Z',
  appliedAtUtc: '2026-11-02T00:00:00.000Z',
  reversedAtUtc: '2026-11-06T00:00:00.000Z', rewardStatus: 'ACTIVE',
};
const code = {
  id: 20, code: CODE, customerName: 'محمد السيد',
  activatedAtUtc: '2026-11-01T00:00:00.000Z',
  createdAtUtc: '2026-10-31T00:00:00.000Z',
  referrals: 3, refunded: 1, availableRewards: 1, usedRewards: 2,
};
function dashboard(view: 'claims' | 'codes', page: number, status: string, search: string, total = 1) {
  return { ok: true, dashboard: {
    summary, view, page, status, search,
    pageSize: 20, total, totalPages: Math.ceil(total / 20),
    claims: view === 'claims' && total ? [claim] : [],
    codes: view === 'codes' && total ? [code] : [],
  } };
}
function mockFetch(total = 1) {
  const fetcher = vi.fn().mockImplementation(async (input: string) => {
    const url = new URL(input, 'https://test.invalid');
    const view = url.searchParams.get('view') === 'codes' ? 'codes' : 'claims';
    const page = Number(url.searchParams.get('page'));
    const status = url.searchParams.get('status') ?? 'all';
    const search = url.searchParams.get('search') ?? '';
    return { ok: true, status: 200, json: async () => dashboard(view, page, status, search, total) };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('manager referral dashboard live ledger, not mock data (#240)', () => {
  it('refuses malformed data or wrong table response', () => {
    for (const body of [
      { ok: false },
      dashboard('codes', 1, 'all', ''),
      { ok: true, dashboard: { ...dashboard('claims', 1, 'all', '').dashboard, page: 5 } },
      { ok: true, dashboard: { ...dashboard('claims', 1, 'all', '').dashboard,
        summary: { ...summary, rewardsAvailable: 999 } } },
      { ok: true, dashboard: { ...dashboard('claims', 1, 'all', '').dashboard,
        claims: [{ ...claim, code: 'CUT-123' }] } },
    ]) {
      expect(() => parseReferralAdminResponse(body, 'claims', 1)).toThrow('INVALID_DASHBOARD');
    }
  });

  it('renders actual tenant ledger aggregates and refunded reward still issued', async () => {
    const fetcher = mockFetch();
    render(<ReferralAdminPage />);
    await waitFor(() => expect(screen.getByTestId('admin-referral-summary')).toBeInTheDocument());
    expect(screen.getByText('أكواد مفعّلة')).toBeInTheDocument();
    expect(screen.getByText('إحالات مسترجعة')).toBeInTheDocument();
    expect(screen.getByTestId('admin-referral-claim-row')).toHaveTextContent('محمد السيد');
    expect(screen.getByTestId('admin-referral-claim-row')).toHaveTextContent('أحمد حسن');
    expect(screen.getByTestId('admin-referral-claim-row')).toHaveTextContent('الفاتورة مسترجعة');
    expect(screen.getByTestId('admin-referral-claim-row')).toHaveTextContent('مُصدرة');
    expect(screen.queryByText('نقاط')).not.toBeInTheDocument();
    expect(screen.queryByText('الدعوات المرسلة')).not.toBeInTheDocument();
    expect(fetcher.mock.calls[0]?.[0]).toContain('/api/admin/cut-club/referrals?');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
    });
  });

  it('switches to real code inventory and respects code-status filter', async () => {
    const fetcher = mockFetch();
    render(<ReferralAdminPage />);
    await waitFor(() => expect(screen.getByTestId('admin-referral-claim-row')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('admin-referral-tab-codes'));
    await waitFor(() => expect(screen.getByTestId('admin-referral-code-row')).toBeInTheDocument());
    expect(screen.getByTestId('admin-referral-code-row')).toHaveTextContent(CODE);
    expect(screen.getByTestId('admin-referral-code-row')).toHaveTextContent('محمد السيد');
    fireEvent.change(screen.getByTestId('admin-referral-status'), { target: { value: 'active' } });
    await waitFor(() => expect(fetcher.mock.calls.some(c =>
      String(c[0]).includes('status=active'))).toBe(true));
    expect(screen.queryByTestId('admin-referral-claim-row')).not.toBeInTheDocument();
  });

  it('search submits literal name and refreshes server data without client-side mock filtering', async () => {
    const fetcher = mockFetch();
    render(<ReferralAdminPage />);
    await waitFor(() => expect(screen.getByTestId('admin-referral-summary')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('admin-referral-search'), {
      target: { value: 'كريم' },
    });
    fireEvent.click(screen.getByTestId('admin-referral-search-submit'));
    await waitFor(() => expect(fetcher.mock.calls.some(c =>
      String(c[0]).includes('search=%D9%83%D8%B1%D9%8A%D9%85'))).toBe(true));
    const before = fetcher.mock.calls.length;
    fireEvent.click(screen.getByTestId('admin-referral-refresh'));
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows genuine empty state for empty ledger, not fake invitations', async () => {
    mockFetch(0);
    render(<ReferralAdminPage />);
    await waitFor(() => expect(screen.getByTestId('admin-referral-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-referral-claim-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-referral-next')).toBeDisabled();
  });

  it('does not display old data when server denies admin access or schema is disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    vi.stubGlobal('fetch', fetcher);
    render(<ReferralAdminPage />);
    await waitFor(() => expect(screen.getByTestId('admin-referral-error')).toHaveTextContent('غير مفعّلة'));
    expect(screen.queryByTestId('admin-referral-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-referral-claim-row')).not.toBeInTheDocument();
  });

  it('paginates by requesting only a SQL-bounded server page', async () => {
    const fetcher = mockFetch(60);
    render(<ReferralAdminPage />);
    await waitFor(() => expect(screen.getByTestId('admin-referral-summary')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('admin-referral-next'));
    await waitFor(() => expect(fetcher.mock.calls.some(c => String(c[0]).includes('page=2'))).toBe(true));
    expect(screen.getByTestId('admin-referral-prev')).not.toBeDisabled();
  });
});
