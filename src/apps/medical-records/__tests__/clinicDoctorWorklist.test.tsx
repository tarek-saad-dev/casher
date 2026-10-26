// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClinicDoctorWorklist from '@/app/clinic/ClinicDoctorWorklist';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const today = [
  {
    BookingID: 19, BookingDate: '2026-10-26', StartTimeDisplay: '18:00',
    ClientID: 5, PatientName: 'أحمد', PractitionerEmpID: 42, PractitionerName: 'محمد',
    Status: 'confirmed', EncounterId: null, EncounterStatus: null,
  },
  {
    BookingID: 20, BookingDate: '2026-10-26', StartTimeDisplay: '18:30',
    ClientID: 6, PatientName: 'سارة', PractitionerEmpID: 42, PractitionerName: 'محمد',
    Status: 'arrived', EncounterId: null, EncounterStatus: null,
  },
  {
    BookingID: 21, BookingDate: '2026-10-26', StartTimeDisplay: '19:00',
    ClientID: 7, PatientName: 'ليلى', PractitionerEmpID: 42, PractitionerName: 'محمد',
    Status: 'in_service', EncounterId: 'visit-21', EncounterStatus: 'in_progress',
  },
];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('doctor daily clinical worklist UX', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/clinic/my-day?')) {
        return response({ practitionerEmpId: 42, date: '2026-10-26', appointments: today });
      }
      if (url === '/api/clinic/my-day/20' && options?.method === 'POST') {
        return response({ encounterId: 'visit-new', status: 'in_service' }, 201);
      }
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows doctor-only worklist and respects arrival requirement before start', async () => {
    render(<ClinicDoctorWorklist />);
    expect(screen.getByRole('heading', { name: 'جدول مرضاي' })).toBeTruthy();
    await screen.findByText('أحمد');
    expect(screen.getByText('سارة')).toBeTruthy();
    expect(screen.getByText('ليلى')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'بدء الكشف' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'فتح الكشف' }).getAttribute('href'))
      .toBe('/clinic/encounters/visit-21');
  });

  it('filters by waiting and patient search without fetching other clinicians', async () => {
    render(<ClinicDoctorWorklist />);
    await screen.findByText('أحمد');
    fireEvent.click(screen.getByRole('button', { name: 'جاهزين للكشف (1)' }));
    expect(screen.queryByText('أحمد')).toBeNull();
    expect(screen.getByText('سارة')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'كل المواعيد' }));
    fireEvent.change(screen.getByLabelText('البحث في مرضاي'), { target: { value: 'ليلى' } });
    expect(screen.queryByText('سارة')).toBeNull();
    expect(screen.getByText('ليلى')).toBeTruthy();
  });

  it('starts only through the actor-scoped clinical POST and opens the encounter', async () => {
    render(<ClinicDoctorWorklist />);
    await screen.findByText('سارة');
    fireEvent.click(screen.getByRole('button', { name: 'بدء الكشف' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/clinic/encounters/visit-new'));
    const [, options] = fetchMock.mock.calls.find(([url, opts]) =>
      url === '/api/clinic/my-day/20' && opts?.method === 'POST',
    )!;
    expect(JSON.parse(options.body)).toEqual({ action: 'start' });
  });

  it('explains identity setup for an unlinked clinician without showing patient names', async () => {
    fetchMock.mockResolvedValue(response({
      code: 'CLINIC_DOCTOR_NOT_LINKED', error: 'حسابك غير مربوط بطبيب',
    }, 403));
    render(<ClinicDoctorWorklist />);
    expect((await screen.findByRole('alert')).textContent).toContain('غير مربوط');
    expect(screen.getByText('حساب الطبيب مش جاهز لسه')).toBeTruthy();
    expect(screen.queryByText('أحمد')).toBeNull();
    expect(screen.queryByRole('button', { name: 'بدء الكشف' })).toBeNull();
  });

  it('keeps operational errors visible after a server rejection and refresh', async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return response({ error: 'تغير الطبيب المسؤول عن الحجز' }, 409);
      return response({ practitionerEmpId: 42, date: '2026-10-26', appointments: today });
    });
    render(<ClinicDoctorWorklist />);
    await screen.findByText('سارة');
    fireEvent.click(screen.getByRole('button', { name: 'بدء الكشف' }));
    await waitFor(() => expect((screen.getByRole('alert')).textContent).toContain('تغير الطبيب'));
    expect(router.push).not.toHaveBeenCalled();
  });
});
