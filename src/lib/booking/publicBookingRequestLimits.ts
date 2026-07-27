/**
 * Booking Phase 7C2 — bounded public booking request complexity limits.
 */
import 'server-only';

export const PUBLIC_BOOKING_REQUEST_LIMITS = {
  maxServiceIds: 12,
  maxNotesLength: 500,
  maxCustomerNameLength: 120,
  maxReasonTextLength: 250,
  maxUpcomingLimit: 25,
  maxCalendarRangeDays: 31,
  maxIdempotencyKeyLength: 128,
  maxClientRequestIdLength: 128,
  maxBookingCodeLength: 32,
  maxPlanTokenLength: 4096,
  maxAccessTokenLength: 4096,
} as const;

export type RequestLimitViolation = {
  field: string;
  code: 'INVALID_REQUEST' | 'INVALID_LIMIT' | 'INVALID_NOTES' | 'INVALID_BOOKING_CODE';
  message: string;
};

export function validatePublicServiceIdsCount(count: number): RequestLimitViolation | null {
  if (count <= 0) return null;
  if (count > PUBLIC_BOOKING_REQUEST_LIMITS.maxServiceIds) {
    return {
      field: 'serviceIds',
      code: 'INVALID_REQUEST',
      message: `Too many services (max ${PUBLIC_BOOKING_REQUEST_LIMITS.maxServiceIds})`,
    };
  }
  return null;
}

export function validateBoundedString(
  value: unknown,
  field: string,
  maxLen: number,
): RequestLimitViolation | null {
  if (value == null || value === '') return null;
  const s = String(value);
  if (s.length > maxLen) {
    return {
      field,
      code: 'INVALID_REQUEST',
      message: `${field} exceeds maximum length`,
    };
  }
  return null;
}
