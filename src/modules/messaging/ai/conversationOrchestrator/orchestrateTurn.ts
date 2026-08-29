/**
 * Conversation Orchestrator V3 — main decision entry.
 * CURRENT MESSAGE FIRST. Plan is context, not owner.
 */
import { getActiveBookingPlan } from '../planner/bookingPlanRepository';
import type { BookingPlanSnapshot } from '../planner/types';
import { evaluateBookingConfirmationGate } from './confirmationGate';
import { isConversationOrchestratorV3Enabled } from './featureFlag';
import {
  buildKeepContextReply,
  buildStaleConfirmClarifyReply,
  handleAvailabilityOrEmployeesQuery,
} from './queryHandlers';
import { resolveReferences } from './referenceResolver';
import { composeResponse, planQueryResponse } from './responsePlanner';
import {
  getSessionMemory,
  pushCustomerTurn,
  recordBotAction,
} from './sessionMemory';
import { buildTurnFrame, isEphemeralQueryIntent } from './turnFrame';
import type { OrchestratorDecision } from './types';

export type OrchestrateInput = {
  conversationId: number;
  inboundText: string;
  /** Optional injected plan for tests */
  plan?: BookingPlanSnapshot | null;
};

export async function orchestrateConversationTurn(
  input: OrchestrateInput,
): Promise<OrchestratorDecision | null> {
  if (!isConversationOrchestratorV3Enabled()) return null;

  const plan =
    input.plan !== undefined
      ? input.plan
      : await getActiveBookingPlan(input.conversationId);
  const session = getSessionMemory(input.conversationId);
  const turn = buildTurnFrame({ text: input.inboundText, session });
  pushCustomerTurn(input.conversationId, input.inboundText, turn.primaryIntent);

  const baseTrace: Record<string, unknown> = {
    version: 'v3',
    primaryIntent: turn.primaryIntent,
    scope: turn.scope,
    temporal: turn.temporal,
    mutatesBookingPlan: turn.mutatesBookingPlan,
    repairMode: turn.repairMode,
    planId: plan?.planId ?? null,
    planStage: plan?.stage ?? null,
  };

  // --- Ephemeral business queries: answer first, never mutate plan ---
  if (isEphemeralQueryIntent(turn.primaryIntent)) {
    // Price / business info → Phase 2 tools (passthrough) but clear confirm gate
    if (
      turn.primaryIntent === 'PRICE_QUERY' ||
      turn.primaryIntent === 'BUSINESS_INFORMATION_QUERY'
    ) {
      recordBotAction(input.conversationId, {
        text: '',
        action: 'answered_price',
        answeredWell: true,
        customerText: input.inboundText,
      });
      return {
        handled: false,
        bypassPlanner: true,
        passToPhase2: true,
        blockBookingConfirm: true,
        allowBookingConfirm: false,
        mutatesBookingPlan: false,
        replyText: null,
        responsePlan: null,
        turnFrame: turn,
        lastBotAction: 'answered_price',
        trace: { ...baseTrace, action: 'pass_phase2_price_or_info' },
      };
    }

    const ctx = resolveReferences({ turn, plan, session });
    const result = await handleAvailabilityOrEmployeesQuery({ turn, plan, ctx });
    const responsePlan = planQueryResponse({
      answer: result.replyText,
      // Optional light bridge only if booking ready — never full summary
      bridge:
        plan?.stage === 'ready_to_confirm' && plan.selectedSlot
          ? 'ولو حابب نرجع لحجزك الحالي قولي كمل.'
          : null,
    });
    const replyText = composeResponse(responsePlan);
    recordBotAction(input.conversationId, {
      text: replyText,
      action:
        turn.primaryIntent === 'BOOKING_ALTERNATIVE_QUERY'
          ? 'answered_alt_employees'
          : 'answered_query',
      answeredWell: result.ok,
      referencedBranchCode: result.referencedBranchCode,
      referencedBranchName: result.referencedBranchName,
      referencedTime: result.referencedTime,
      customerText: input.inboundText,
    });
    return {
      handled: true,
      bypassPlanner: true,
      passToPhase2: false,
      blockBookingConfirm: true,
      allowBookingConfirm: false,
      mutatesBookingPlan: false,
      replyText,
      responsePlan,
      turnFrame: turn,
      lastBotAction: 'answered_query',
      trace: {
        ...baseTrace,
        action: 'ephemeral_query',
        tool: result.tool,
        queryCtx: ctx,
      },
    };
  }

  // --- Keep booking context (e.g. خليك في عمر) ---
  if (turn.primaryIntent === 'KEEP_BOOKING_CONTEXT') {
    const replyText = buildKeepContextReply(plan);
    recordBotAction(input.conversationId, {
      text: replyText,
      action: 'ask_booking_confirm',
      answeredWell: true,
      planId: plan?.planId,
      planVersion: plan?.version,
      customerText: input.inboundText,
    });
    return {
      handled: true,
      bypassPlanner: true,
      passToPhase2: false,
      blockBookingConfirm: false,
      allowBookingConfirm: false,
      mutatesBookingPlan: false,
      replyText,
      responsePlan: planQueryResponse({ answer: replyText }),
      turnFrame: turn,
      lastBotAction: 'ask_booking_confirm',
      trace: { ...baseTrace, action: 'keep_booking_context' },
    };
  }

  // --- Affirmative / confirmation: gate Phase 4 ---
  if (turn.primaryIntent === 'BOOKING_CONFIRMATION' || turn.isConfirmation) {
    const gate = evaluateBookingConfirmationGate({
      conversationId: input.conversationId,
      turn,
      plan,
    });
    if (!gate.allow) {
      const replyText = buildStaleConfirmClarifyReply(plan);
      recordBotAction(input.conversationId, {
        text: replyText,
        action: 'other',
        answeredWell: true,
        customerText: input.inboundText,
      });
      return {
        handled: true,
        bypassPlanner: true,
        passToPhase2: false,
        blockBookingConfirm: true,
        allowBookingConfirm: false,
        mutatesBookingPlan: false,
        replyText,
        responsePlan: planQueryResponse({ answer: replyText }),
        turnFrame: turn,
        lastBotAction: 'other',
        trace: { ...baseTrace, action: 'stale_confirm_blocked', gate },
      };
    }
    return {
      handled: false,
      bypassPlanner: false,
      passToPhase2: false,
      blockBookingConfirm: false,
      allowBookingConfirm: true,
      mutatesBookingPlan: true,
      replyText: null,
      responsePlan: null,
      turnFrame: turn,
      lastBotAction: 'ask_booking_confirm',
      trace: { ...baseTrace, action: 'allow_booking_confirm', gate },
    };
  }

  // --- Resume ---
  if (turn.primaryIntent === 'RESUME_TASK') {
    return {
      handled: false,
      bypassPlanner: false,
      passToPhase2: false,
      blockBookingConfirm: false,
      allowBookingConfirm: false,
      mutatesBookingPlan: false,
      replyText: null,
      responsePlan: null,
      turnFrame: turn,
      lastBotAction: 'bridged_resume',
      trace: { ...baseTrace, action: 'delegate_resume_planner' },
    };
  }

  // --- Booking progress / modification / new / cancel → planner ---
  return {
    handled: false,
    bypassPlanner: false,
    passToPhase2: false,
    blockBookingConfirm: false,
    allowBookingConfirm: false,
    mutatesBookingPlan: turn.mutatesBookingPlan,
    replyText: null,
    responsePlan: null,
    turnFrame: turn,
    lastBotAction: 'other',
    trace: { ...baseTrace, action: 'delegate_planner' },
  };
}

/** Mark that planner emitted a confirm ask — call from processAiTurn after planner reply. */
export function notePlannerConfirmAsk(args: {
  conversationId: number;
  replyText: string;
  planId: number | null;
  planVersion: number | null;
}): void {
  if (!isConversationOrchestratorV3Enabled()) return;
  if (!/أأكد|اكدلك|أأكدلك|أكد الحجز|أأكد الحجز/.test(args.replyText)) return;
  recordBotAction(args.conversationId, {
    text: args.replyText,
    action: 'ask_booking_confirm',
    answeredWell: true,
    planId: args.planId,
    planVersion: args.planVersion,
  });
}

export function notePlannerSlotAsk(args: {
  conversationId: number;
  replyText: string;
}): void {
  if (!isConversationOrchestratorV3Enabled()) return;
  recordBotAction(args.conversationId, {
    text: args.replyText,
    action: 'ask_slot_choice',
    answeredWell: true,
  });
}
