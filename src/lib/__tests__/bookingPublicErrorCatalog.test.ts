/** Booking Phase 7C2 — public booking error catalog completeness. */
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_BOOKING_ERROR_CATALOG,
  publicBookingErrorBody,
  type PublicBookingErrorCode,
} from '@/lib/booking/publicBookingErrorCatalog';

const REQUIRED_7C2_CODES: PublicBookingErrorCode[] = [
  'PLAN_TOKEN_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'RATE_LIMIT_EXCEEDED',
  'LEGACY_BOOKING_CONTRACT_DISABLED',
  'CORS_ORIGIN_NOT_ALLOWED',
  'INVALID_REQUEST',
];

const CORE_BRANCH_CODES: PublicBookingErrorCode[] = [
  'BRANCH_REQUIRED',
  'BRANCH_NOT_FOUND',
  'BRANCH_NOT_PUBLIC',
  'BOOKING_NOT_FOUND',
  'BOOKING_CREATE_FAILED',
  'BOOKING_CANCELLATION_FAILED',
];

describe('bookingPublicErrorCatalog', () => {
  it('includes all Phase 7C2 required codes', () => {
    for (const code of REQUIRED_7C2_CODES) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code]).toBeDefined();
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code].code).toBe(code);
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code].messageAr.length).toBeGreaterThan(0);
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code].messageEn.length).toBeGreaterThan(0);
    }
  });

  it('includes core branch/create/cancel codes', () => {
    for (const code of CORE_BRANCH_CODES) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code]?.code).toBe(code);
    }
  });

  it('publicBookingErrorBody uses nested Phase 1 shape', () => {
    const body = publicBookingErrorBody('RATE_LIMIT_EXCEEDED', { retryAfterSeconds: 30 });
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.metadata).toEqual({ retryAfterSeconds: 30 });
  });

  it('catalog keys match declared codes exactly', () => {
    const keys = Object.keys(PUBLIC_BOOKING_ERROR_CATALOG).sort();
    const codes = keys.map(
      (k) => PUBLIC_BOOKING_ERROR_CATALOG[k as PublicBookingErrorCode].code,
    );
    expect(codes).toEqual(keys);
  });
});
