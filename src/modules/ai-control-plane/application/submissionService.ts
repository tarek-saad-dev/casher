import { MAX_CONTEXT_JSON_BYTES, MAX_RAW_INPUT_LENGTH } from '../domain/types';
import type { ControlPlaneStore } from '../infra/memoryStore';
import { appendAuditEvent } from './auditService';

function validateContextJson(context: unknown): Record<string, unknown> | null {
  if (context == null) return null;
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('contextJson must be an object');
  }
  const json = JSON.stringify(context);
  if (json.length > MAX_CONTEXT_JSON_BYTES) {
    throw new Error('contextJson too large');
  }
  return context as Record<string, unknown>;
}

export async function createLearningSubmission(
  store: ControlPlaneStore,
  input: {
    rawInput: string;
    submittedByUserId: number;
    contextJson?: unknown;
  },
) {
  const rawInput = String(input.rawInput ?? '');
  if (!rawInput.trim()) throw new Error('rawInput required');
  if (rawInput.length > MAX_RAW_INPUT_LENGTH) throw new Error('rawInput too long');

  const submission = await store.createSubmission({
    rawInput,
    sourceType: 'MANUAL',
    submittedByUserId: input.submittedByUserId,
    contextJson: validateContextJson(input.contextJson),
  });

  await appendAuditEvent(store, {
    submissionId: submission.submissionId,
    artifactId: null,
    eventType: 'SUBMISSION_CREATED',
    actorUserId: input.submittedByUserId,
    modelName: null,
    detailsJson: { length: rawInput.length },
  });

  return submission;
}
