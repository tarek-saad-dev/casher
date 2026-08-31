import type { ArtifactType, TargetLayer } from '../domain/enums';

export function routeTargetLayer(artifactType: ArtifactType, domain: string): TargetLayer {
  switch (artifactType) {
    case 'FACT':
    case 'CORRECTION':
      return domain === 'OPENING_HOURS' || domain === 'BRANCHES' ? 'CURATED_KNOWLEDGE' : 'CURATED_KNOWLEDGE';
    case 'FAQ':
      return 'FAQ';
    case 'BRAND_VOICE_RULE':
      return 'BRAND_VOICE';
    case 'BEHAVIOR_RULE':
      return 'BEHAVIOR_POLICY';
    case 'WORKFLOW_RULE':
      return 'WORKFLOW_POLICY';
    case 'ENTITY_ALIAS':
      return 'ENTITY_ALIAS';
    case 'ESCALATION_RULE':
      return 'ESCALATION_POLICY';
    case 'OFFER_KNOWLEDGE':
      return 'OFFER';
    case 'CAPABILITY_KNOWLEDGE':
      return 'CAPABILITY';
    case 'GOOD_EXAMPLE':
      return 'POSITIVE_EXAMPLE';
    case 'BAD_EXAMPLE':
      return 'NEGATIVE_EXAMPLE';
    default:
      return 'BEHAVIOR_POLICY';
  }
}
