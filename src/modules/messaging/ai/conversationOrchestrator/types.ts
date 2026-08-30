/**
 * Conversation Orchestrator V3 — shared types.
 * Application owns state; Gemini assists wording only.
 */

export type OrchestratorIntent =
  | 'BOOKING_PROGRESS'
  | 'BOOKING_CONFIRMATION'
  | 'BOOKING_MODIFICATION'
  | 'BOOKING_ALTERNATIVE_QUERY'
  | 'BUSINESS_INFORMATION_QUERY'
  | 'AVAILABILITY_QUERY'
  | 'BRANCH_QUERY'
  | 'EMPLOYEE_QUERY'
  | 'PRICE_QUERY'
  | 'RESUME_TASK'
  | 'CANCEL_TASK'
  | 'RESET_TASK'
  | 'NEW_BOOKING_REQUEST'
  | 'GENERAL_CONVERSATION'
  | 'HUMAN_HANDOFF_REQUEST'
  | 'CORRECTION'
  | 'KEEP_BOOKING_CONTEXT'
  | 'AMBIGUOUS'
  | 'UNKNOWN';

export type TurnScope =
  | 'ephemeral_business_query'
  | 'active_booking'
  | 'resume_booking'
  | 'cancel_booking'
  | 'general'
  | 'repair';

export type TemporalMode = 'now' | 'explicit' | 'inherited' | 'none';

export type BotActionKind =
  | 'ask_booking_confirm'
  | 'ask_management_confirm'
  | 'ask_slot_choice'
  | 'ask_missing_field'
  | 'answered_query'
  | 'answered_price'
  | 'answered_alt_employees'
  | 'bridged_resume'
  | 'executed_booking'
  | 'other';

export type TurnFrame = {
  rawText: string;
  primaryIntent: OrchestratorIntent;
  secondaryIntent?: OrchestratorIntent;
  scope: TurnScope;
  entities: {
    branchHint: string | null;
    employeeHint: string | null;
    serviceHint: string | null;
    dateHint: string | null;
    timeHint: string | null;
  };
  references: {
    there: boolean; // هناك
    thatTime: boolean; // الوقت ده
    sameTime: boolean;
    sameDay: boolean;
    he: boolean; // هو
    ordinal: number | null;
  };
  temporal: TemporalMode;
  isQuestion: boolean;
  isCorrection: boolean;
  isModification: boolean;
  isConfirmation: boolean;
  isRejection: boolean;
  isResume: boolean;
  isCancel: boolean;
  requiresBusinessTool: boolean;
  mutatesBookingPlan: boolean;
  repairMode: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type TaskKind = 'BOOKING' | 'PRICE_QUERY' | 'AVAILABILITY_QUERY' | 'EMPLOYEE_QUERY';

export type TaskFrame = {
  kind: TaskKind;
  planId: number | null;
  stage: string | null;
  suspended: boolean;
};

export type RecentTurnRecord = {
  role: 'customer' | 'bot';
  text: string;
  intent?: string;
  action?: BotActionKind;
  answeredWell?: boolean;
};

export type SessionMemory = {
  conversationId: number;
  recentTurns: RecentTurnRecord[];
  lastBotAction: BotActionKind;
  pendingConfirmPlanId: number | null;
  pendingConfirmVersion: number | null;
  lastReferencedBranchCode: string | null;
  lastReferencedBranchName: string | null;
  lastReferencedTime: string | null;
  lastUnresolvedCustomerText: string | null;
  repairAttempt: number;
  /** V3.1 — repeated clarification guard */
  lastClarificationType: string | null;
  lastClarificationAskedAt: number | null;
  evidenceAddedSinceClarification: boolean;
  /** Booking Management V1 — soft references (in-process). */
  lastRelevantBooking?: {
    bookingId: number | null;
    bookingCode: string;
    snapshot: import('../bookingManagement/types').UpcomingBookingSummary;
    lastReferencedAt: string;
  } | null;
  pendingBookingSelection?: {
    expectedAnswerType: 'BOOKING_SELECTION';
    candidateBookingCodes: string[];
    askedAt: string;
  } | null;
};

export type ResponsePlan = {
  answerCurrent: string;
  contextBridge: string | null;
  askConfirm: boolean;
  clarification: string | null;
};

export type OrchestratorDecision = {
  handled: boolean;
  /** Skip planner; use replyText */
  bypassPlanner: boolean;
  /** Pass to Phase 2 tools without planner consuming turn */
  passToPhase2: boolean;
  /** Block Phase 4 execute even if planner would affirm */
  blockBookingConfirm: boolean;
  /** Allow Phase 4 only when gate says so */
  allowBookingConfirm: boolean;
  mutatesBookingPlan: boolean;
  replyText: string | null;
  responsePlan: ResponsePlan | null;
  turnFrame: TurnFrame;
  lastBotAction: BotActionKind;
  trace: Record<string, unknown>;
};
