import {
  AI_INTENTS,
  type AiIntent,
  type AiStructuredResult,
  type AiEntities,
  type AiToolCallDraft,
} from './types';
import { AI_BUSINESS_TOOL_NAMES } from '../tools/types';

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
    branchText: asNullableString(obj.branchText),
  };
}

function normalizeToolCalls(raw: unknown): AiToolCallDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: AiToolCallDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = asNullableString(obj.name);
    if (!name) continue;
    out.push({
      name,
      branchCode: asNullableString(obj.branchCode),
      serviceQuery: asNullableString(obj.serviceQuery),
      employeeName: asNullableString(obj.employeeName),
      dateText: asNullableString(obj.dateText),
      timePreference: asNullableString(obj.timePreference),
    });
  }
  return out.slice(0, 4);
}

export function parseAiStructuredResult(raw: unknown): AiStructuredResult {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const confidenceRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : 0;
  const replyText = String(obj.replyText ?? '').trim();
  const toolCalls = normalizeToolCalls(obj.toolCalls);
  const needsBusinessTool = obj.needsBusinessTool === true || toolCalls.length > 0;
  // Allow empty replyText when requesting tools (second pass fills reply).
  const shouldReply =
    obj.shouldReply === false
      ? false
      : replyText.length > 0 || (needsBusinessTool && toolCalls.length > 0);

  return {
    replyText,
    intent: normalizeIntent(obj.intent),
    confidence,
    needsBusinessTool,
    missingInformation: asStringArray(obj.missingInformation),
    entities: normalizeEntities(obj.entities),
    shouldReply,
    toolCalls,
  };
}

export function validateAiStructuredResult(result: AiStructuredResult): void {
  if (!result.shouldReply) return;
  if (!result.replyText.trim() && result.toolCalls.length === 0) {
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
        branchText: { type: 'string', nullable: true },
      },
    },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: [...AI_BUSINESS_TOOL_NAMES] },
          branchCode: { type: 'string', nullable: true },
          serviceQuery: { type: 'string', nullable: true },
          employeeName: { type: 'string', nullable: true },
          dateText: { type: 'string', nullable: true },
          timePreference: { type: 'string', nullable: true },
        },
        required: ['name'],
      },
    },
    shouldReply: { type: 'boolean' },
  },
  required: ['replyText', 'intent', 'confidence', 'needsBusinessTool', 'shouldReply'],
};
