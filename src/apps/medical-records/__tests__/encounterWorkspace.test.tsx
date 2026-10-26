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
    fireEvent.click(screen.getByRole('button', { name: /03 — المتابعة/ }));
    const localDate = '2026-11-15T14:30';
    fireEvent.change(screen.getByLabelText('موعد متابعة مقترح'), { target: { value: localDate } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(options.body).followUpAt).toBe(new Date(localDate).toISOString());
  });

  it('prevents completion without diagnosis in the UI', async () => {
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة وإنهاء' }));
    expect(screen.getByRole('button', { name: 'إكمال الزيارة' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'إكمال الزيارة' }));
    expect(screen.getByText('اكتب ملخص التشخيص قبل إكمال الزيارة.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it('preserves unsaved examination notes when creating a prescription', async () => {
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === 'POST' ? { prescriptionId: 'rx-a' } : payload), { status: 200 }));
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    fireEvent.change(screen.getByLabelText('Clinical notes'), { target: { value: 'Unsaved examination' } });
    fireEvent.click(screen.getByRole('button', { name: /02 — الروشتة/ }));
    fireEvent.change(screen.getByPlaceholderText('اسم الدواء *'), { target: { value: 'Medicine' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء مسودة روشتة' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /01 — الكشف/ }));
    await screen.findByLabelText('Clinical notes');
    expect((screen.getByLabelText('Clinical notes') as HTMLTextAreaElement).value).toBe('Unsaved examination');
  });

  it('cannot complete with a locally written but unsaved medication', async () => {
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    fireEvent.change(screen.getByLabelText('ملخص التشخيص'), { target: { value: 'Diagnosis' } });
    fireEvent.click(screen.getByRole('button', { name: /02 — الروشتة/ }));
    fireEvent.change(screen.getByPlaceholderText('اسم الدواء *'), { target: { value: 'Medicine' } });
    fireEvent.click(screen.getByRole('button', { name: /03 — المتابعة/ }));
    fireEvent.click(screen.getByRole('button', { name: 'إكمال الزيارة' }));
    expect(screen.getByText(/فيه أدوية مكتوبة لسه ما اتحفظتش/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /02 — الروشتة/ }).getAttribute('aria-pressed')).toBe('true');
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it('disables prescription printing without any signed prescription', async () => {
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByText('Patient A');
    expect((screen.getByRole('button', { name: 'طباعة الروشتة' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText('نسخة طباعة الروشتة')).toBeNull();
  });

  it('prints signed medications only, never unsigned draft or the clinical notes', async () => {
    const signed = {
      PrescriptionId: 'rx-signed', Status: 'signed', Notes: 'بعد الأكل',
      SignedAt: '2026-10-26T16:00:00Z', CreatedAt: '2026-10-26T15:00:00Z',
      items: [{
        PrescriptionItemId: 1, MedicationName: 'Medicine Signed', Strength: '500 mg',
        Dosage: 'قرص', Frequency: 'مرتين', Duration: '5 أيام', Route: 'oral',
        Instructions: 'بعد الطعام',
      }],
    };
    const draft = {
      ...signed, PrescriptionId: 'rx-draft', Status: 'draft',
      items: [{ ...signed.items[0], PrescriptionItemId: 2, MedicationName: 'Not signed medicine' }],
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        ...payload, encounter: { ...payload.encounter, ClinicalNotes: 'Private clinical note' },
        prescriptions: [signed, draft],
      }), { status: 200 }),
    );
    render(<EncounterWorkspace encounterId="visit-a" />);
    await screen.findByRole('heading', { name: 'زيارة Patient A' });
    expect((screen.getByRole('button', { name: 'طباعة الروشتة' }) as HTMLButtonElement).disabled).toBe(false);
    const print = screen.getByLabelText('نسخة طباعة الروشتة');
    expect(print.textContent).toContain('Medicine Signed');
    expect(print.textContent).not.toContain('Not signed medicine');
    expect(print.textContent).not.toContain('Private clinical note');
  });
});
