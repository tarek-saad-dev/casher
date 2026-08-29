/**
 * Response planner — structure first, wording second.
 */
import type { ResponsePlan } from './types';

export function composeResponse(plan: ResponsePlan): string {
  const parts = [plan.answerCurrent];
  if (plan.clarification) parts.push(plan.clarification);
  if (plan.contextBridge) parts.push(plan.contextBridge);
  return parts.filter(Boolean).join('\n\n').trim();
}

export function planQueryResponse(args: {
  answer: string;
  bridge?: string | null;
  repair?: boolean;
}): ResponsePlan {
  return {
    answerCurrent: args.answer,
    contextBridge: args.bridge ?? null,
    askConfirm: false,
    clarification: null,
  };
}
