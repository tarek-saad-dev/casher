/**
 * Structured booking/availability observability (Phase A).
 * Single-line JSON logs for aggregators — no customer PII.
 */
import type { AvailabilityReasonCode } from '@/lib/availability/reasonCodes';

export type BookingAvailabilityMetricEvent =
  | 'booking_create_success'
  | 'booking_create_failure'
  | 'booking_reschedule_success'
  | 'booking_reschedule_failure'
  | 'available_slots_empty'
  | 'booking_conflict'
  | 'queue_conflict'
  | 'hold_conflict'
  | 'hold_created'
  | 'hold_consumed'
  | 'hold_expired'
  | 'hold_released'
  | 'attendance_auto_absence'
  | 'attendance_late_warning'
  | 'public_booking_gate_failure'
  | 'whatsapp_notification_result'
  | 'legacy_booking_create'
  | 'affected_bookings_marked'
  | 'ops_availability_version_bump';

export type BookingAvailabilityMetricPayload = {
  event: BookingAvailabilityMetricEvent;
  reasonCode?: string | null;
  branchId?: number | null;
  branchCode?: string | null;
  empId?: number | null;
  businessDate?: string | null;
  dayOffset?: number | null;
  overnight?: boolean | null;
  bookingId?: number | null;
  bookingCode?: string | null;
  holdId?: number | null;
  source?: string | null;
  purpose?: string | null;
  slotCount?: number | null;
  affectedCount?: number | null;
  whatsappStatus?: string | null;
  durationMs?: number | null;
  requestId?: string | null;
  extra?: Record<string, string | number | boolean | null>;
};

const counters = new Map<string, number>();

function bumpCounter(key: string): number {
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}

export function getBookingAvailabilityMetricCounters(): Record<string, number> {
  return Object.fromEntries(counters.entries());
}

export function resetBookingAvailabilityMetricCountersForTests(): void {
  counters.clear();
}

/** Emit structured metric log. Never include phone/name/notes. */
export function logBookingAvailabilityMetric(payload: BookingAvailabilityMetricPayload): void {
  const counterKey = `${payload.event}:${payload.reasonCode ?? '-'}`;
  const count = bumpCounter(counterKey);
  console.info(
    '[booking-availability-metric]',
    JSON.stringify({
      ...payload,
      metricCount: count,
      at: new Date().toISOString(),
    }),
  );
}

export function logEmptySlotsMetric(args: {
  reasonCode: AvailabilityReasonCode | string;
  branchId?: number | null;
  branchCode?: string | null;
  empId?: number | null;
  businessDate?: string | null;
  dayOffset?: number | null;
  overnight?: boolean;
  source?: string | null;
}): void {
  logBookingAvailabilityMetric({
    event: 'available_slots_empty',
    reasonCode: args.reasonCode,
    branchId: args.branchId ?? null,
    branchCode: args.branchCode ?? null,
    empId: args.empId ?? null,
    businessDate: args.businessDate ?? null,
    dayOffset: args.dayOffset ?? null,
    overnight: args.overnight ?? null,
    source: args.source ?? null,
    slotCount: 0,
  });
}

export function logCreateOutcomeMetric(args: {
  ok: boolean;
  reasonCode?: string | null;
  branchId?: number | null;
  branchCode?: string | null;
  empId?: number | null;
  businessDate?: string | null;
  dayOffset?: number | null;
  overnight?: boolean;
  bookingId?: number | null;
  bookingCode?: string | null;
  source?: string | null;
  purpose?: string | null;
  durationMs?: number | null;
  requestId?: string | null;
}): void {
  logBookingAvailabilityMetric({
    event: args.ok ? 'booking_create_success' : 'booking_create_failure',
    reasonCode: args.reasonCode ?? null,
    branchId: args.branchId ?? null,
    branchCode: args.branchCode ?? null,
    empId: args.empId ?? null,
    businessDate: args.businessDate ?? null,
    dayOffset: args.dayOffset ?? null,
    overnight: args.overnight ?? null,
    bookingId: args.bookingId ?? null,
    bookingCode: args.bookingCode ?? null,
    source: args.source ?? null,
    purpose: args.purpose ?? null,
    durationMs: args.durationMs ?? null,
    requestId: args.requestId ?? null,
  });
}
