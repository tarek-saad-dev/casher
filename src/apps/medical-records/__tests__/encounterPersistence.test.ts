import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const query = vi.fn().mockResolvedValue({ recordset: [] });
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const getPool = vi.fn().mockResolvedValue({ request: () => request });
  const begin = vi.fn(), commit = vi.fn(), rollback = vi.fn().mockResolvedValue(undefined);
  return { query, input, getPool, request, begin, commit, rollback };
});

vi.mock('@/lib/db', () => ({
  getPool: db.getPool,
  sql: {
    UniqueIdentifier: 'uuid', Int: 'int', MAX: -1, NVarChar: () => 'text', DateTime2: 'date',
    Transaction: class { begin = db.begin; commit = db.commit; rollback = db.rollback; },
    Request: class { constructor() { return db.request; } },
  },
}));

import { completeEncounter, registerClinicPractitioner, saveEncounterDraft, saveEncounterWithProfile } from '../internal/repository';

const encounter = {
  tenantId: 'tenant-a',
  encounterId: 'encounter-a',
  actor: { kind: 'human' as const, userId: 7, empId: 12 },
};

describe('encounter persistence', () => {
  beforeEach(() => { vi.clearAllMocks(); db.query.mockReset().mockResolvedValue({ recordset: [] }); });

  it('saves unfinished clinical notes without requiring a final diagnosis', async () => {
    await expect(saveEncounterDraft({ ...encounter, clinicalNotes: 'Exam in progress' })).resolves.toBeUndefined();
    expect(db.input).toHaveBeenCalledWith('tenantId', 'uuid', 'tenant-a');
    expect(db.input).toHaveBeenCalledWith('empId', 'int', 12);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, '', '   '])('rejects completion with diagnosis %j before database access', async (diagnosisSummary) => {
    await expect(completeEncounter({ ...encounter, diagnosisSummary })).rejects.toMatchObject({ code: 'DIAGNOSIS_REQUIRED' });
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it('completes a diagnosed encounter with the assigned clinician and tenant', async () => {
    await completeEncounter({ ...encounter, diagnosisSummary: 'Recorded by clinician' });
    expect(db.input).toHaveBeenCalledWith('tenantId', 'uuid', 'tenant-a');
    expect(db.input).toHaveBeenCalledWith('empId', 'int', 12);
    expect(db.input).toHaveBeenCalledWith('userId', 'int', 7);
  });

  it.each([saveEncounterDraft, completeEncounter])('rejects AI clinical mutations before database access', async (mutate) => {
    await expect(mutate({ ...encounter, actor: { kind: 'ai', agentId: 'receptionist' }, diagnosisSummary: 'Not allowed' })).rejects.toMatchObject({ code: 'HUMAN_CLINICIAN_REQUIRED' });
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it('rolls back without changing a patient profile when the encounter is no longer editable', async () => {
    db.query.mockResolvedValueOnce({ recordset: [] });
    await expect(saveEncounterWithProfile({ ...encounter, action: 'save', patientProfile: null })).rejects.toThrow();
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('rolls back the encounter mutation when its patient profile fails to save', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ ClientID: 5 }] });
    db.query.mockResolvedValueOnce({ recordset: [] });
    db.query.mockRejectedValueOnce(new Error('profile update failed'));
    await expect(saveEncounterWithProfile({ ...encounter, action: 'save', patientProfile: { bloodType: null, allergies: 'updated', chronicConditions: null, currentMedications: null, emergencyContactName: null, emergencyContactPhone: null, notes: null } })).rejects.toThrow('profile update failed');
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
  });

  it('rejects linking a staff login outside the practitioner tenant', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ EmpID: 12, Job: 'طبيب' }] });
    db.query.mockResolvedValueOnce({ recordset: [] });
    await expect(registerClinicPractitioner({ tenantId: 'tenant-a', empId: 12, userId: 24, actorUserId: 7 })).rejects.toThrow('Clinical user must belong to this tenant.');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
  });
});
