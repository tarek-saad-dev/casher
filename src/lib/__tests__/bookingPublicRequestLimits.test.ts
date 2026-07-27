/** Booking Phase 7C2 — bounded public request complexity limits. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  PUBLIC_BOOKING_REQUEST_LIMITS,
  validatePublicServiceIdsCount,
  validateBoundedString,
} from '@/lib/booking/publicBookingRequestLimits';

describe('bookingPublicRequestLimits', () => {
  it('validatePublicServiceIdsCount allows up to maxServiceIds', () => {
    expect(validatePublicServiceIdsCount(0)).toBeNull();
    expect(validatePublicServiceIdsCount(1)).toBeNull();
    expect(validatePublicServiceIdsCount(PUBLIC_BOOKING_REQUEST_LIMITS.maxServiceIds)).toBeNull();
    const over = validatePublicServiceIdsCount(
      PUBLIC_BOOKING_REQUEST_LIMITS.maxServiceIds + 1,
    );
    expect(over).toMatchObject({
      field: 'serviceIds',
      code: 'INVALID_REQUEST',
    });
    expect(over!.message).toContain(String(PUBLIC_BOOKING_REQUEST_LIMITS.maxServiceIds));
  });

  it('validateBoundedString rejects overlong values', () => {
    expect(validateBoundedString(null, 'notes', 10)).toBeNull();
    expect(validateBoundedString('', 'notes', 10)).toBeNull();
    expect(validateBoundedString('short', 'notes', 10)).toBeNull();
    const bad = validateBoundedString('x'.repeat(11), 'notes', 10);
    expect(bad).toMatchObject({ field: 'notes', code: 'INVALID_REQUEST' });
  });

  it('documents stable limit constants for routes', () => {
    expect(PUBLIC_BOOKING_REQUEST_LIMITS.maxNotesLength).toBe(500);
    expect(PUBLIC_BOOKING_REQUEST_LIMITS.maxUpcomingLimit).toBe(25);
    expect(PUBLIC_BOOKING_REQUEST_LIMITS.maxIdempotencyKeyLength).toBe(128);
    expect(PUBLIC_BOOKING_REQUEST_LIMITS.maxPlanTokenLength).toBe(4096);
  });
});
