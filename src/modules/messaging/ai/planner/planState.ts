import type {
  BookingCandidateSlot,
  BookingPlanMissingField,
  BookingPlanSnapshot,
  BookingPlanStage,
  BookingTimePreference,
} from './types';
import { formatSlotLabelAr } from './slotPreferences';
import {
  buildAskPrompt as ciAsk,
  buildSlotChoicesReply as ciSlots,
  buildReadyToConfirmReply as ciReady,
  buildConfirmedIntentReply as ciConfirmed,
} from '../conversationIntelligence/responseComposer';

export type MutablePlan = {
  stage: BookingPlanStage;
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
  clarification: BookingPlanSnapshot['clarification'];
  lastAvailabilityCheckedAt: string | null;
};

export function emptyMutablePlan(): MutablePlan {
  return {
    stage: 'collecting',
    branchId: null,
    branchCode: null,
    branchName: null,
    serviceIds: [],
    serviceNames: [],
    empId: null,
    employeeName: null,
    requestedDate: null,
    timePreference: null,
    candidateSlots: [],
    selectedSlot: null,
    clientId: null,
    missingFields: ['service', 'date'],
    clarification: null,
    lastAvailabilityCheckedAt: null,
  };
}

export function fromSnapshot(plan: BookingPlanSnapshot): MutablePlan {
  return {
    stage: plan.stage,
    branchId: plan.branchId,
    branchCode: plan.branchCode,
    branchName: plan.branchName,
    serviceIds: [...plan.serviceIds],
    serviceNames: [...plan.serviceNames],
    empId: plan.empId,
    employeeName: plan.employeeName,
    requestedDate: plan.requestedDate,
    timePreference: plan.timePreference,
    candidateSlots: [...plan.candidateSlots],
    selectedSlot: plan.selectedSlot,
    clientId: plan.clientId,
    missingFields: [...plan.missingFields],
    clarification: plan.clarification,
    lastAvailabilityCheckedAt: plan.lastAvailabilityCheckedAt,
  };
}

/** Invalidate dependent fields when a core field changes. */
export function invalidateAfterChange(
  plan: MutablePlan,
  changed: Array<'service' | 'employee' | 'date' | 'branch' | 'timePreference'>,
): string[] {
  const invalidated: string[] = [];
  const touchSlots =
    changed.includes('service') ||
    changed.includes('employee') ||
    changed.includes('date') ||
    changed.includes('branch') ||
    changed.includes('timePreference');
  if (touchSlots && (plan.candidateSlots.length || plan.selectedSlot)) {
    plan.candidateSlots = [];
    plan.selectedSlot = null;
    plan.lastAvailabilityCheckedAt = null;
    invalidated.push('candidateSlots', 'selectedSlot');
  }
  return invalidated;
}

export function computeMissingFields(plan: MutablePlan): BookingPlanMissingField[] {
  const missing: BookingPlanMissingField[] = [];
  if (!plan.serviceIds.length) missing.push('service');
  if (!plan.requestedDate) missing.push('date');
  if (plan.candidateSlots.length && !plan.selectedSlot && plan.stage === 'choosing_slot') {
    missing.push('slot_choice');
  }
  if (plan.selectedSlot && plan.stage === 'ready_to_confirm') {
    missing.push('confirm');
  }
  return missing;
}

export function buildAskPrompt(missing: BookingPlanMissingField[]): string {
  return ciAsk(missing);
}

export function buildSlotChoicesReply(plan: MutablePlan): string {
  return ciSlots(plan);
}

export function buildReadyToConfirmReply(plan: MutablePlan): string {
  return ciReady(plan);
}

export function buildConfirmedIntentReply(plan: MutablePlan): string {
  return ciConfirmed(plan);
}

export function toCandidateFromAvailability(slot: {
  time: string;
  dayOffset?: 0 | 1;
  empId?: number | null;
  empName?: string | null;
}): BookingCandidateSlot {
  return {
    time: slot.time,
    dayOffset: (slot.dayOffset ?? 0) as 0 | 1,
    empId: slot.empId ?? null,
    empName: slot.empName ?? null,
    label: formatSlotLabelAr(slot.time),
  };
}
