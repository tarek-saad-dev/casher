import { getConciergeAwarenessHints } from '../adapters/conciergeAwareness';
import { canApproveConflict, detectArtifactConflict } from './conflictEngine';
import {
  interpretLearningSubmission,
  resolveInterpreterModelName,
} from './learningInterpreter';
import { INTERPRETER_VERSION } from '../domain/enums';
import type { AnalysisResult, PreviewCard } from '../domain/types';
import type { ControlPlaneStore } from '../infra/memoryStore';
import { appendAuditEvent } from './auditService';

function buildPreviewCards(
  interpretation: AnalysisResult['interpretation'],
  conflicts: AnalysisResult['conflicts'],
): PreviewCard[] {
  return interpretation.proposedArtifacts.map((artifact, index) => {
    const conflict = conflicts.find((c) => c.artifactIndex === index);
    const conflictType = conflict?.conflictType ?? 'NONE';
    const blocked = conflictType === 'BLOCKED_BY_INVARIANT' || conflictType === 'LOWER_AUTHORITY';
    let impactAr = 'سيُضاف كتعليم معتمد بعد الموافقة';
    if (conflictType === 'SUPERSEDES') impactAr = conflict?.messageAr ?? 'سيستبدل المعلومة الحالية بعد الاعتماد';
    if (conflictType === 'DUPLICATE') impactAr = conflict?.messageAr ?? 'مكرر — لا تغيير مطلوب';
    return {
      artifactIndex: index,
      titleAr: artifact.title,
      summaryAr: artifact.summary,
      impactAr,
      conflictType,
      canApprove: canApproveConflict(conflictType) && !blocked,
      blockedReasonAr: blocked ? conflict?.messageAr : undefined,
    };
  });
}

export async function analyzeSubmission(
  store: ControlPlaneStore,
  submissionId: number,
  actorUserId: number,
): Promise<AnalysisResult> {
  const submission = await store.getSubmission(submissionId);
  if (!submission) throw new Error('Submission not found');

  await store.updateSubmission(submissionId, { status: 'ANALYZING' });
  const startedModelName = 'pending';
  await appendAuditEvent(store, {
    submissionId,
    artifactId: null,
    eventType: 'INTERPRETATION_STARTED',
    actorUserId,
    modelName: startedModelName,
    detailsJson: {},
  });

  try {
    const interpretation = await interpretLearningSubmission(submission.rawInput);
    const modelName = resolveInterpreterModelName(interpretation);
    const approved = await store.listApprovedArtifacts();
    const awareness = getConciergeAwarenessHints();

    const conflicts = interpretation.proposedArtifacts.map((artifact, index) =>
      detectArtifactConflict(artifact, index, {
        approvedArtifacts: approved,
        existingBannedPhrases: awareness.existingBannedPhrases,
      }, submission.rawInput),
    );

    for (const c of conflicts) {
      if (c.conflictType !== 'NONE') {
        await appendAuditEvent(store, {
          submissionId,
          artifactId: null,
          eventType: c.conflictType === 'BLOCKED_BY_INVARIANT' ? 'INVARIANT_BLOCKED' : 'CONFLICT_DETECTED',
          actorUserId,
          modelName,
          detailsJson: { conflict: c },
        });
      }
    }

    await store.createArtifacts(submissionId, interpretation.proposedArtifacts, actorUserId);

    for (const _a of interpretation.proposedArtifacts) {
      await appendAuditEvent(store, {
        submissionId,
        artifactId: null,
        eventType: 'ARTIFACT_PROPOSED',
        actorUserId,
        modelName,
        detailsJson: { count: interpretation.proposedArtifacts.length },
      });
    }

    const status = interpretation.requiresHumanClarification ? 'NEEDS_REVIEW' : 'ANALYZED';
    const updated = await store.updateSubmission(submissionId, {
      status,
      interpreterVersion: INTERPRETER_VERSION,
      modelName,
      sourceType: interpretation.inferredSourceType,
    });

    await appendAuditEvent(store, {
      submissionId,
      artifactId: null,
      eventType: 'INTERPRETATION_COMPLETED',
      actorUserId,
      modelName,
      detailsJson: {
        artifactCount: interpretation.proposedArtifacts.length,
        engine: interpretation.interpreterEngine ?? 'unknown',
      },
    });

    const blocked = conflicts.some(
      (c) => c.conflictType === 'BLOCKED_BY_INVARIANT' || c.conflictType === 'LOWER_AUTHORITY',
    );

    return {
      submission: updated,
      interpretation,
      conflicts,
      blocked,
      previewCards: buildPreviewCards({ proposedArtifacts: interpretation.proposedArtifacts } as AnalysisResult['interpretation'], conflicts),
    };
  } catch (err) {
    await store.updateSubmission(submissionId, { status: 'FAILED' });
    await appendAuditEvent(store, {
      submissionId,
      artifactId: null,
      eventType: 'INTERPRETATION_FAILED',
      actorUserId,
      modelName: 'failed',
      detailsJson: { error: String(err) },
    });
    throw err;
  }
}
