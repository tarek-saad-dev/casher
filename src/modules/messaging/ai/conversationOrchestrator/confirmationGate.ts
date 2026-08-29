/**
 * Confirmation safety gate — Phase 4 write only when immediately relevant.
 */
import type { BookingPlanSnapshot } from '../planner/types';
import { getSessionMemory } from './sessionMemory';
import type { TurnFrame } from './types';

export type ConfirmGateResult = {
  allow: boolean;
  reason: string;
};

/**
 * Affirmative "اه" may execute booking ONLY if:
 * 1. last bot action asked to confirm booking
 * 2. pending confirm plan id/version still match
 * 3. no intervening answered_query cleared the pending confirm
 * 4. current turn is confirmation / booking progress affirmative
 */
export function evaluateBookingConfirmationGate(args: {
  conversationId: number;
  turn: TurnFrame;
  plan: BookingPlanSnapshot | null;
}): ConfirmGateResult {
  const session = getSessionMemory(args.conversationId);
  const plan = args.plan;

  if (!args.turn.isConfirmation && args.turn.primaryIntent !== 'BOOKING_CONFIRMATION') {
    return { allow: false, reason: 'not_affirmative' };
  }

  if (!plan) {
    return { allow: false, reason: 'no_active_plan' };
  }

  if (
    plan.stage !== 'ready_to_confirm' &&
    plan.stage !== 'confirmed_intent' &&
    plan.stage !== 'execution_failed'
  ) {
    return { allow: false, reason: `stage_${plan.stage}` };
  }

  if (session.lastBotAction !== 'ask_booking_confirm') {
    return { allow: false, reason: 'stale_or_intervening_action' };
  }

  if (
    session.pendingConfirmPlanId == null ||
    session.pendingConfirmPlanId !== plan.planId ||
    session.pendingConfirmVersion == null ||
    session.pendingConfirmVersion !== plan.version
  ) {
    return { allow: false, reason: 'confirm_snapshot_mismatch' };
  }

  return { allow: true, reason: 'ok' };
}
