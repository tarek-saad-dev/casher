// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ClinicBillingHandoff from '@/app/clinic/ClinicBillingHandoff';

const encounterId = 'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2';
describe('completed clinic visit billing handoff', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('does not expose or fetch billing controls before encounter completion', () => {
    render(<ClinicBillingHandoff encounterId={encounterId} completed={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'إرسال الكشف للحسابات' })).toBeNull();
  });

  it('offers POS handoff only for a ready completed appointment', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      billingState: 'ready', invoiceId: null, services: [{ ProID: 9 }],
    }), { status: 200 }));
    render(<ClinicBillingHandoff encounterId={encounterId} completed />);
    const link = await screen.findByRole('link', { name: 'إرسال الكشف للحسابات' });
    expect(link.getAttribute('href')).toBe('/income/pos?clinicEncounterId=' + encounterId);
  });

  it('shows the existing invoice and hides second billing link for a billed visit', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      billingState: 'already_billed', invoiceId: 8188, services: [{ ProID: 9 }],
    }), { status: 200 }));
    render(<ClinicBillingHandoff encounterId={encounterId} completed />);
    await screen.findByText(/فاتورة للكشف بالفعل، رقم #8188/);
    expect(screen.queryByRole('link', { name: 'إرسال الكشف للحسابات' })).toBeNull();
  });

  it('shows a clear reason when the booked service is not chargeable', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      billingState: 'not_ready', invoiceId: null, services: [],
    }), { status: 200 }));
    render(<ClinicBillingHandoff encounterId={encounterId} completed />);
    await screen.findByText(/الزيارة مش جاهزة لحساب آلي/);
    expect(screen.queryByRole('link', { name: 'إرسال الكشف للحسابات' })).toBeNull();
  });
});
