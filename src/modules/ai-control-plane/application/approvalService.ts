import { getConciergeAwarenessHints } from '../adapters/conciergeAwareness';
import { canApproveConflict, detectArtifactConflict } from './conflictEngine';
import { validateArtifactPayload, isValidArtifactType } from '../domain/payloads';
import type { ControlPlaneStore } from '../infra/memoryStore';
import { appendAuditEvent } from './auditService';

export async function approveArtifact(
  store: ControlPlaneStore,
  artifactId: number,
  actorUserId: number,
): Promise<{ artifact: Awaited<ReturnType<ControlPlaneStore['getArtifact']>>; supersededId: number | null }> {
  const artifact = await store.getArtifact(artifactId);
  if (!artifact) throw new Error('Artifact not found');
  if (artifact.status === 'APPROVED') throw new Error('Already approved');
  if (artifact.status === 'REJECTED' || artifact.status === 'DISABLED') {
    throw new Error('Cannot approve rejected/disabled artifact');
  }
  if (!isValidArtifactType(artifact.artifactType)) {
    throw new Error('Invalid artifact type');
  }
  validateArtifactPayload(artifact.artifactType, artifact.structuredPayload);

  const approved = await store.listApprovedArtifacts();
  const awareness = getConciergeAwarenessHints();
  const submission = await store.getSubmission(artifact.submissionId);
  const conflict = detectArtifactConflict(
    artifact,
    0,
    { approvedArtifacts: approved, existingBannedPhrases: awareness.existingBannedPhrases },
    submission?.rawInput ?? '',
  );

  if (conflict.conflictType === 'BLOCKED_BY_INVARIANT' || conflict.conflictType === 'LOWER_AUTHORITY') {
    throw new Error(conflict.messageAr);
  }
  if (!canApproveConflict(conflict.conflictType) && conflict.conflictType !== 'NONE') {
    if (conflict.conflictType === 'CONTRADICTS' || conflict.conflictType === 'AMBIGUOUS') {
      throw new Error(conflict.messageAr);
    }
  }

  let supersededId: number | null = null;
  if (conflict.conflictType === 'SUPERSEDES' && conflict.existingArtifactId) {
    const old = await store.getArtifact(conflict.existingArtifactId);
    if (old && old.status === 'APPROVED') {
      await store.updateArtifact(old.artifactId, { status: 'SUPERSEDED' });
      supersededId = old.artifactId;
      await appendAuditEvent(store, {
        submissionId: artifact.submissionId,
        artifactId: old.artifactId,
        eventType: 'ARTIFACT_SUPERSEDED',
        actorUserId,
        modelName: null,
        detailsJson: { supersededBy: artifactId },
      });
      artifact.version = old.version + 1;
      artifact.supersedesArtifactId = old.artifactId;
    }
  }

  if (conflict.conflictType === 'DUPLICATE') {
    await store.updateArtifact(artifactId, { status: 'REJECTED' });
    await appendAuditEvent(store, {
      submissionId: artifact.submissionId,
      artifactId,
      eventType: 'ARTIFACT_REJECTED',
      actorUserId,
      modelName: null,
      detailsJson: { reason: 'duplicate' },
    });
    return { artifact: await store.getArtifact(artifactId), supersededId: null };
  }

  const now = new Date();
  const updated = await store.updateArtifact(artifactId, {
    status: 'APPROVED',
    approvedByUserId: actorUserId,
    approvedAt: now,
    version: artifact.version,
    supersedesArtifactId: artifact.supersedesArtifactId,
  });

  await appendAuditEvent(store, {
    submissionId: artifact.submissionId,
    artifactId,
    eventType: 'ARTIFACT_APPROVED',
    actorUserId,
    modelName: null,
    detailsJson: { version: updated.version },
  });

  return { artifact: updated, supersededId };
}

export async function rejectArtifact(
  store: ControlPlaneStore,
  artifactId: number,
  actorUserId: number,
  reason?: string,
) {
  const artifact = await store.getArtifact(artifactId);
  if (!artifact) throw new Error('Artifact not found');
  const updated = await store.updateArtifact(artifactId, { status: 'REJECTED' });
  await appendAuditEvent(store, {
    submissionId: artifact.submissionId,
    artifactId,
    eventType: 'ARTIFACT_REJECTED',
    actorUserId,
    modelName: null,
    detailsJson: { reason: reason ?? null },
  });
  return updated;
}

export async function disableArtifact(
  store: ControlPlaneStore,
  artifactId: number,
  actorUserId: number,
) {
  const artifact = await store.getArtifact(artifactId);
  if (!artifact) throw new Error('Artifact not found');
  const updated = await store.updateArtifact(artifactId, { status: 'DISABLED' });
  await appendAuditEvent(store, {
    submissionId: artifact.submissionId,
    artifactId,
    eventType: 'ARTIFACT_DISABLED',
    actorUserId,
    modelName: null,
    detailsJson: {},
  });
  return updated;
}
