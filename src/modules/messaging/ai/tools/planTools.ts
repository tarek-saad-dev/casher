import type { AiIntent, AiStructuredResult } from '../domain/types';
import type { AiToolCallRequest } from './types';
import { isAiBusinessToolName } from './registry';

const READ_INTENTS = new Set<AiIntent>([
  'booking_request',
  'availability_question',
  'service_question',
  'price_question',
  'branch_question',
  'employee_question',
]);

export function intentRequiresBusinessTools(intent: AiIntent, needsBusinessTool: boolean): boolean {
  return needsBusinessTool || READ_INTENTS.has(intent);
}

/** Detect soft fake-checking replies that must not ship without tool execution. */
export function looksLikeFakeSystemCheck(replyText: string): boolean {
  const t = replyText.trim();
  if (!t) return false;
  return (
    /أراجع السيستم|براجع السيستم|هأكدلك الحجز|هأكد من السيستم|أشوفلك السيستم|من السيستم|ثواني.*(سيستم|أكد)/i.test(
      t,
    ) || /checking (the )?system|let me check (the )?system/i.test(t)
  );
}

function fromModelToolCalls(structured: AiStructuredResult): AiToolCallRequest[] {
  const raw = structured.toolCalls ?? [];
  const out: AiToolCallRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as { name?: unknown }).name;
    if (!isAiBusinessToolName(name)) continue;
    out.push({
      name,
      branchCode: nullableStr((item as { branchCode?: unknown }).branchCode),
      serviceQuery: nullableStr((item as { serviceQuery?: unknown }).serviceQuery),
      employeeName: nullableStr((item as { employeeName?: unknown }).employeeName),
      dateText: nullableStr((item as { dateText?: unknown }).dateText),
      timePreference: nullableStr((item as { timePreference?: unknown }).timePreference),
    });
  }
  return out;
}

function nullableStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * Build a bounded tool plan from model toolCalls, else derive from intent/entities.
 */
export function planBusinessToolCalls(structured: AiStructuredResult): AiToolCallRequest[] {
  const fromModel = fromModelToolCalls(structured);
  if (fromModel.length) return fromModel;

  if (!intentRequiresBusinessTools(structured.intent, structured.needsBusinessTool)) {
    return [];
  }

  const entities = structured.entities;
  const plan: AiToolCallRequest[] = [];

  switch (structured.intent) {
    case 'branch_question':
      plan.push({ name: 'list_branches' });
      plan.push({ name: 'get_business_hours' });
      break;
    case 'price_question':
    case 'service_question':
      plan.push({
        name: 'list_services',
        serviceQuery: entities.serviceText,
      });
      break;
    case 'employee_question':
      plan.push({
        name: 'list_employees',
        employeeName: entities.employeeName,
        dateText: entities.dateText,
      });
      break;
    case 'availability_question':
    case 'booking_request': {
      const hasService = Boolean(entities.serviceText);
      const hasDate = Boolean(entities.dateText);
      if (hasService && hasDate) {
        plan.push({
          name: 'get_availability',
          serviceQuery: entities.serviceText,
          employeeName: entities.employeeName,
          dateText: entities.dateText,
          timePreference: entities.timeText,
        });
      } else if (hasService && !hasDate) {
        plan.push({ name: 'list_services', serviceQuery: entities.serviceText });
      } else if (entities.employeeName) {
        plan.push({
          name: 'list_employees',
          employeeName: entities.employeeName,
          dateText: entities.dateText,
        });
      }
      // Not enough entities → no tool; processAiTurn asks for missing info.
      break;
    }
    default:
      // needsBusinessTool without a mapped intent: do not invent tool calls.
      break;
  }

  return plan;
}

export const SAFE_TOOL_FAILURE_REPLY_AR =
  'مقدرش أأكد المعلومة دي من السيستم دلوقتي. تقدر تبعت استفسارك تاني بعد شوية أو تتواصل مع الاستقبال مباشرة.';

export const SAFE_NO_WRITE_BOOKING_REPLY_AR =
  'لسه نظام الحجز المباشر من الشات مش مفعّل. أقدر أوريك المواعيد المتاحة من السيستم، والتأكيد النهائي هيتم مع الاستقبال.';
