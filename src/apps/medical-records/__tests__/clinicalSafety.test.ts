import { describe, expect, it } from 'vitest';
import {
  CLINICAL_AI_POLICY,
  ClinicalSafetyError,
  assertHumanClinicalActor,
  assertPrescriptionSignable,
} from '../application/clinicalSafety';

describe('medical records clinical safety', () => {
  it('keeps AI administrative-only for clinical decisions', () => {
    expect(CLINICAL_AI_POLICY.canSchedule).toBe(true);
    expect(CLINICAL_AI_POLICY.canWriteDiagnosis).toBe(false);
    expect(CLINICAL_AI_POLICY.canCompleteEncounter).toBe(false);
    expect(CLINICAL_AI_POLICY.canSignPrescription).toBe(false);
  });

  it('blocks AI from completing an encounter', () => {
    expect(() =>
      assertHumanClinicalActor({ kind: 'ai', agentId: 'receptionist' }, 'complete-encounter'),
    ).toThrowError(ClinicalSafetyError);
  });

  it('requires a non-empty draft before signing', () => {
    expect(() =>
      assertPrescriptionSignable({
        actor: { kind: 'human', userId: 10, empId: 20 },
        status: 'draft',
        itemCount: 0,
      }),
    ).toThrowError(/at least one medication/i);
  });

  it('allows a human practitioner to sign a non-empty draft', () => {
    expect(() =>
      assertPrescriptionSignable({
        actor: { kind: 'human', userId: 10, empId: 20 },
        status: 'draft',
        itemCount: 1,
      }),
    ).not.toThrow();
  });
});
