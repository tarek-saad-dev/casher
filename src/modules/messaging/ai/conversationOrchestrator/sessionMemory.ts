/**
 * In-process session memory for V3 (confirmation gate + references + repair).
 * Survives within a worker process; confirmation safety does not rely on Gemini.
 */
import type { BotActionKind, RecentTurnRecord, SessionMemory } from './types';

const sessions = new Map<number, SessionMemory>();

export function getSessionMemory(conversationId: number): SessionMemory {
  let s = sessions.get(conversationId);
  if (!s) {
    s = {
      conversationId,
      recentTurns: [],
      lastBotAction: 'other',
      pendingConfirmPlanId: null,
      pendingConfirmVersion: null,
      lastReferencedBranchCode: null,
      lastReferencedBranchName: null,
      lastReferencedTime: null,
      lastUnresolvedCustomerText: null,
      repairAttempt: 0,
    };
    sessions.set(conversationId, s);
  }
  return s;
}

export function pushCustomerTurn(conversationId: number, text: string, intent?: string): void {
  const s = getSessionMemory(conversationId);
  s.recentTurns.push({ role: 'customer', text, intent });
  if (s.recentTurns.length > 12) s.recentTurns = s.recentTurns.slice(-12);
}

export function recordBotAction(
  conversationId: number,
  args: {
    text: string;
    action: BotActionKind;
    answeredWell: boolean;
    planId?: number | null;
    planVersion?: number | null;
    referencedBranchCode?: string | null;
    referencedBranchName?: string | null;
    referencedTime?: string | null;
    customerText?: string | null;
  },
): void {
  const s = getSessionMemory(conversationId);
  s.lastBotAction = args.action;
  s.recentTurns.push({
    role: 'bot',
    text: args.text,
    action: args.action,
    answeredWell: args.answeredWell,
  });
  if (s.recentTurns.length > 12) s.recentTurns = s.recentTurns.slice(-12);

  if (args.action === 'ask_booking_confirm') {
    s.pendingConfirmPlanId = args.planId ?? null;
    s.pendingConfirmVersion = args.planVersion ?? null;
  } else if (
    args.action === 'answered_query' ||
    args.action === 'answered_price' ||
    args.action === 'answered_alt_employees'
  ) {
    // Intervening query invalidates stale confirmation
    s.pendingConfirmPlanId = null;
    s.pendingConfirmVersion = null;
  }

  if (args.referencedBranchCode) s.lastReferencedBranchCode = args.referencedBranchCode;
  if (args.referencedBranchName) s.lastReferencedBranchName = args.referencedBranchName;
  if (args.referencedTime) s.lastReferencedTime = args.referencedTime;

  if (!args.answeredWell && args.customerText) {
    s.lastUnresolvedCustomerText = args.customerText;
    s.repairAttempt += 1;
  } else if (args.answeredWell) {
    s.lastUnresolvedCustomerText = null;
    s.repairAttempt = 0;
  }
}

export function clearPendingConfirmation(conversationId: number): void {
  const s = getSessionMemory(conversationId);
  s.pendingConfirmPlanId = null;
  s.pendingConfirmVersion = null;
}

/** Test helper */
export function resetSessionMemoryForTests(): void {
  sessions.clear();
}
