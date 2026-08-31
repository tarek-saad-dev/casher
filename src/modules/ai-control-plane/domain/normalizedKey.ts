import type { ArtifactType, BranchCode } from './enums';

export function normalizeArabicText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

export function slugifyKeyPart(input: string): string {
  return normalizeArabicText(input)
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function buildOpeningHoursKey(branchCode: BranchCode): string {
  return `opening_hours.branch.${branchCode}`;
}

export function buildBrandBannedKey(term: string): string {
  return `brand_voice.banned_address.${slugifyKeyPart(term)}`;
}

export function buildBrandPhraseKey(term: string): string {
  return `brand_voice.banned_phrase.${slugifyKeyPart(term)}`;
}

export function buildFaqKey(intentKey: string): string {
  return `faq.${slugifyKeyPart(intentKey)}`;
}

export function buildWorkflowKey(workflow: string, stage?: string | null): string {
  const base = `workflow.${slugifyKeyPart(workflow)}`;
  return stage ? `${base}.${slugifyKeyPart(stage)}` : base;
}

export function buildEntityAliasKey(alias: string): string {
  return `entity_alias.${slugifyKeyPart(alias)}`;
}

export function buildBehaviorKey(topic: string): string {
  return `behavior.${slugifyKeyPart(topic)}`;
}

export function inferNormalizedKey(params: {
  artifactType: ArtifactType;
  domain: string;
  entityCode?: string | null;
  topicKey: string;
  payload?: Record<string, unknown>;
}): string {
  const { artifactType, entityCode, topicKey, payload } = params;
  if (artifactType === 'CORRECTION' && entityCode && params.domain === 'OPENING_HOURS') {
    return buildOpeningHoursKey(entityCode as BranchCode);
  }
  if (artifactType === 'FACT' && entityCode && params.domain === 'OPENING_HOURS') {
    return buildOpeningHoursKey(entityCode as BranchCode);
  }
  if (artifactType === 'BRAND_VOICE_RULE' || artifactType === 'BEHAVIOR_RULE') {
    const forbidden = String(payload?.forbiddenBehavior ?? payload?.instruction ?? '');
    if (/يا باشا|يا معلم|يا كبير/.test(forbidden)) {
      const match = forbidden.match(/يا\s+\S+/);
      if (match) return buildBrandBannedKey(match[0]);
    }
    return buildBehaviorKey(topicKey);
  }
  if (artifactType === 'FAQ') {
    const intent = String(payload?.intentKey ?? topicKey);
    return buildFaqKey(intent);
  }
  if (artifactType === 'ENTITY_ALIAS') {
    return buildEntityAliasKey(String(payload?.alias ?? topicKey));
  }
  if (artifactType === 'WORKFLOW_RULE') {
    return buildWorkflowKey(String(payload?.workflow ?? 'booking'), payload?.stage as string | undefined);
  }
  if (entityCode) {
    return `${slugifyKeyPart(params.domain)}.${slugifyKeyPart(entityCode)}.${slugifyKeyPart(topicKey)}`;
  }
  return `${slugifyKeyPart(params.domain)}.${slugifyKeyPart(topicKey)}`;
}
