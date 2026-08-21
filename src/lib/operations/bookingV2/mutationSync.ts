/**
 * Booking V2 Phase O2.5 — mutation hooks for Hawai /operations.
 * Components call these after successful writes; never patch FreeMask directly.
 */

import {
  applyBookingCancelled,
  applyBookingCreated,
  applyBookingRescheduled,
  applyHoldCreated,
  applyHoldReleased,
  applyQueueOccupancy,
  applySlotUnavailableRefresh,
  invalidateEmployeeDay,
} from '@/lib/operations/bookingV2/AvailabilityStoreMutations';
import {
  intervalFromIsoRange,
  resolveBookingCreatedInterval,
  resolveRescheduleIntervals,
  type BookingCreateSlotFallback,
} from '@/lib/operations/bookingV2/intervalAuthority';

export const BOOKING_V2_SLOT_STALE_NOTICE_AR =
  'الموعد تم حجزه أو لم يعد متاحًا، اختر موعدًا آخر.';

export function notifyBookingV2CreateSuccess(args: {
  createResponse?: unknown;
  fallbackSlot?: BookingCreateSlotFallback | null;
}): void {
  const interval = resolveBookingCreatedInterval(args);
  if (!interval) return;
  applyBookingCreated(interval);
}

export function notifyBookingV2SlotConflict(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): void {
  applySlotUnavailableRefresh(args);
}

export function notifyBookingV2CancelSuccess(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): Promise<void> {
  return applyBookingCancelled(args);
}

/** Timeline cancel — prefer authoritative bookingDate from cancel API. */
export function notifyBookingV2CancelFromTimeline(args: {
  employeeId: number;
  businessDate: string;
}): Promise<void> {
  return notifyBookingV2CancelSuccess({
    employeeId: args.employeeId,
    businessDate: args.businessDate.slice(0, 10),
  });
}

export function notifyBookingV2RescheduleSuccess(args: {
  oldStartAt: string;
  oldEndAt: string;
  newStartAt: string;
  newEndAt: string;
  oldEmpId: number;
  newEmpId: number;
  oldOperationalDate: string;
  newOperationalDate?: string;
}): void {
  const intervals = resolveRescheduleIntervals({
    ...args,
    newOperationalDate: args.newOperationalDate ?? args.oldOperationalDate,
  });
  if (!intervals) return;
  applyBookingRescheduled(intervals);
}

export function notifyBookingV2HoldCreated(args: {
  employeeId: number;
  businessDate: string;
  startIso: string;
  endIso: string;
  branchCode?: string;
}): void {
  const interval = intervalFromIsoRange(args);
  if (!interval) return;
  applyHoldCreated(interval);
}

export function notifyBookingV2HoldReleased(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): void {
  applyHoldReleased(args);
}

export function notifyBookingV2WorkforceChange(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): void {
  invalidateEmployeeDay(args);
}

export function notifyBookingV2QueueCreated(args: {
  employeeId: number;
  businessDate: string;
  startIso: string;
  endIso: string;
  branchCode?: string;
}): void {
  const interval = intervalFromIsoRange(args);
  if (!interval) return;
  applyQueueOccupancy(interval);
}
