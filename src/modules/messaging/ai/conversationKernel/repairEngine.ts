/**
 * V4 repair engine — detect when customer is correcting failed bot interpretation.
 */
import { isNearDuplicateQuestion } from '../conversationIntelligence/turnIntent';
import { looksLikeRepairSignal } from '../conversationOrchestrator/constraintDelta';
import type { SessionMemory } from '../conversationOrchestrator/types';

export function detectRepairMode(args: {
  text: string;
  session: SessionMemory;
}): boolean {
  const { text, session } = args;
  if (looksLikeRepairSignal(text)) return true;
  if (
    session.lastUnresolvedCustomerText &&
    session.lastBotAction !== 'answered_query' &&
    session.lastBotAction !== 'answered_price' &&
    session.lastBotAction !== 'answered_alt_employees' &&
    isNearDuplicateQuestion(session.lastUnresolvedCustomerText, text)
  ) {
    return true;
  }
  if (/^(لا|لأ)\s*(قصدي|انا|أنا)/.test(text.trim())) return true;
  if (/مش\s*ده\s*قصدي|فهمتني\s*غلط|فهمت\s*غلط/.test(text)) return true;
  return false;
}

export function shouldBlockRepeatedResponse(args: {
  session: SessionMemory;
  proposedReply: string;
  lastBotReply: string | null;
}): boolean {
  if (!args.lastBotReply) return false;
  const a = args.proposedReply.trim().slice(0, 80);
  const b = args.lastBotReply.trim().slice(0, 80);
  if (a === b && args.session.repairAttempt > 0) return true;
  return false;
}
