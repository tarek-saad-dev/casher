import { isEnumValue, type ArtifactType } from './enums';

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNullableString(value: unknown): string | null {
  const s = asString(value);
  return s.length > 0 ? s : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v)).filter(Boolean);
}

export function validateArtifactPayload(
  artifactType: ArtifactType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (artifactType) {
    case 'FACT': {
      const value = asString(payload.value);
      const valueType = asString(payload.valueType) || 'text';
      if (!value) throw new Error('FACT payload requires value');
      return { value, valueType, unit: asNullableString(payload.unit), qualifiers: asStringArray(payload.qualifiers) };
    }
    case 'CORRECTION': {
      const correctedClaim = asString(payload.correctedClaim);
      if (!correctedClaim) throw new Error('CORRECTION payload requires correctedClaim');
      return {
        oldClaim: asNullableString(payload.oldClaim),
        correctedClaim,
        reason: asNullableString(payload.reason),
        targetArtifactId: payload.targetArtifactId ?? null,
        targetExistingLayer: asNullableString(payload.targetExistingLayer),
      };
    }
    case 'FAQ': {
      const canonicalQuestion = asString(payload.canonicalQuestion);
      const canonicalAnswer = asString(payload.canonicalAnswer);
      if (!canonicalQuestion || !canonicalAnswer) throw new Error('FAQ payload requires question and answer');
      return {
        canonicalQuestion,
        canonicalAnswer,
        paraphrases: asStringArray(payload.paraphrases),
        intentKey: asNullableString(payload.intentKey),
      };
    }
    case 'BEHAVIOR_RULE':
    case 'BRAND_VOICE_RULE': {
      const instruction = asString(payload.instruction);
      if (!instruction) throw new Error('BEHAVIOR_RULE requires instruction');
      return {
        instruction,
        preferredBehavior: asNullableString(payload.preferredBehavior),
        forbiddenBehavior: asNullableString(payload.forbiddenBehavior),
        examples: asStringArray(payload.examples),
      };
    }
    case 'WORKFLOW_RULE': {
      const instruction = asString(payload.instruction);
      const workflow = asString(payload.workflow);
      if (!instruction || !workflow) throw new Error('WORKFLOW_RULE requires workflow and instruction');
      return {
        workflow,
        stage: asNullableString(payload.stage),
        instruction,
        constraints: asStringArray(payload.constraints),
      };
    }
    case 'GOOD_EXAMPLE': {
      const preferredResponse = asString(payload.preferredResponse);
      if (!preferredResponse) throw new Error('GOOD_EXAMPLE requires preferredResponse');
      return {
        customerMessage: asNullableString(payload.customerMessage),
        preferredResponse,
        rationale: asNullableString(payload.rationale),
      };
    }
    case 'BAD_EXAMPLE': {
      const badResponse = asString(payload.badResponse);
      if (!badResponse) throw new Error('BAD_EXAMPLE requires badResponse');
      return {
        customerMessage: asNullableString(payload.customerMessage),
        badResponse,
        reason: asString(payload.reason) || 'غير مناسب',
        preferredAlternative: asNullableString(payload.preferredAlternative),
      };
    }
    case 'ENTITY_ALIAS': {
      const alias = asString(payload.alias);
      const canonicalEntity = asString(payload.canonicalEntity);
      if (!alias || !canonicalEntity) throw new Error('ENTITY_ALIAS requires alias and canonicalEntity');
      return { alias, canonicalEntity };
    }
    case 'ESCALATION_RULE': {
      const instruction = asString(payload.instruction);
      if (!instruction) throw new Error('ESCALATION_RULE requires instruction');
      return { instruction, triggers: asStringArray(payload.triggers) };
    }
    case 'OFFER_KNOWLEDGE': {
      const title = asString(payload.title);
      const description = asString(payload.description);
      if (!title) throw new Error('OFFER_KNOWLEDGE requires title');
      return {
        title,
        description,
        validFrom: asNullableString(payload.validFrom),
        validTo: asNullableString(payload.validTo),
      };
    }
    case 'CAPABILITY_KNOWLEDGE': {
      const capabilityKey = asString(payload.capabilityKey);
      const description = asString(payload.description);
      if (!capabilityKey) throw new Error('CAPABILITY_KNOWLEDGE requires capabilityKey');
      return { capabilityKey, description, branchCodes: asStringArray(payload.branchCodes) };
    }
    default:
      throw new Error(`Unknown artifact type: ${artifactType}`);
  }
}

export function isValidArtifactType(value: string): value is ArtifactType {
  return isEnumValue(
    [
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
    ],
    value,
  );
}
