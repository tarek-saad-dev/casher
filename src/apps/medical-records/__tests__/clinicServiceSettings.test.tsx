// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClinicServiceSettings from '@/app/clinic/ClinicServiceSettings';

const sharedServices = [
  { ProID: 102, ProName: 'Consultation', ProNameAr: 'كشف', SPrice1: 400,
    Bonus: 12, ImageUrl: '/clinic.png', CatID: 4, CatName: 'Clinic', CatType: 'serv', DurationMinutes: 30, isDeleted: 0 },
  { ProID: 103, ProName: 'Haircut', ProNameAr: 'حلاقة', SPrice1: 200,
    Bonus: 0, CatID: 5, CatName: 'Salon', CatType: 'serv', DurationMinutes: 30, isDeleted: 0 },
];

describe('clinic shared service catalog UI', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/services') return new Response(JSON.stringify(sharedServices), { status: 200 });
      if (url === '/api/services/102' && options?.method === 'PUT') {
        return new Response(JSON.stringify({
          ...sharedServices[0], SPrice1: JSON.parse(String(options.body)).SPrice1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads active shared services and defaults to suggested clinic entries', async () => {
    render(<ClinicServiceSettings />);
    await screen.findByText('كشف');
    expect(screen.queryByText('حلاقة')).toBeNull();
    expect(screen.getByRole('link', { name: /إدارة كتالوج الخدمات الكامل/ }).getAttribute('href')).toBe('/admin/services');
    expect(screen.getByRole('link', { name: /فتح جدول التوافر/ }).getAttribute('href')).toBe('/admin/workforce/availability');
  });

  it('can reveal all services instead of silently hiding non-matching catalog entries', async () => {
    render(<ClinicServiceSettings />);
    await screen.findByText('كشف');
    fireEvent.click(screen.getByLabelText(/خدمات الكشف والمتابعة المقترحة/));
    expect(screen.getByText('حلاقة')).toBeTruthy();
  });

  it('preserves shared service metadata and calls the canonical API for price changes', async () => {
    render(<ClinicServiceSettings />);
    await screen.findByText('كشف');
    fireEvent.change(screen.getByLabelText('سعر خدمة كشف'), { target: { value: '450.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ السعر' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => {
      if (url !== '/api/services/102' || options?.method !== 'PUT') return false;
      const body = JSON.parse(String(options.body));
      return body.SPrice1 === 450.5 && body.Bonus === 12 && body.ImageUrl === '/clinic.png' && body.CatID === 4 && body.ProName === 'Consultation';
    })).toBe(true));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('blocks invalid prices before sending any update', async () => {
    render(<ClinicServiceSettings />);
    await screen.findByText('كشف');
    fireEvent.change(screen.getByLabelText('سعر خدمة كشف'), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ السعر' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  });

  it('does not claim success after a failed price update', async () => {
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'غير مصرح' }), { status: 403 });
      }
      return new Response(JSON.stringify(sharedServices), { status: 200 });
    });
    render(<ClinicServiceSettings />);
    await screen.findByText('كشف');
    fireEvent.change(screen.getByLabelText('سعر خدمة كشف'), { target: { value: '470' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ السعر' }));
    expect((await screen.findByRole('alert')).textContent).toContain('غير مصرح');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
