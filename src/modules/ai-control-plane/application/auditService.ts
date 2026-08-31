import type { ControlPlaneStore } from '../infra/memoryStore';
import type { LearningAuditEvent } from '../domain/types';

export async function appendAuditEvent(
  store: ControlPlaneStore,
  event: Omit<LearningAuditEvent, 'eventId' | 'createdAt'>,
): Promise<LearningAuditEvent> {
  return store.appendAudit(event);
}

export async function listHistory(
  store: ControlPlaneStore,
  filter?: { submissionId?: number; artifactId?: number },
): Promise<LearningAuditEvent[]> {
  return store.listAudit(filter);
}
