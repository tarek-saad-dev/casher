// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EncounterWorkspace from '@/app/clinic/encounters/[encounterId]/EncounterWorkspace';

const payload = {
  encounter: { EncounterId: 'visit-a', PatientName: 'Patient A', PractitionerName: 'Doctor A', Status: 'in_progress', ClinicalNotes: null, DiagnosisSummary: null, FollowUpAt: null, VitalsJson: null },
  patientProfile: null, history: [], prescriptions: [],
  clinicalAccess: { linked: true, assigned: true, practitionerEmpId: 12 },
};

describe('encounter workspace', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('sends the local follow-up time as an unambiguous UTC instant', async () => {
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    const localDate = '2026-11-15T14:30';
    fireEvent.change(screen.getByLabelText('موعد متابعة مقترح'), { target: { value: localDate } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(options.body).followUpAt).toBe(new Date(localDate).toISOString());
  });

  it('prevents completion without diagnosis in the UI', async () => {
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    fireEvent.click(screen.getByRole('button', { name: 'إكمال الزيارة' }));
    expect(screen.getByText('اكتب ملخص التشخيص قبل إكمال الزيارة.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it('preserves unsaved examination notes when creating a prescription', async () => {
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === 'POST' ? { prescriptionId: 'rx-a' } : payload), { status: 200 }));
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    fireEvent.change(screen.getByLabelText('Clinical notes'), { target: { value: 'Unsaved examination' } });
    fireEvent.change(screen.getByPlaceholderText('اسم الدواء *'), { target: { value: 'Medicine' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء مسودة روشتة' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2));
    await screen.findByLabelText('Clinical notes');
    expect((screen.getByLabelText('Clinical notes') as HTMLTextAreaElement).value).toBe('Unsaved examination');
  });
});
