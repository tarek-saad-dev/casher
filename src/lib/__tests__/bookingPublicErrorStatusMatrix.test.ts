/** Booking Phase 7C2 — HTTP status consistency for public booking errors. */
import { describe, expect, it } from 'vitest';

import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';

const STATUS_EXPECTATIONS: Record<string, number> = {
  BRANCH_REQUIRED: 400,
  BRANCH_NOT_FOUND: 404,
  PLAN_TOKEN_REQUIRED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  LEGACY_BOOKING_CONTRACT_DISABLED: 400,
  RATE_LIMIT_EXCEEDED: 429,
  CORS_ORIGIN_NOT_ALLOWED: 403,
  BOOKING_ACCESS_TOKEN_INVALID: 401,
  BOOKING_ACCESS_TOKEN_EXPIRED: 401,
  BOOKING_LOOKUP_UNAVAILABLE: 503,
  UPCOMING_BOOKINGS_UNAVAILABLE: 503,
  BOOKING_ALREADY_CANCELLED: 200,
  SLOT_UNAVAILABLE: 409,
  BOOKING_CREATE_FAILED: 500,
};

describe('bookingPublicErrorStatusMatrix', () => {
  it('assigns expected HTTP status for key contract codes', () => {
    for (const [code, status] of Object.entries(STATUS_EXPECTATIONS)) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code as keyof typeof PUBLIC_BOOKING_ERROR_CATALOG].httpStatus).toBe(
        status,
      );
    }
  });

  it('uses only valid HTTP status classes', () => {
    for (const def of Object.values(PUBLIC_BOOKING_ERROR_CATALOG)) {
      expect(def.httpStatus).toBeGreaterThanOrEqual(200);
      expect(def.httpStatus).toBeLessThan(600);
      expect(def.code).toBeTruthy();
    }
  });

  it('maps 429 exclusively to RATE_LIMIT_EXCEEDED', () => {
    const rateLimited = Object.values(PUBLIC_BOOKING_ERROR_CATALOG).filter(
      (d) => d.httpStatus === 429,
    );
    expect(rateLimited.map((d) => d.code)).toEqual(['RATE_LIMIT_EXCEEDED']);
  });

  it('maps 403 exclusively to CORS_ORIGIN_NOT_ALLOWED', () => {
    const forbidden = Object.values(PUBLIC_BOOKING_ERROR_CATALOG).filter(
      (d) => d.httpStatus === 403,
    );
    expect(forbidden.map((d) => d.code)).toEqual(['CORS_ORIGIN_NOT_ALLOWED']);
  });
});
