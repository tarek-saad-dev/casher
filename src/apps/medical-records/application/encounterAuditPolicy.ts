import type { ClinicalActor } from './clinicalSafety';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict UUID boundary before binding URL identifiers as SQL UNIQUEIDENTIFIER. */
export function isClinicUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Human clinical identity must come from the authenticated staff/practitioner mapping. */
export function isAuthenticatedClinicalReader(
  actor: ClinicalActor | null | undefined,
  authenticatedUserId: number,
): actor is Extract<ClinicalActor, { kind: 'human' }> {
  return actor?.kind === 'human'
    && Number.isSafeInteger(authenticatedUserId)
    && authenticatedUserId > 0
    && actor.userId === authenticatedUserId
    && Number.isSafeInteger(actor.empId)
    && actor.empId > 0;
}
