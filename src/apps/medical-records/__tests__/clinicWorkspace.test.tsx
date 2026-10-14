// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClinicWorkspace from '@/app/clinic/ClinicWorkspace';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

describe('clinic patient to encounter workflow', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      let data: unknown = [];
      if (url === '/api/clinic/practitioners') data = [{ EmpID: 12, EmpName: 'Doctor A' }];
      if (url === '/api/clinic/practitioners' && options?.method === 'POST') data = { EmpID: 12, EmpName: 'Doctor A', UserID: 24 };
      if (url === '/api/users') data = [{ UserID: 24, UserName: 'Doctor Account', loginName: 'doctor-a' }];
      if (url === '/api/customers' && options?.method === 'POST') data = { ClientID: 5, Name: 'Patient A', Mobile: '01000000000' };
      if (url === '/api/clinic/encounters' && options?.method === 'POST') data = { encounterId: 'visit-a' };
      if (url === '/api/clinic/encounters?clientId=5') data = [{ EncounterId: 'previous-visit', PractitionerName: 'Doctor A', Status: 'completed', CreatedAt: '2026-10-01T10:00:00Z' }];
      return new Response(JSON.stringify(data), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  async function createPatient() {
    fireEvent.click(screen.getByRole('button', { name: 'مريض جديد' }));
    fireEvent.change(screen.getByPlaceholderText('اسم المريض'), { target: { value: 'Patient A' } });
    fireEvent.change(screen.getByPlaceholderText('رقم الموبايل'), { target: { value: '01000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة', exact: true }));
    await screen.findByText('Patient A');
    fireEvent.change(screen.getByLabelText('الطبيب'), { target: { value: '12' } });
  }

  it('creates a shared patient, assigns a doctor and opens the encounter', async () => {
    render(<ClinicWorkspace />);
    await screen.findByRole('option', { name: 'Doctor A' });
    await createPatient();
    fireEvent.click(screen.getByRole('button', { name: 'فتح الزيارة' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/clinic/encounters/visit-a'));
    const [, options] = fetchMock.mock.calls.find(([url, options]) => url === '/api/clinic/encounters' && options?.method === 'POST')!;
    expect(JSON.parse(options.body)).toMatchObject({ clientId: 5, practitionerEmpId: 12, visitType: 'new' });
  });

  it('clears the selected patient when searching for a different patient', async () => {
    render(<ClinicWorkspace />);
    await screen.findByRole('option', { name: 'Doctor A' });
    await createPatient();
    fireEvent.change(screen.getByPlaceholderText('اكتب اسم المريض أو رقم الموبايل'), { target: { value: 'Patient B' } });
    expect((screen.getByRole('button', { name: 'فتح الزيارة' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows reopening a selected patient\'s previous encounters', async () => {
    render(<ClinicWorkspace />);
    await screen.findByRole('option', { name: 'Doctor A' });
    await createPatient();
    const link = await screen.findByRole('link', { name: /Doctor A.*2026-10-01/ });
    expect(link.getAttribute('href')).toBe('/clinic/encounters/previous-visit');
  });

  it('lets an administrator select an existing login for the chosen doctor', async () => {
    render(<ClinicWorkspace />);
    await screen.findByRole('option', { name: 'Doctor A' });
    fireEvent.change(screen.getByLabelText('الطبيب'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'إعداد حساب الطبيب' }));
    await screen.findByRole('option', { name: 'Doctor Account (doctor-a)' });
    fireEvent.change(screen.getByLabelText('أو اربط الطبيب بحساب موظف موجود'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة الطبيب' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => url === '/api/clinic/practitioners' && options?.method === 'POST')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([url, options]) => url === '/api/clinic/practitioners' && options?.method === 'POST')!;
    expect(JSON.parse(options.body)).toEqual({ name: 'Doctor A', userId: 24, linkCurrentUser: false });
  });
});
