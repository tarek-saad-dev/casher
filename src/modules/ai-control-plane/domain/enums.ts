/** CUT AI Control Plane — Phase 1 registries */

export const SUBMISSION_STATUSES = [
  'RECEIVED',
  'ANALYZING',
  'ANALYZED',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'FAILED',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SOURCE_TYPES = [
  'MANUAL',
  'CORRECTION',
  'FAQ',
  'CONVERSATION_FEEDBACK',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ARTIFACT_TYPES = [
  'FACT',
  'CORRECTION',
  'FAQ',
  'BEHAVIOR_RULE',
  'WORKFLOW_RULE',
  'GOOD_EXAMPLE',
  'BAD_EXAMPLE',
  'BRAND_VOICE_RULE',
  'ESCALATION_RULE',
  'ENTITY_ALIAS',
  'OFFER_KNOWLEDGE',
  'CAPABILITY_KNOWLEDGE',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = [
  'DRAFT',
  'NEEDS_REVIEW',
  'APPROVED',
  'SUPERSEDED',
  'DISABLED',
  'REJECTED',
] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const DOMAINS = [
  'GENERAL',
  'BRANCHES',
  'OPENING_HOURS',
  'PRICES',
  'SERVICES',
  'EMPLOYEES',
  'BOOKING',
  'BOOKING_MANAGEMENT',
  'HUMAN_HANDOFF',
  'OFFERS',
  'RECOMMENDATIONS',
  'COMPLAINTS',
  'BRAND_VOICE',
  'ESCALATION',
  'CUSTOMER_SERVICE',
] as const;
export type Domain = (typeof DOMAINS)[number];

export const SCOPE_TYPES = [
  'GLOBAL',
  'DOMAIN',
  'BRANCH',
  'SERVICE',
  'EMPLOYEE',
  'WORKFLOW',
  'WORKFLOW_STAGE',
  'ENTITY',
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const TARGET_LAYERS = [
  'CURATED_KNOWLEDGE',
  'FAQ',
  'BRAND_VOICE',
  'BEHAVIOR_POLICY',
  'WORKFLOW_POLICY',
  'ENTITY_ALIAS',
  'ESCALATION_POLICY',
  'OFFER',
  'CAPABILITY',
  'POSITIVE_EXAMPLE',
  'NEGATIVE_EXAMPLE',
] as const;
export type TargetLayer = (typeof TARGET_LAYERS)[number];

export const AUTHORITY_CLASSES = [
  'SYSTEM_INVARIANT',
  'LIVE_TRANSACTIONAL',
  'LIVE_ERP',
  'OWNER_CURATED',
  'REVIEWED_IMPORTED',
  'GENERAL_MODEL',
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export const CONFLICT_TYPES = [
  'NONE',
  'DUPLICATE',
  'SUPERSEDES',
  'CONTRADICTS',
  'LOWER_AUTHORITY',
  'BLOCKED_BY_INVARIANT',
  'AMBIGUOUS',
  'EXPIRED_OR_TEMPORAL',
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const ENTITY_TYPES = ['BRANCH', 'SERVICE', 'EMPLOYEE'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const AUDIT_EVENT_TYPES = [
  'SUBMISSION_CREATED',
  'INTERPRETATION_STARTED',
  'INTERPRETATION_COMPLETED',
  'INTERPRETATION_FAILED',
  'ARTIFACT_PROPOSED',
  'ENTITY_RESOLVED',
  'CONFLICT_DETECTED',
  'INVARIANT_BLOCKED',
  'ARTIFACT_APPROVED',
  'ARTIFACT_REJECTED',
  'ARTIFACT_SUPERSEDED',
  'ARTIFACT_DISABLED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const WORKFLOWS = ['BOOKING', 'BOOKING_MANAGEMENT', 'HUMAN_HANDOFF'] as const;
export type WorkflowKey = (typeof WORKFLOWS)[number];

export const BRANCH_CODES = ['GLEEM', 'CAMP_CAESAR'] as const;
export type BranchCode = (typeof BRANCH_CODES)[number];

export const INTERPRETER_VERSION = 'phase1-gemini-v1';

export function isEnumValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return (values as readonly string[]).includes(value);
}
