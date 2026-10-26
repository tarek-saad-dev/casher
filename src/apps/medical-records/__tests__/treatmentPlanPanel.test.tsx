// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TreatmentPlanPanel from '@/app/clinic/TreatmentPlanPanel';

const encounterId = 'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2';
const planId = 'bd42d0c7-1bef-4561-9a41-bb1891b71ac8';
const plan = {
  planId, title: 'علاج طبيعي', totalSessions: 2, sourceEncounterId: encounterId,
  progress: { total: 2, completed: 1, remaining: 1, booked: 0, needsRebooking: 0, percent: 50 },
  sessions: [
    { sessionNumber: 1, bookingId: 19, bookingDate: '2026-10-26',
      bookingStatus: 'completed', encounterId: 'visit-19', encounterStatus: 'completed' },
    { sessionNumber: 2, bookingId: null, bookingDate: null,
      bookingStatus: null, encounterId: null, encounterStatus: null },
  ],
};
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });

describe('treatment plan panel', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/clinic/treatment-plans?')) return response({ plans: [plan] });
      if (options?.method === 'POST') return response({ bookingId: 20, planId }, 201);
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows performed vs remaining sessions and opens the real clinical visit', async () => {
    render(<TreatmentPlanPanel encounterId={encounterId} canCreate />);
    await screen.findByText('علاج طبيعي');
    expect(screen.getByText(/جلسات منفذة: 1/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'تقدم علاج طبيعي' })
      .getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByRole('link', { name: /فتح الكشف/ }).getAttribute('href'))
      .toBe('/clinic/encounters/visit-19');
  });

  it('links an existing appointment, never creating an alternative appointment model', async () => {
    render(<TreatmentPlanPanel encounterId={encounterId} canCreate />);
    await screen.findByText('علاج طبيعي');
    fireEvent.change(screen.getByLabelText('رقم حجز جلسة 2 من علاج طبيعي'),
      { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'ربط الحجز' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, opts]) =>
      url === '/api/clinic/treatment-plans/' + planId + '/sessions/2/booking' &&
      JSON.parse(String(opts.body)).bookingId === 20,
    )).toBe(true));
  });

  it('prevents new plan creation while encounter is not completed', async () => {
    render(<TreatmentPlanPanel encounterId={encounterId} canCreate={false} />);
    await screen.findByText('علاج طبيعي');
    expect(screen.queryByRole('button', { name: 'إنشاء الخطة' })).toBeNull();
  });
});
