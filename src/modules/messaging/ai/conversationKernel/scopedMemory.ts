/**
 * V4 scoped memory reader — conversation / active task / discourse views.
 */
import type { BookingPlanSnapshot } from '../planner/types';
import type { SessionMemory } from '../conversationOrchestrator/types';
import type { ActiveTaskMemory, ScopedMemoryView } from './types';
import { isBookingTaskSuspended } from './taskStack';

export function buildActiveTaskMemory(
  plan: BookingPlanSnapshot | null,
  conversationId: number,
): ActiveTaskMemory | null {
  if (!plan) return null;
  if (!['collecting', 'clarifying', 'choosing_slot', 'ready_to_confirm', 'confirmed_intent'].includes(plan.stage)) {
    return null;
  }
  return {
    kind: 'BOOKING',
    planId: plan.planId,
    stage: plan.stage,
    suspended: isBookingTaskSuspended(conversationId),
    serviceNames: [...plan.serviceNames],
    employeeName: plan.employeeName,
    branchName: plan.branchName,
    requestedDate: plan.requestedDate,
    timeHm: plan.selectedSlot?.time ?? plan.timePreference?.timeHm ?? null,
  };
}

export function readScopedMemory(args: {
  conversationId: number;
  plan: BookingPlanSnapshot | null;
  session: SessionMemory;
}): ScopedMemoryView {
  const { plan, session } = args;
  return {
    conversation: {
      lastBranchCode: session.lastReferencedBranchCode,
      lastBranchName: session.lastReferencedBranchName,
      lastEmployeeName: plan?.employeeName ?? null,
      lastTimeHm: session.lastReferencedTime ?? plan?.selectedSlot?.time ?? null,
    },
    activeTask: buildActiveTaskMemory(plan, args.conversationId),
    pendingConfirmation:
      session.pendingConfirmPlanId != null && session.lastBotAction === 'ask_booking_confirm',
    recentDiscourse: session.recentTurns.slice(-6).map((t) => ({
      role: t.role,
      text: t.text,
    })),
  };
}
