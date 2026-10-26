// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClinicAppointmentsPanel from '@/app/clinic/ClinicAppointmentsPanel';
import ClinicReceptionPage from '@/app/clinic/ClinicReceptionPage';

const routing = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => routing }));

const appointments = [
  {
    BookingID: 19, BookingDate: '2026-10-26', StartTimeDisplay: '18:00',
    ClientID: 5, PatientName: 'أحمد علي', PractitionerEmpID: 12,
    PractitionerName: 'محمد', Status: 'confirmed', EncounterId: null, EncounterStatus: null,
  },
  {
    BookingID: 20, BookingDate: '2026-10-26', StartTimeDisplay: '18:30',
    ClientID: 6, PatientName: 'سارة حسن', PractitionerEmpID: 15,
    PractitionerName: 'منى', Status: 'arrived', EncounterId: null, EncounterStatus: null,
  },
];

describe('clinic reception workspace', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/clinic/appointments?date=')) {
        return new Response(JSON.stringify({ appointments }), { status: 200 });
      }
      if (url === '/api/clinic/appointments/19' && options?.method === 'POST') {
        return new Response(JSON.stringify({ bookingId: 19, status: 'arrived' }), { status: 200 });
      }
      if (url === '/api/clinic/appointments/20' && options?.method === 'POST') {
        return new Response(JSON.stringify({ bookingId: 20, status: 'in_service', encounterId: 'visit-20' }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows daily reception summary and shared booking operations', async () => {
    render(<ClinicReceptionPage />);
    expect(screen.getByRole('heading', { name: 'استقبال العيادة' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'حجز جديد' }).getAttribute('href')).toBe('/bookings');
    expect(screen.getByRole('link', { name: 'المرضى والأطباء' }).getAttribute('href')).toBe('/clinic/setup');
    await screen.findByText('أحمد علي');
    expect(screen.getByText('سارة حسن')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تسجيل حضور' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'بدء الكشف' })).toBeTruthy();
  });

  it('filters the queue by status, doctor and patient search', async () => {
    render(<ClinicAppointmentsPanel />);
    await screen.findByText('أحمد علي');
    fireEvent.click(screen.getByRole('button', { name: 'في الانتظار (1)' }));
    expect(screen.queryByText('أحمد علي')).toBeNull();
    expect(screen.getByText('سارة حسن')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('فلترة حسب الطبيب'), { target: { value: '12' } });
    expect(screen.getByText('مفيش نتائج مطابقة للفلاتر.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'عرض كل المواعيد' }));
    expect(screen.getByText('أحمد علي')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('بحث في مواعيد العيادة'), { target: { value: 'سارة' } });
    expect(screen.queryByText('أحمد علي')).toBeNull();
    expect(screen.getByText('سارة حسن')).toBeTruthy();
  });

  it('records arrival by calling the clinic adapter, not mutating a local booking copy', async () => {
    render(<ClinicAppointmentsPanel />);
    await screen.findByText('أحمد علي');
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل حضور' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(
      ([url, options]) => url === '/api/clinic/appointments/19'
        && options?.method === 'POST'
        && JSON.parse(String(options.body)).action === 'arrive',
    )).toBe(true));
  });

  it('opens the already linked clinical workspace on start', async () => {
    render(<ClinicAppointmentsPanel />);
    await screen.findByText('سارة حسن');
    fireEvent.click(screen.getByRole('button', { name: 'بدء الكشف' }));
    await waitFor(() => expect(routing.push).toHaveBeenCalledWith('/clinic/encounters/visit-20'));
  });

  it('preserves the error message if the canonical check-in update fails', async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'الحجز ملغي' }), { status: 409 });
      }
      return new Response(JSON.stringify({ appointments }), { status: 200 });
    });
    render(<ClinicAppointmentsPanel />);
    await screen.findByText('أحمد علي');
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل حضور' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'الحجز ملغي');
  });
});
