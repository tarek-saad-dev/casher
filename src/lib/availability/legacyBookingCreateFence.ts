/**
 * Phase 0 — Safety fence for legacy POST /api/bookings create.
 *
 * Default: enabled (preserve production) unless LEGACY_BOOKINGS_CREATE_ENABLED=false.
 * When disabled → HTTP 410 + LEGACY_BOOKING_CREATE_DISABLED.
 *
 * @deprecated Prefer POST /api/public/booking/create (source=operations|admin).
 */

import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';

export const LEGACY_BOOKING_CREATE_DISABLED_CODE = 'LEGACY_BOOKING_CREATE_DISABLED' as const;

export type LegacyBookingCreateLogPayload = {
  path: string;
  callerSource: string | null;
  branchId: number | null;
  empId: number | null;
  bookingDate: string | null;
  startTime: string | null;
  userId: number | null;
  requestId: string | null;
  outcome: 'allowed' | 'blocked' | 'success' | 'failure';
  errorCode?: string | null;
  /** True when the request shape is compatible with canonical public create. */
  canonicalCreateEligible: boolean;
};

function envFlagEnabled(raw: string | undefined, defaultEnabled: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultEnabled;
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return defaultEnabled;
}

/** Default ON — do not break production until explicitly disabled. */
export function isLegacyBookingsCreateEnabled(): boolean {
  return envFlagEnabled(process.env.LEGACY_BOOKINGS_CREATE_ENABLED, true);
}

export function isCanonicalCreateEligibleShape(input: {
  empId?: number | null;
  bookingDate?: string | null;
  startTime?: string | null;
  services?: unknown;
}): boolean {
  const hasDate = typeof input.bookingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.bookingDate);
  const hasTime = typeof input.startTime === 'string' && input.startTime.length >= 4;
  const services = Array.isArray(input.services) ? input.services : [];
  const hasService = services.some(
    (s) => s && typeof s === 'object' && Number((s as { proId?: number }).proId) > 0,
  );
  return hasDate && hasTime && hasService;
}

export function logLegacyBookingCreate(payload: LegacyBookingCreateLogPayload): void {
  // Structured single-line JSON for log aggregators — no customer PII.
  console.info(
    '[legacy-booking-create]',
    JSON.stringify({
      event: 'legacy_booking_create',
      deprecated: true,
      ...payload,
    }),
  );
  logBookingAvailabilityMetric({
    event: 'legacy_booking_create',
    reasonCode: payload.errorCode ?? payload.outcome,
    branchId: payload.branchId,
    empId: payload.empId,
    businessDate: payload.bookingDate,
    source: payload.callerSource,
    requestId: payload.requestId,
    extra: {
      path: payload.path,
      outcome: payload.outcome,
      canonicalCreateEligible: payload.canonicalCreateEligible,
    },
  });
}

export function legacyBookingCreateDisabledBody() {
  return {
    success: false,
    code: LEGACY_BOOKING_CREATE_DISABLED_CODE,
    message: 'This booking path is no longer available.',
    messageAr: 'مسار إنشاء الحجز القديم لم يعد متاحًا. استخدم مسار الحجز المعتمد.',
  };
}
