import {
  ARTIFACT_TYPES,
  DOMAINS,
  SOURCE_TYPES,
  isEnumValue,
  type ArtifactType,
  type Domain,
  type SourceType,
} from './enums';

export type RawGeminiProposedArtifact = {
  artifactType: string;
  domain: string;
  topicKey: string;
  title: string;
  summary: string;
  authorityClass?: string;
  priority?: number;
  confidence?: number;
  entityType?: string | null;
  entitySemanticHint?: string | null;
  entityCode?: string | null;
  structuredPayload: Record<string, unknown>;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
};

export type RawGeminiInterpretation = {
  intentSummary: string;
  inferredSourceType: string;
  confidence: number;
  requiresHumanClarification: boolean;
  ambiguities: string[];
  warnings: string[];
  proposedArtifacts: RawGeminiProposedArtifact[];
};

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v)).filter(Boolean);
}

function asNullableString(value: unknown): string | null {
  const s = asString(value);
  return s.length > 0 ? s : null;
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function parseGeminiLearningInterpretation(raw: unknown): RawGeminiInterpretation {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const artifactsRaw = Array.isArray(obj.proposedArtifacts) ? obj.proposedArtifacts : [];
  const proposedArtifacts: RawGeminiProposedArtifact[] = [];

  for (const item of artifactsRaw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const artifactType = asString(a.artifactType);
    const domain = asString(a.domain);
    if (!isEnumValue(ARTIFACT_TYPES, artifactType)) {
      throw new Error(`Invalid artifact type from model: ${artifactType}`);
    }
    if (!isEnumValue(DOMAINS, domain)) {
      throw new Error(`Invalid domain from model: ${domain}`);
    }
    const payload = a.structuredPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('structuredPayload must be an object');
    }
    proposedArtifacts.push({
      artifactType,
      domain,
      topicKey: asString(a.topicKey) || 'general',
      title: asString(a.title) || 'تعليم',
      summary: asString(a.summary) || asString(a.title) || 'تعليم',
      authorityClass: asNullableString(a.authorityClass) ?? undefined,
      priority: Number.isFinite(Number(a.priority)) ? Number(a.priority) : undefined,
      confidence: clampConfidence(a.confidence),
      entityType: asNullableString(a.entityType),
      entitySemanticHint: asNullableString(a.entitySemanticHint),
      entityCode: asNullableString(a.entityCode),
      structuredPayload: payload as Record<string, unknown>,
      effectiveFrom: asNullableString(a.effectiveFrom),
      effectiveUntil: asNullableString(a.effectiveUntil),
    });
  }

  const inferred = asString(obj.inferredSourceType) || 'MANUAL';
  if (!isEnumValue(SOURCE_TYPES, inferred)) {
    throw new Error(`Invalid source type from model: ${inferred}`);
  }

  return {
    intentSummary: asString(obj.intentSummary) || 'تعليم من المالك',
    inferredSourceType: inferred as SourceType,
    confidence: clampConfidence(obj.confidence),
    requiresHumanClarification: obj.requiresHumanClarification === true,
    ambiguities: asStringArray(obj.ambiguities),
    warnings: asStringArray(obj.warnings),
    proposedArtifacts,
  };
}

export const LEARNING_INTERPRETATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intentSummary: { type: 'string' },
    inferredSourceType: { type: 'string', enum: [...SOURCE_TYPES] },
    confidence: { type: 'number' },
    requiresHumanClarification: { type: 'boolean' },
    ambiguities: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    proposedArtifacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          artifactType: { type: 'string', enum: [...ARTIFACT_TYPES] },
          domain: { type: 'string', enum: [...DOMAINS] },
          topicKey: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          authorityClass: { type: 'string' },
          priority: { type: 'number' },
          confidence: { type: 'number' },
          entityType: { type: 'string' },
          entitySemanticHint: { type: 'string' },
          entityCode: { type: 'string' },
          structuredPayload: { type: 'object' },
          effectiveFrom: { type: 'string' },
          effectiveUntil: { type: 'string' },
        },
        required: ['artifactType', 'domain', 'topicKey', 'title', 'summary', 'structuredPayload'],
      },
    },
  },
  required: [
    'intentSummary',
    'inferredSourceType',
    'confidence',
    'requiresHumanClarification',
    'ambiguities',
    'warnings',
    'proposedArtifacts',
  ],
} as const;

export function validateParsedArtifactDomains(artifacts: RawGeminiProposedArtifact[]): void {
  for (const a of artifacts) {
    if (!isEnumValue(ARTIFACT_TYPES, a.artifactType as ArtifactType)) {
      throw new Error(`Unknown artifact type: ${a.artifactType}`);
    }
    if (!isEnumValue(DOMAINS, a.domain as Domain)) {
      throw new Error(`Unknown domain: ${a.domain}`);
    }
  }
}
