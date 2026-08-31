import type { ScopeType } from '../domain/enums';
import type { ProposedArtifact } from '../domain/types';

export function resolveScope(artifact: Pick<ProposedArtifact, 'domain' | 'entityCode' | 'structuredPayload' | 'artifactType'>): {
  scopeType: ScopeType;
  scopeKey: string | null;
} {
  if (artifact.entityCode) {
    return { scopeType: 'BRANCH', scopeKey: `BRANCH.${artifact.entityCode}` };
  }
  if (artifact.artifactType === 'WORKFLOW_RULE') {
    const workflow = String(artifact.structuredPayload.workflow ?? 'BOOKING');
    const stage = artifact.structuredPayload.stage ? String(artifact.structuredPayload.stage) : null;
    if (stage) {
      return { scopeType: 'WORKFLOW_STAGE', scopeKey: `WORKFLOW.${workflow}.${stage}` };
    }
    return { scopeType: 'WORKFLOW', scopeKey: `WORKFLOW.${workflow}` };
  }
  if (artifact.domain !== 'GENERAL') {
    return { scopeType: 'DOMAIN', scopeKey: `DOMAIN.${artifact.domain}` };
  }
  return { scopeType: 'GLOBAL', scopeKey: null };
}
