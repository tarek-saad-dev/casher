/**
 * Customer-Led Conversation Kernel V4 — main entry.
 * CURRENT MESSAGE IS SOVEREIGN. Booking plan is context, not owner.
 */
import { getActiveBookingPlan } from '../planner/bookingPlanRepository';
import type { BookingPlanSnapshot } from '../planner/types';
import { evaluateBookingConfirmationGate } from '../conversationOrchestrator/confirmationGate';
import {
  buildKeepContextReply,
  handleAvailabilityOrEmployeesQuery,
} from '../conversationOrchestrator/queryHandlers';
import { resolveReferences } from '../conversationOrchestrator/referenceResolver';
import {
  getSessionMemory,
  pushCustomerTurn,
  recordBotAction,
} from '../conversationOrchestrator/sessionMemory';
import { isCustomerLedConversationV4Enabled } from './featureFlag';
import { interpretCurrentTurn } from './currentTurnInterpreter';
import { routeTurn, effectiveQueryTemporal } from './dialoguePolicy';
import { readScopedMemory } from './scopedMemory';
import {
  composeV4Response,
  buildStaleConfirmClarifyV4,
  HUMAN_HANDOFF_REPLY_AR,
  planV4Response,
} from './responsePlanner';
import { HANDOFF_ACK_AR } from '@/modules/messaging/handoff/domain/types';
import { isHumanHandoffActiveForPhone } from '@/modules/messaging/handoff/featureFlag';
import { resumeBookingTask, suspendBookingTask } from './taskStack';
import type { KernelDecision } from './types';
import { processConciergeTurn } from '../salonConcierge/processConciergeTurn';
import { isSalonConciergeBrainEnabled } from '../salonConcierge/featureFlag';
import { detectConciergeIntent } from '../salonConcierge/routing';

function handoffCustomerReply(phone?: string | null): string {
  return isHumanHandoffActiveForPhone(phone) ? HANDOFF_ACK_AR : HUMAN_HANDOFF_REPLY_AR;
}
export type KernelInput = {
  conversationId: number;
  inboundText: string;
  plan?: BookingPlanSnapshot | null;
  phone?: string | null;
};

export async function processKernelTurn(
  input: KernelInput,
): Promise<KernelDecision | null> {
  if (!isCustomerLedConversationV4Enabled()) return null;

  const plan =
    input.plan !== undefined
      ? input.plan
      : await getActiveBookingPlan(input.conversationId);
  const session = getSessionMemory(input.conversationId);
  const turn = interpretCurrentTurn({
    text: input.inboundText,
    plan,
    session,
  });
  pushCustomerTurn(input.conversationId, input.inboundText, turn.primaryIntent);

  const scoped = readScopedMemory({
    conversationId: input.conversationId,
    plan,
    session,
  });
  const route = routeTurn({ turn, scoped });

  const baseTrace: Record<string, unknown> = {
    version: 'v4',
    primaryIntent: turn.primaryIntent,
    speechAct: turn.speechAct,
    scope: turn.scope,
    temporal: turn.temporal,
    mutatesActiveTask: turn.mutatesActiveTask,
    repairMode: turn.repairMode,
    route: route.action,
    planId: plan?.planId ?? null,
    planStage: plan?.stage ?? null,
    taskSuspended: scoped.activeTask?.suspended ?? false,
    constraintDelta: turn.constraintDelta
      ? {
          timeHm: turn.constraintDelta.timePreference?.timeHm,
          repair: turn.constraintDelta.repairSignal,
          newTime: turn.constraintDelta.newTimeNotInCandidates,
        }
      : null,
  };

  if (route.suspendActiveTask && plan) {
    suspendBookingTask(input.conversationId, plan, route.action);
  }

  // --- Human handoff ---
  if (route.action === 'human_handoff') {
    const reply = handoffCustomerReply(input.phone);
    recordBotAction(input.conversationId, {
      text: reply,
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
      replyText: reply,
      responsePlan: planV4Response({ answer: reply }),
      turnFrame: turn,
      route,
      lastBotAction: 'other',
      trace: { ...baseTrace, action: 'human_handoff' },
    };
  }

  // --- Salon Concierge Brain (ephemeral; never mutates booking) ---
  const conciergeCandidate =
    isSalonConciergeBrainEnabled() &&
    (route.action === 'pass_phase2_tools' ||
      route.action === 'answer_ephemeral_query' ||
      turn.primaryIntent === 'BUSINESS_INFORMATION_QUERY' ||
      turn.primaryIntent === 'PRICE_QUERY' ||
      detectConciergeIntent(input.inboundText) !== 'NONE');

  if (conciergeCandidate) {
    try {
      const concierge = await processConciergeTurn({
        text: input.inboundText,
        session: getSessionMemory(input.conversationId),
      });
      if (concierge?.handled && concierge.replyText) {
        if (route.suspendActiveTask && plan) {
          suspendBookingTask(input.conversationId, plan, 'concierge');
        }
        recordBotAction(input.conversationId, {
          text: concierge.replyText,
          action: 'answered_query',
          answeredWell: !concierge.trace.knowledgeGap,
          customerText: input.inboundText,
        });
        return {
          handled: true,
          bypassPlanner: true,
          passToPhase2: false,
          blockBookingConfirm: true,
          allowBookingConfirm: false,
          mutatesBookingPlan: false,
          replyText: concierge.replyText,
          responsePlan: planV4Response({ answer: concierge.replyText }),
          turnFrame: turn,
          route: {
            ...route,
            action: 'answer_ephemeral_query',
            mutatesActiveTask: false,
            blockBookingConfirm: true,
            passToPhase2: false,
          },
          lastBotAction: 'answered_query',
          trace: {
            ...baseTrace,
            action: 'salon_concierge',
            concierge: concierge.trace,
          },
        };
      }
      if (concierge?.passToPhase2) {
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
          route: { ...route, action: 'pass_phase2_tools', passToPhase2: true },
          lastBotAction: 'answered_price',
          trace: {
            ...baseTrace,
            action: 'concierge_pass_phase2',
            concierge: concierge.trace,
          },
        };
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          type: 'messaging_salon_concierge_error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // --- Phase 2 price / business info ---
  if (route.action === 'pass_phase2_tools') {
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
      route,
      lastBotAction: 'answered_price',
      trace: { ...baseTrace, action: 'pass_phase2' },
    };
  }

  // --- Ephemeral query: answer FIRST, no bridge nag ---
  if (route.action === 'answer_ephemeral_query') {
    const queryTurn = { ...turn, temporal: effectiveQueryTemporal(turn) };
    const ctx = resolveReferences({ turn: queryTurn, plan, session });
    const result = await handleAvailabilityOrEmployeesQuery({
      turn: queryTurn,
      plan,
      ctx,
    });
    const responsePlan = planV4Response({
      answer: result.replyText,
      allowBridge: false,
    });
    const replyText = composeV4Response(responsePlan);
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
      route,
      lastBotAction: 'answered_query',
      trace: { ...baseTrace, action: 'ephemeral_query', tool: result.tool },
    };
  }

  // --- Keep booking context ---
  if (turn.primaryIntent === 'KEEP_BOOKING_CONTEXT') {
    resumeBookingTask(input.conversationId);
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
      responsePlan: planV4Response({ answer: replyText }),
      turnFrame: turn,
      route,
      lastBotAction: 'ask_booking_confirm',
      trace: { ...baseTrace, action: 'keep_context' },
    };
  }

  // --- Confirmation gate ---
  if (route.action === 'allow_booking_confirm') {
    const gate = evaluateBookingConfirmationGate({
      conversationId: input.conversationId,
      turn,
      plan,
    });
    if (!gate.allow) {
      const replyText = buildStaleConfirmClarifyV4(plan);
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
        responsePlan: planV4Response({ answer: replyText }),
        turnFrame: turn,
        route: { ...route, action: 'block_stale_confirm' },
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
      route,
      lastBotAction: 'ask_booking_confirm',
      trace: { ...baseTrace, action: 'allow_confirm', gate },
    };
  }

  if (route.action === 'block_stale_confirm') {
    const replyText = buildStaleConfirmClarifyV4(plan);
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
      responsePlan: planV4Response({ answer: replyText }),
      turnFrame: turn,
      route,
      lastBotAction: 'other',
      trace: { ...baseTrace, action: 'ambiguous_affirm_clarify' },
    };
  }

  // --- Resume ---
  if (route.action === 'delegate_resume') {
    resumeBookingTask(input.conversationId);
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
      route,
      lastBotAction: 'bridged_resume',
      trace: { ...baseTrace, action: 'delegate_resume' },
    };
  }

  // --- Delegate booking mutations to planner ---
  return {
    handled: false,
    bypassPlanner: false,
    passToPhase2: false,
    blockBookingConfirm: route.blockBookingConfirm,
    allowBookingConfirm: false,
    mutatesBookingPlan: turn.mutatesActiveTask,
    replyText: null,
    responsePlan: null,
    turnFrame: turn,
    route,
    lastBotAction: 'other',
    trace: { ...baseTrace, action: 'delegate_planner' },
  };
}

export function noteKernelConfirmAsk(args: {
  conversationId: number;
  replyText: string;
  planId: number | null;
  planVersion: number | null;
}): void {
  if (!isCustomerLedConversationV4Enabled()) return;
  if (!/أأكد|اكدلك|أأكدلك|أأكد الحجز|أكد الحجز/.test(args.replyText)) return;
  recordBotAction(args.conversationId, {
    text: args.replyText,
    action: 'ask_booking_confirm',
    answeredWell: true,
    planId: args.planId,
    planVersion: args.planVersion,
  });
}

export function noteKernelSlotAsk(args: {
  conversationId: number;
  replyText: string;
}): void {
  if (!isCustomerLedConversationV4Enabled()) return;
  recordBotAction(args.conversationId, {
    text: args.replyText,
    action: 'ask_slot_choice',
    answeredWell: true,
  });
}
