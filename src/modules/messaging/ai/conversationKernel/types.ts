/**
 * Customer-Led Conversation Kernel V4 — types.
 * Reuses orchestrator TurnFrame as base; adds constraint delta + routing.
 */
import type { ConstraintDelta } from '../conversationOrchestrator/constraintDelta';
import type {
  OrchestratorIntent,
  ResponsePlan,
  TurnFrame,
} from '../conversationOrchestrator/types';

export type SpeechAct =
  | 'question'
  | 'command'
  | 'confirmation'
  | 'rejection'
  | 'correction'
  | 'selection'
  | 'resume'
  | 'cancel'
  | 'statement';

export type KernelRouteAction =
  | 'answer_ephemeral_query'
  | 'pass_phase2_tools'
  | 'human_handoff'
  | 'block_stale_confirm'
  | 'allow_booking_confirm'
  | 'delegate_planner'
  | 'delegate_resume';

export type V4TurnFrame = TurnFrame & {
  speechAct: SpeechAct;
  constraintDelta: ConstraintDelta | null;
  isSelection: boolean;
  isNewTask: boolean;
  mutatesActiveTask: boolean;
  secondaryIntents: OrchestratorIntent[];
};

export type ActiveTaskMemory = {
  kind: 'BOOKING';
  planId: number | null;
  stage: string | null;
  suspended: boolean;
  serviceNames: string[];
  employeeName: string | null;
  branchName: string | null;
  requestedDate: string | null;
  timeHm: string | null;
};

export type ScopedMemoryView = {
  conversation: {
    lastBranchCode: string | null;
    lastBranchName: string | null;
    lastEmployeeName: string | null;
    lastTimeHm: string | null;
  };
  activeTask: ActiveTaskMemory | null;
  pendingConfirmation: boolean;
  recentDiscourse: Array<{ role: 'customer' | 'bot'; text: string }>;
};

export type KernelRoute = {
  action: KernelRouteAction;
  mutatesActiveTask: boolean;
  suspendActiveTask: boolean;
  blockBookingConfirm: boolean;
  allowBookingConfirm: boolean;
  passToPhase2: boolean;
  reasons: string[];
};

export type KernelDecision = {
  handled: boolean;
  bypassPlanner: boolean;
  passToPhase2: boolean;
  blockBookingConfirm: boolean;
  allowBookingConfirm: boolean;
  mutatesBookingPlan: boolean;
  replyText: string | null;
  responsePlan: ResponsePlan | null;
  turnFrame: V4TurnFrame;
  route: KernelRoute;
  lastBotAction: import('../conversationOrchestrator/types').BotActionKind;
  trace: Record<string, unknown>;
};

export type { ResponsePlan, TurnFrame, OrchestratorIntent };
