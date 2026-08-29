/**
 * Dialogue policy helpers — ask only missing fields; confidence gates.
 */
import type { MutablePlan } from '../planner/planState';
import type { BookingPlanMissingField } from '../planner/types';

export type FieldConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export function shouldAskField(
  plan: MutablePlan,
  field: BookingPlanMissingField,
): boolean {
  switch (field) {
    case 'service':
      return plan.serviceIds.length === 0;
    case 'date':
      return !plan.requestedDate;
    case 'employee':
      return false; // optional unless policy requires
    case 'branch':
      return !plan.branchCode;
    case 'slot_choice':
      return plan.candidateSlots.length > 0 && !plan.selectedSlot;
    case 'confirm':
      return Boolean(plan.selectedSlot) && plan.stage === 'ready_to_confirm';
    case 'time':
      return false;
    default:
      return true;
  }
}

export function knownFieldsSummary(plan: MutablePlan): string[] {
  const known: string[] = [];
  if (plan.serviceIds.length) known.push('service');
  if (plan.empId) known.push('employee');
  if (plan.branchCode) known.push('branch');
  if (plan.requestedDate) known.push('date');
  if (plan.timePreference) known.push('timePreference');
  if (plan.selectedSlot) known.push('selectedSlot');
  return known;
}

/** True when we have enough to run availability without asking again. */
export function readyForAvailabilitySearch(plan: MutablePlan): boolean {
  return plan.serviceIds.length > 0 && Boolean(plan.requestedDate) && Boolean(plan.branchCode);
}

export function confidenceAllowsSilentProceed(c: FieldConfidence | undefined): boolean {
  return c === 'HIGH' || c === 'MEDIUM';
}
