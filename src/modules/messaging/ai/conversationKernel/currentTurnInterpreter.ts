/**
 * V4 current turn interpreter — sovereign message understanding + ConstraintDelta.
 */
import { buildTurnFrame } from '../conversationOrchestrator/turnFrame';
import {
  detectConstraintDelta,
  looksLikePureCandidateSelection,
} from '../conversationOrchestrator/constraintDelta';
import type { BookingPlanSnapshot } from '../planner/types';
import type { SessionMemory } from '../conversationOrchestrator/types';
import { detectRepairMode } from './repairEngine';
import type { SpeechAct, V4TurnFrame } from './types';

function inferSpeechAct(turn: ReturnType<typeof buildTurnFrame>): SpeechAct {
  if (turn.isConfirmation) return 'confirmation';
  if (turn.isRejection) return 'rejection';
  if (turn.isCorrection) return 'correction';
  if (turn.isResume) return 'resume';
  if (turn.isCancel) return 'cancel';
  if (turn.references.ordinal != null || looksLikePureCandidateSelection(turn.rawText)) {
    return 'selection';
  }
  if (turn.isQuestion) return 'question';
  if (turn.isModification || turn.mutatesBookingPlan) return 'command';
  return 'statement';
}

export function interpretCurrentTurn(args: {
  text: string;
  plan: BookingPlanSnapshot | null;
  session: SessionMemory;
}): V4TurnFrame {
  const repairMode = detectRepairMode({ text: args.text, session: args.session });
  const base = buildTurnFrame({ text: args.text, session: args.session });
  if (repairMode) {
    base.repairMode = true;
    base.scope = 'repair';
  }

  const contextTimeHm =
    args.plan?.timePreference?.timeHm ||
    args.plan?.selectedSlot?.time ||
    args.plan?.candidateSlots?.[0]?.time ||
    args.session.lastReferencedTime ||
    null;

  const constraintDelta = detectConstraintDelta({
    text: args.text,
    candidates: args.plan?.candidateSlots ?? [],
    contextTimeHm,
    contextStage: args.plan?.stage ?? null,
  });

  const speechAct = inferSpeechAct(base);
  const isSelection =
    speechAct === 'selection' ||
    Boolean(constraintDelta.isCandidateSelection) ||
    base.references.ordinal != null;

  const isNewTask =
    base.primaryIntent === 'NEW_BOOKING_REQUEST' &&
    Boolean(args.plan) &&
    args.plan.stage !== 'collecting';

  const secondaryIntents = base.secondaryIntent ? [base.secondaryIntent] : [];

  const queryIntents = new Set([
    'AVAILABILITY_QUERY',
    'BRANCH_QUERY',
    'EMPLOYEE_QUERY',
    'PRICE_QUERY',
    'BUSINESS_INFORMATION_QUERY',
    'BOOKING_ALTERNATIVE_QUERY',
  ]);

  let mutatesActiveTask = false;
  if (queryIntents.has(base.primaryIntent)) {
    mutatesActiveTask = false;
  } else if (base.isConfirmation || base.primaryIntent === 'BOOKING_CONFIRMATION') {
    mutatesActiveTask = Boolean(args.session.pendingConfirmPlanId);
  } else if (
    base.primaryIntent === 'BOOKING_PROGRESS' ||
    base.primaryIntent === 'NEW_BOOKING_REQUEST' ||
    base.primaryIntent === 'BOOKING_MODIFICATION' ||
    base.primaryIntent === 'CORRECTION' ||
    isSelection ||
    constraintDelta.mutatesPlan
  ) {
    mutatesActiveTask = true;
  } else {
    mutatesActiveTask = base.mutatesBookingPlan;
  }

  return {
    ...base,
    speechAct,
    constraintDelta,
    isSelection,
    isNewTask,
    mutatesActiveTask,
    secondaryIntents,
    repairMode: repairMode || base.repairMode,
  };
}
