import type {
  ArtifactStatus,
  ArtifactType,
  AuditEventType,
  AuthorityClass,
  ConflictType,
  Domain,
  EntityType,
  ScopeType,
  SourceType,
  SubmissionStatus,
  TargetLayer,
} from './enums';

export type LearningSubmission = {
  submissionId: number;
  rawInput: string;
  sourceType: SourceType;
  submittedByUserId: number;
  contextJson: Record<string, unknown> | null;
  status: SubmissionStatus;
  interpreterVersion: string | null;
  modelName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProposedArtifact = {
  artifactType: ArtifactType;
  domain: Domain;
  scopeType: ScopeType;
  scopeKey: string | null;
  targetLayer: TargetLayer;
  entityType: EntityType | null;
  entityCode: string | null;
  entityId: number | null;
  topicKey: string;
  normalizedKey: string;
  title: string;
  summary: string;
  structuredPayload: Record<string, unknown>;
  authorityClass: AuthorityClass;
  priority: number;
  confidence: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  entityResolutionStatus?: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED';
  entityCandidates?: Array<{ entityType: EntityType; entityCode: string; label: string }>;
};

export type LearningArtifact = ProposedArtifact & {
  artifactId: number;
  submissionId: number;
  status: ArtifactStatus;
  version: number;
  supersedesArtifactId: number | null;
  createdByUserId: number;
  approvedByUserId: number | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ArtifactConflict = {
  conflictId?: number;
  artifactIndex: number;
  conflictType: ConflictType;
  messageAr: string;
  messageEn?: string;
  existingArtifactId?: number | null;
  existingSummary?: string | null;
  blockedInvariantId?: string | null;
};

export type InterpretationResult = {
  intentSummary: string;
  proposedArtifacts: ProposedArtifact[];
  ambiguities: string[];
  warnings: string[];
  requiresHumanClarification: boolean;
  confidence: number;
  inferredSourceType: SourceType;
  interpreterEngine?: 'gemini' | 'heuristic';
  modelName?: string;
};

export type AnalysisResult = {
  submission: LearningSubmission;
  interpretation: InterpretationResult;
  conflicts: ArtifactConflict[];
  blocked: boolean;
  previewCards: PreviewCard[];
};

export type PreviewCard = {
  artifactIndex: number;
  titleAr: string;
  summaryAr: string;
  impactAr: string;
  conflictType: ConflictType;
  canApprove: boolean;
  blockedReasonAr?: string;
};

export type LearningAuditEvent = {
  eventId: number;
  submissionId: number | null;
  artifactId: number | null;
  eventType: AuditEventType;
  actorUserId: number | null;
  modelName: string | null;
  detailsJson: Record<string, unknown>;
  createdAt: Date;
};

export type EntityResolution = {
  entityType: EntityType;
  entityCode: string;
  entityId: number | null;
  label: string;
  status: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED';
  candidates: Array<{ entityCode: string; label: string; entityId: number | null }>;
};

export const MAX_RAW_INPUT_LENGTH = 4000;
export const MAX_CONTEXT_JSON_BYTES = 8192;
