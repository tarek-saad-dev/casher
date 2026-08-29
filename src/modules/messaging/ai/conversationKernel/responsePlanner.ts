/**
 * V4 response planner — answer current request first; no automatic nagging.
 */
import type { ResponsePlan } from '../conversationOrchestrator/types';

export function planV4Response(args: {
  answer: string;
  /** V4: bridges are opt-in only — default OFF after interruptions */
  bridge?: string | null;
  clarification?: string | null;
  allowBridge?: boolean;
}): ResponsePlan {
  return {
    answerCurrent: args.answer,
    contextBridge: args.allowBridge ? (args.bridge ?? null) : null,
    askConfirm: false,
    clarification: args.clarification ?? null,
  };
}

export function composeV4Response(plan: ResponsePlan): string {
  const parts = [plan.answerCurrent];
  if (plan.clarification) parts.push(plan.clarification);
  if (plan.contextBridge) parts.push(plan.contextBridge);
  return parts.filter(Boolean).join('\n\n').trim();
}

export const HUMAN_HANDOFF_REPLY_AR =
  'تمام، هحوّلك لحد من الاستقبال يكمل معاك. استنى لحظة.';

export function buildStaleConfirmClarifyV4(plan: {
  employeeName?: string | null;
  selectedSlot?: { label?: string; time?: string } | null;
} | null): string {
  const emp = plan?.employeeName || 'الحالي';
  const slot = plan?.selectedSlot?.label || plan?.selectedSlot?.time || '';
  if (slot) {
    return `تقصد نكمّل حجز ${emp} الساعة ${slot}، ولا حاجة تانية؟`;
  }
  return `تقصد نكمّل الحجز مع ${emp}، ولا حاجة تانية؟`;
}
