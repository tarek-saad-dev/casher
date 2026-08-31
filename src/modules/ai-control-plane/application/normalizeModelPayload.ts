import type { ArtifactType } from '../domain/enums';

function pickString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

/** Coerce common Gemini field aliases into Phase 1 payload contracts. */
export function normalizeModelPayload(
  artifactType: ArtifactType,
  payload: Record<string, unknown>,
  context: { summary: string; title: string; rawInput: string },
): Record<string, unknown> {
  const p = { ...payload };

  switch (artifactType) {
    case 'BEHAVIOR_RULE':
    case 'BRAND_VOICE_RULE': {
      if (!pickString(p, 'instruction')) {
        const forbidden = pickString(
          p,
          'forbiddenBehavior',
          'forbiddenPhrase',
          'bannedPhrase',
          'bannedTerm',
          'term',
          'phrase',
        );
        const preferred = pickString(p, 'preferredBehavior', 'preferredAction', 'rule', 'description', 'text');
        if (forbidden) p.instruction = `ممنوع استخدام "${forbidden}"`;
        else if (preferred) p.instruction = preferred;
        else p.instruction = context.summary || context.title || context.rawInput;
      }
      if (!pickString(p, 'forbiddenBehavior')) {
        const forbidden = pickString(p, 'forbiddenPhrase', 'bannedPhrase', 'bannedTerm', 'term', 'phrase');
        if (forbidden) p.forbiddenBehavior = forbidden;
      }
      break;
    }
    case 'WORKFLOW_RULE': {
      if (!pickString(p, 'instruction')) {
        p.instruction = pickString(p, 'rule', 'description', 'text') || context.summary || context.rawInput;
      }
      if (!pickString(p, 'workflow')) p.workflow = 'BOOKING';
      break;
    }
    case 'ESCALATION_RULE': {
      if (!pickString(p, 'instruction')) {
        p.instruction = pickString(p, 'rule', 'description', 'text') || context.summary || context.rawInput;
      }
      break;
    }
    case 'FAQ': {
      if (!pickString(p, 'canonicalQuestion')) p.canonicalQuestion = pickString(p, 'question', 'q');
      if (!pickString(p, 'canonicalAnswer')) p.canonicalAnswer = pickString(p, 'answer', 'a');
      break;
    }
    case 'BAD_EXAMPLE': {
      if (!pickString(p, 'badResponse')) {
        p.badResponse = pickString(p, 'response', 'example', 'text') || context.summary;
      }
      if (!pickString(p, 'reason')) p.reason = pickString(p, 'rationale', 'why') || 'غير مناسب';
      break;
    }
    case 'GOOD_EXAMPLE': {
      if (!pickString(p, 'preferredResponse')) {
        p.preferredResponse = pickString(p, 'response', 'example', 'text') || context.summary;
      }
      break;
    }
    case 'CORRECTION': {
      if (!pickString(p, 'correctedClaim')) {
        p.correctedClaim = pickString(p, 'newValue', 'newClaim', 'value', 'text') || context.summary;
      }
      if (!pickString(p, 'oldClaim')) p.oldClaim = pickString(p, 'oldValue', 'previousClaim') || null;
      break;
    }
    case 'FACT': {
      if (!pickString(p, 'value')) p.value = pickString(p, 'text', 'claim', 'fact') || context.summary;
      if (!pickString(p, 'valueType')) p.valueType = 'text';
      break;
    }
    case 'ENTITY_ALIAS': {
      if (!pickString(p, 'alias')) p.alias = pickString(p, 'term', 'name');
      if (!pickString(p, 'canonicalEntity')) {
        p.canonicalEntity = pickString(p, 'canonical', 'entity', 'branchCode');
      }
      break;
    }
    default:
      break;
  }

  return p;
}
