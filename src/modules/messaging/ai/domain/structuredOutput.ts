import { AI_INTENTS, type AiIntent, type AiStructuredResult, type AiEntities } from './types';

const INTENT_SET = new Set<string>(AI_INTENTS);

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function normalizeIntent(raw: unknown): AiIntent {
  const value = String(raw ?? 'unknown').trim().toLowerCase();
  return INTENT_SET.has(value) ? (value as AiIntent) : 'unknown';
}

function normalizeEntities(raw: unknown): AiEntities {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    dateText: asNullableString(obj.dateText),
    timeText: asNullableString(obj.timeText),
    employeeName: asNullableString(obj.employeeName),
    serviceText: asNullableString(obj.serviceText),
  };
}

export function parseAiStructuredResult(raw: unknown): AiStructuredResult {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const confidenceRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : 0;
  const replyText = String(obj.replyText ?? '').trim();
  const shouldReply = obj.shouldReply !== false && replyText.length > 0;

  return {
    replyText,
    intent: normalizeIntent(obj.intent),
    confidence,
    needsBusinessTool: obj.needsBusinessTool === true,
    missingInformation: asStringArray(obj.missingInformation),
    entities: normalizeEntities(obj.entities),
    shouldReply,
  };
}

export function validateAiStructuredResult(result: AiStructuredResult): void {
  if (!result.shouldReply) return;
  if (!result.replyText.trim()) {
    throw new Error('AI structured output missing replyText');
  }
  if (result.replyText.length > 4000) {
    throw new Error('AI replyText exceeds maximum length');
  }
}

export const AI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    replyText: { type: 'string' },
    intent: { type: 'string', enum: [...AI_INTENTS] },
    confidence: { type: 'number' },
    needsBusinessTool: { type: 'boolean' },
    missingInformation: { type: 'array', items: { type: 'string' } },
    entities: {
      type: 'object',
      properties: {
        dateText: { type: 'string', nullable: true },
        timeText: { type: 'string', nullable: true },
        employeeName: { type: 'string', nullable: true },
        serviceText: { type: 'string', nullable: true },
      },
    },
    shouldReply: { type: 'boolean' },
  },
  required: ['replyText', 'intent', 'confidence', 'needsBusinessTool', 'shouldReply'],
};
