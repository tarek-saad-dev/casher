import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), workspace: vi.fn(), actor: vi.fn(), save: vi.fn(), complete: vi.fn(), profile: vi.fn(),
  prescribe: vi.fn(), sign: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireTenantApp: mocks.auth,
  isAuthResult: (value: unknown) => !(value instanceof Response),
}));
vi.mock('../internal/repository', () => ({
  getEncounterWorkspace: mocks.workspace,
  resolveClinicalActorForUser: mocks.actor,
  saveEncounterDraft: mocks.save,
  completeEncounter: mocks.complete,
  upsertPatientProfile: mocks.profile,
  createPrescriptionDraft: mocks.prescribe,
  signPrescription: mocks.sign,
  saveEncounterWithProfile: mocks.save,
}));

import { GET, PATCH } from '@/app/api/clinic/encounters/[encounterId]/route';
import { POST as prescribe } from '@/app/api/clinic/encounters/[encounterId]/prescriptions/route';
import { POST as sign } from '@/app/api/clinic/prescriptions/[prescriptionId]/sign/route';

const ctx = { params: Promise.resolve({ encounterId: 'visit-a' }) };
const request = (body: unknown) => new NextRequest('http://localhost/api/clinic/encounters/visit-a', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('clinic encounter routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ tenantId: 'tenant-a', userId: 7 });
    mocks.actor.mockResolvedValue({ kind: 'human', userId: 7, empId: 12 });
    mocks.workspace.mockResolvedValue({
      encounter: { PractitionerEmpID: 12, ClientID: 5, Status: 'in_progress', ClinicalNotes: 'private notes', DiagnosisSummary: 'private diagnosis', VitalsJson: '{}', FollowUpAt: 'private date' },
      patientProfile: { Allergies: 'private allergies' }, history: [{ DiagnosisSummary: 'history' }], prescriptions: [{ Notes: 'private prescription' }],
    });
    mocks.prescribe.mockResolvedValue('rx-a');
  });

  it('returns full clinical data only to the assigned human practitioner', async () => {
    const response = await GET(request({}), ctx);
    const payload = await response.json();
    expect(payload.clinicalAccess.assigned).toBe(true);
    expect(payload.patientProfile.Allergies).toBe('private allergies');
    expect(mocks.workspace).toHaveBeenCalledWith('tenant-a', 'visit-a');
    expect(mocks.actor).toHaveBeenCalledWith('tenant-a', 7);
  });

  it.each([null, { kind: 'human', userId: 8, empId: 99 }, { kind: 'ai', agentId: 'bot' }])('redacts medical data for unassigned actor %j', async (actor) => {
    mocks.actor.mockResolvedValue(actor);
    const payload = await (await GET(request({}), ctx)).json();
    expect(payload.encounter.ClinicalNotes).toBeUndefined();
    expect(payload.encounter.DiagnosisSummary).toBeUndefined();
    expect(payload.encounter.VitalsJson).toBeUndefined();
    expect(payload.encounter.FollowUpAt).toBeUndefined();
    expect(payload.encounter.Status).toBe('in_progress');
    expect(payload.patientProfile).toBeNull();
    expect(payload.history).toEqual([]);
    expect(payload.prescriptions).toEqual([]);
    expect(payload.clinicalAccess.assigned).toBe(false);
  });

  it('does not leak unexpected future medical fields through the reception view', async () => {
    mocks.actor.mockResolvedValue(null);
    mocks.workspace.mockResolvedValue({
      encounter: {
        EncounterId: 'visit-a',
        ClientID: 5,
        PatientName: 'Synthetic Patient',
        Status: 'in_progress',
        ClinicalNotes: 'synthetic secret',
        InternalClinicalFlags: 'synthetic private',
        NewMedicalFieldAddedLater: { private: true },
      },
      patientProfile: { Allergies: 'synthetic allergy' },
      history: [{ DiagnosisSummary: 'synthetic history' }],
      prescriptions: [{ Notes: 'synthetic prescription' }],
    });
    const response = await GET(request({}), ctx);
    const payload = await response.json();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(payload.encounter).toEqual({
      EncounterId: 'visit-a',
      ClientID: 5,
      PatientName: 'Synthetic Patient',
      Status: 'in_progress',
    });
    expect(payload.patientProfile).toBeNull();
    expect(payload.history).toEqual([]);
    expect(payload.prescriptions).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('synthetic secret');
    expect(JSON.stringify(payload)).not.toContain('synthetic private');
  });

  it('does not mutate a completed encounter', async () => {
    mocks.workspace.mockResolvedValue({ encounter: { PractitionerEmpID: 12, Status: 'completed' } });
    expect((await PATCH(request({ clinicalNotes: 'change' }), ctx)).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it('rejects completion without diagnosis before updating the patient profile', async () => {
    expect((await PATCH(request({ action: 'complete', diagnosisSummary: ' ', patientProfile: { allergies: 'changed' } }), ctx)).status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('saves clinical notes using authoritative tenant and clinician identity', async () => {
    expect((await PATCH(request({ clinicalNotes: 'Exam', tenantId: 'tenant-b' }), ctx)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', encounterId: 'visit-a', clinicalNotes: 'Exam', actor: { kind: 'human', userId: 7, empId: 12 } }));
  });

  it('does not cache saved medical content or accept array-shaped patient profiles', async () => {
    const response = await PATCH(request({
      clinicalNotes: 'Synthetic examination',
      patientProfile: [{ notes: 'Should not persist' }],
    }), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      patientProfile: null,
    }));
  });

  it('returns 404 for a visit outside the authenticated tenant', async () => {
    mocks.workspace.mockResolvedValue(null);
    expect((await GET(request({}), ctx)).status).toBe(404);
    expect((await PATCH(request({}), ctx)).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects another practitioner before any clinical write', async () => {
    mocks.actor.mockResolvedValue({ kind: 'human', userId: 7, empId: 99 });
    expect((await PATCH(request({ patientProfile: { notes: 'change' } }), ctx)).status).toBe(403);
    expect((await prescribe(request({ items: [{ medicationName: 'Medicine' }] }), ctx)).status).toBe(403);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.prescribe).not.toHaveBeenCalled();
  });

  it('creates medication drafts and signs with authoritative clinical identity', async () => {
    expect((await prescribe(request({ items: [{ medicationName: ' Medicine ', dosage: '1' }] }), ctx)).status).toBe(201);
    expect(mocks.prescribe).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', encounterId: 'visit-a', items: [expect.objectContaining({ medicationName: 'Medicine', dosage: '1' })] }));
    expect((await sign(request({}), { params: Promise.resolve({ prescriptionId: 'rx-a' }) })).status).toBe(200);
    expect(mocks.sign).toHaveBeenCalledWith({ tenantId: 'tenant-a', prescriptionId: 'rx-a', actor: { kind: 'human', userId: 7, empId: 12 } });
  });

  it('requires app entitlement before returning patient data', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Not entitled' }, { status: 403 }));
    expect((await GET(request({}), ctx)).status).toBe(403);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
