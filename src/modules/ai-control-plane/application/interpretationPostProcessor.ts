import { defaultAuthorityForDomain } from '../domain/authorityMatrix';
import type { ArtifactType, AuthorityClass, Domain, EntityType, SourceType } from '../domain/enums';
import { isEnumValue, ENTITY_TYPES, AUTHORITY_CLASSES } from '../domain/enums';
import { inferNormalizedKey } from '../domain/normalizedKey';
import type { InterpretationResult, ProposedArtifact } from '../domain/types';
import { validateArtifactPayload } from '../domain/payloads';
import type { RawGeminiInterpretation } from '../domain/learningInterpretationSchema';
import { normalizeModelPayload } from './normalizeModelPayload';
import {
  resolveEntity,
  resolveEntityByCode,
  resolveEntityFromText,
  sanitizeModelEntityId,
} from './entityResolver';
import { resolveScope } from './scopeResolver';
import { routeTargetLayer } from './targetLayerRouter';

function resolveAuthority(domain: Domain, suggested?: string): AuthorityClass {
  if (suggested && isEnumValue(AUTHORITY_CLASSES, suggested)) {
    return suggested;
  }
  return defaultAuthorityForDomain(domain);
}

function resolveEntityFields(
  rawInput: string,
  artifact: RawGeminiInterpretation['proposedArtifacts'][number],
): Pick<
  ProposedArtifact,
  'entityType' | 'entityCode' | 'entityId' | 'entityResolutionStatus' | 'entityCandidates'
> {
  const hint = artifact.entitySemanticHint ?? artifact.summary ?? rawInput;
  let entityType: EntityType | null =
    artifact.entityType && isEnumValue(ENTITY_TYPES, artifact.entityType)
      ? (artifact.entityType as EntityType)
      : null;

  let resolution = entityType ? resolveEntity(entityType, hint) : resolveEntityFromText(hint);
  if (!resolution && artifact.entityCode && entityType) {
    resolution = resolveEntityByCode(entityType, artifact.entityCode);
  }
  if (!resolution && artifact.entityCode) {
    resolution = resolveEntityByCode('BRANCH', artifact.entityCode);
    if (resolution?.status === 'RESOLVED') entityType = 'BRANCH';
  }

  if (!resolution) {
    return {
      entityType,
      entityCode: null,
      entityId: null,
      entityResolutionStatus: entityType ? 'UNRESOLVED' : undefined,
      entityCandidates: undefined,
    };
  }

  if (resolution.status === 'AMBIGUOUS') {
    return {
      entityType: resolution.entityType,
      entityCode: null,
      entityId: null,
      entityResolutionStatus: 'AMBIGUOUS',
      entityCandidates: resolution.candidates.map((c) => ({
        entityType: resolution!.entityType,
        entityCode: c.entityCode,
        label: c.label,
      })),
    };
  }

  return {
    entityType: resolution.entityType,
    entityCode: resolution.entityCode,
    entityId: sanitizeModelEntityId(resolution.entityType, resolution.entityCode, null),
    entityResolutionStatus: 'RESOLVED',
    entityCandidates: undefined,
  };
}

export function postProcessGeminiInterpretation(
  rawInput: string,
  parsed: RawGeminiInterpretation,
): InterpretationResult {
  const proposedArtifacts: ProposedArtifact[] = [];
  const warnings = [...parsed.warnings];
  let requiresHumanClarification = parsed.requiresHumanClarification;

  for (const raw of parsed.proposedArtifacts) {
    const domain = raw.domain as Domain;
    const artifactType = raw.artifactType as ArtifactType;
    let structuredPayload: Record<string, unknown>;
    try {
      const normalizedPayload = normalizeModelPayload(artifactType, raw.structuredPayload, {
        summary: raw.summary,
        title: raw.title,
        rawInput,
      });
      structuredPayload = validateArtifactPayload(artifactType, normalizedPayload);
    } catch (err) {
      warnings.push(`تعذر التحقق من الحمولة: ${String(err)}`);
      requiresHumanClarification = true;
      continue;
    }

    const entityFields = resolveEntityFields(rawInput, raw);
    if (entityFields.entityResolutionStatus === 'AMBIGUOUS') {
      requiresHumanClarification = true;
    }

    const authorityClass = resolveAuthority(domain, raw.authorityClass);
    const draft: ProposedArtifact = {
      artifactType,
      domain,
      scopeType: 'GLOBAL',
      scopeKey: null,
      targetLayer: routeTargetLayer(artifactType, domain),
      entityType: entityFields.entityType,
      entityCode: entityFields.entityCode,
      entityId: entityFields.entityId,
      topicKey: raw.topicKey,
      normalizedKey: '',
      title: raw.title,
      summary: raw.summary,
      structuredPayload,
      authorityClass,
      priority: raw.priority ?? 80,
      confidence: raw.confidence,
      effectiveFrom: raw.effectiveFrom ?? null,
      effectiveUntil: raw.effectiveUntil ?? null,
      entityResolutionStatus: entityFields.entityResolutionStatus,
      entityCandidates: entityFields.entityCandidates,
    };

    draft.normalizedKey = inferNormalizedKey({
      artifactType: draft.artifactType,
      domain: draft.domain,
      entityCode: draft.entityCode,
      topicKey: draft.topicKey,
      payload: draft.structuredPayload,
    });

    const scope = resolveScope(draft);
    draft.scopeType = scope.scopeType;
    draft.scopeKey = scope.scopeKey;
    proposedArtifacts.push(draft);
  }

  if (proposedArtifacts.length === 0 && !requiresHumanClarification) {
    requiresHumanClarification = true;
  }

  const confidence =
    proposedArtifacts.length > 0
      ? proposedArtifacts.reduce((s, a) => s + a.confidence, 0) / proposedArtifacts.length
      : parsed.confidence;

  return {
    intentSummary: parsed.intentSummary,
    proposedArtifacts,
    ambiguities: parsed.ambiguities,
    warnings,
    requiresHumanClarification,
    confidence,
    inferredSourceType: parsed.inferredSourceType as SourceType,
    interpreterEngine: 'gemini',
  };
}
