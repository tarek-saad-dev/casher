/**
 * V4 lightweight task stack — suspend booking while answering interruptions.
 */
import type { BookingPlanSnapshot } from '../planner/types';

type SuspendedTask = {
  planId: number;
  suspendedAt: number;
  reason: string;
};

const suspended = new Map<number, SuspendedTask>();

export function suspendBookingTask(
  conversationId: number,
  plan: BookingPlanSnapshot,
  reason: string,
): void {
  suspended.set(conversationId, {
    planId: plan.planId,
    suspendedAt: Date.now(),
    reason,
  });
}

export function resumeBookingTask(conversationId: number): boolean {
  return suspended.delete(conversationId);
}

export function isBookingTaskSuspended(conversationId: number): boolean {
  return suspended.has(conversationId);
}

export function getSuspendedTask(conversationId: number): SuspendedTask | null {
  return suspended.get(conversationId) ?? null;
}

/** Test helper */
export function resetTaskStackForTests(): void {
  suspended.clear();
}
