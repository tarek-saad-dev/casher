/**
 * V4 dialogue policy — query vs mutation; current turn overrides inherited context.
 */
import { isEphemeralQueryIntent } from '../conversationOrchestrator/turnFrame';
import type { ScopedMemoryView, V4TurnFrame, KernelRoute } from './types';

export function classifyQueryVsMutation(turn: V4TurnFrame): 'query' | 'mutation' | 'neutral' {
  if (isEphemeralQueryIntent(turn.primaryIntent)) return 'query';
  if (turn.secondaryIntents.some((i) => isEphemeralQueryIntent(i))) return 'query';
  if (
    turn.isModification ||
    turn.constraintDelta?.mutatesPlan ||
    turn.primaryIntent === 'BOOKING_MODIFICATION' ||
    turn.primaryIntent === 'CORRECTION'
  ) {
    return 'mutation';
  }
  if (turn.isConfirmation || turn.isSelection) return 'mutation';
  return 'neutral';
}

/**
 * Current-turn temporal for queries must NOT inherit booking slot when NOW is asked.
 */
export function effectiveQueryTemporal(turn: V4TurnFrame): V4TurnFrame['temporal'] {
  if (turn.temporal === 'now') return 'now';
  if (/حاليا|دلوقتي|الان|الآن/.test(turn.rawText)) return 'now';
  if (turn.isQuestion && !turn.isModification) return turn.temporal;
  return turn.temporal;
}

export function routeTurn(args: {
  turn: V4TurnFrame;
  scoped: ScopedMemoryView;
}): KernelRoute {
  const { turn, scoped } = args;
  const reasons: string[] = [];
  const qvm = classifyQueryVsMutation(turn);

  // Human handoff — never planner
  if (turn.primaryIntent === 'HUMAN_HANDOFF_REQUEST') {
    return {
      action: 'human_handoff',
      mutatesActiveTask: false,
      suspendActiveTask: false,
      blockBookingConfirm: true,
      allowBookingConfirm: false,
      passToPhase2: false,
      reasons: ['human_handoff'],
    };
  }

  // Ephemeral queries — answer first, suspend task, never mutate
  if (qvm === 'query' || isEphemeralQueryIntent(turn.primaryIntent)) {
    reasons.push('ephemeral_query');
    if (turn.primaryIntent === 'PRICE_QUERY' || turn.primaryIntent === 'BUSINESS_INFORMATION_QUERY') {
      return {
        action: 'pass_phase2_tools',
        mutatesActiveTask: false,
        suspendActiveTask: Boolean(scoped.activeTask),
        blockBookingConfirm: true,
        allowBookingConfirm: false,
        passToPhase2: true,
        reasons: [...reasons, 'phase2_price_or_info'],
      };
    }
    return {
      action: 'answer_ephemeral_query',
      mutatesActiveTask: false,
      suspendActiveTask: Boolean(scoped.activeTask),
      blockBookingConfirm: true,
      allowBookingConfirm: false,
      passToPhase2: false,
      reasons,
    };
  }

  // Confirmation with safety gate
  if (turn.isConfirmation || turn.primaryIntent === 'BOOKING_CONFIRMATION') {
    if (scoped.pendingConfirmation) {
      return {
        action: 'allow_booking_confirm',
        mutatesActiveTask: true,
        suspendActiveTask: false,
        blockBookingConfirm: false,
        allowBookingConfirm: true,
        passToPhase2: false,
        reasons: ['pending_confirm'],
      };
    }
    return {
      action: 'block_stale_confirm',
      mutatesActiveTask: false,
      suspendActiveTask: false,
      blockBookingConfirm: true,
      allowBookingConfirm: false,
      passToPhase2: false,
      reasons: ['stale_confirm_no_pending'],
    };
  }

  // Resume explicit
  if (turn.isResume || turn.primaryIntent === 'RESUME_TASK') {
    return {
      action: 'delegate_resume',
      mutatesActiveTask: false,
      suspendActiveTask: false,
      blockBookingConfirm: false,
      allowBookingConfirm: false,
      passToPhase2: false,
      reasons: ['resume_task'],
    };
  }

  // Booking progress / modification / selection / new → planner
  return {
    action: 'delegate_planner',
    mutatesActiveTask: turn.mutatesActiveTask,
    suspendActiveTask: false,
    blockBookingConfirm: false,
    allowBookingConfirm: false,
    passToPhase2: false,
    reasons: ['delegate_planner', qvm],
  };
}
