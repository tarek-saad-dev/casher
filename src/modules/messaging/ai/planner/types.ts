export const BOOKING_PLAN_STAGES = [
  'collecting',
  'clarifying',
  'choosing_slot',
  'ready_to_confirm',
  'confirmed_intent',
  'abandoned',
] as const;

export type BookingPlanStage = (typeof BOOKING_PLAN_STAGES)[number];

export const BOOKING_PLAN_ACTIVE_STAGES: BookingPlanStage[] = [
  'collecting',
  'clarifying',
  'choosing_slot',
  'ready_to_confirm',
  'confirmed_intent',
];

export type BookingTimePreference = {
  kind: 'earliest' | 'after' | 'before' | 'exact' | 'morning' | 'afternoon' | 'evening' | 'any';
  /** HH:mm 24h when after/before/exact */
  timeHm?: string | null;
};

export type BookingCandidateSlot = {
  time: string;
  dayOffset: 0 | 1;
  empId: number | null;
  empName: string | null;
  label: string;
};

export type BookingPlanMissingField =
  | 'service'
  | 'employee'
  | 'date'
  | 'branch'
  | 'time'
  | 'slot_choice'
  | 'confirm';

export type BookingPlanClarification = {
  field: BookingPlanMissingField | 'employee' | 'service' | 'branch';
  options: Array<{ id: string; label: string }>;
  prompt: string;
};

export type BookingPlanSnapshot = {
  planId: number;
  conversationId: number;
  stage: BookingPlanStage;
  version: number;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  serviceIds: number[];
  serviceNames: string[];
  empId: number | null;
  employeeName: string | null;
  requestedDate: string | null;
  timePreference: BookingTimePreference | null;
  candidateSlots: BookingCandidateSlot[];
  selectedSlot: BookingCandidateSlot | null;
  clientId: number | null;
  missingFields: BookingPlanMissingField[];
  clarification: BookingPlanClarification | null;
  lastAvailabilityCheckedAt: string | null;
  lastTurnId: number | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
};

export type BookingPlannerTrace = {
  conversationId: number;
  planId: number | null;
  stageBefore: BookingPlanStage | 'none';
  stageAfter: BookingPlanStage | 'none';
  extracted: Record<string, unknown>;
  validatedChanges: string[];
  invalidatedFields: string[];
  toolCalls: Array<{ name: string; ok: boolean; durationMs: number; errorCode?: string | null }>;
  missingFields: BookingPlanMissingField[];
  candidateSlotCount: number;
  selectedSlot: BookingCandidateSlot | null;
  deterministicAction: string | null;
};
