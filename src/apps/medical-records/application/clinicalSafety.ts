export type ClinicalActor =
  | { kind: 'human'; userId: number; empId: number }
  | { kind: 'ai'; agentId: string };

export const CLINICAL_AI_POLICY = Object.freeze({
  canSchedule: true,
  canReschedule: true,
  canSendAdministrativeReminders: true,
  canWriteDiagnosis: false,
  canCompleteEncounter: false,
  canSignPrescription: false,
});

export class ClinicalSafetyError extends Error {
  constructor(
    public readonly code:
      | 'HUMAN_CLINICIAN_REQUIRED'
      | 'PRESCRIPTION_EMPTY'
      | 'PRESCRIPTION_NOT_DRAFT'
      | 'DIAGNOSIS_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'ClinicalSafetyError';
  }
}

export function assertHumanClinicalActor(
  actor: ClinicalActor,
  action: 'complete-encounter' | 'sign-prescription',
): asserts actor is Extract<ClinicalActor, { kind: 'human' }> {
  if (actor.kind !== 'human' || !Number.isInteger(actor.empId) || actor.empId <= 0) {
    throw new ClinicalSafetyError(
      'HUMAN_CLINICIAN_REQUIRED',
      `A valid human practitioner is required to ${action}.`,
    );
  }
}

export function assertPrescriptionSignable(input: {
  actor: ClinicalActor;
  status: string;
  itemCount: number;
}): asserts input is {
  actor: Extract<ClinicalActor, { kind: 'human' }>;
  status: 'draft';
  itemCount: number;
} {
  assertHumanClinicalActor(input.actor, 'sign-prescription');
  if (input.status !== 'draft') {
    throw new ClinicalSafetyError(
      'PRESCRIPTION_NOT_DRAFT',
      'Only a draft prescription can be signed.',
    );
  }
  if (!Number.isInteger(input.itemCount) || input.itemCount < 1) {
    throw new ClinicalSafetyError(
      'PRESCRIPTION_EMPTY',
      'A prescription must contain at least one medication before signing.',
    );
  }
}
