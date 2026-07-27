/** Booking Phase 7C2 — compatibility metadata and deprecation headers. */
import { describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

import {
  buildContractCompatibilityMetadata,
  DEPRECATION_HEADERS,
} from '@/lib/booking/publicBookingContractMode';
import { applyPublicBookingResponseHeaders } from '@/lib/booking/publicBookingResponse';

describe('bookingContractCompatibility', () => {
  it('returns null when no legacy flags', () => {
    expect(buildContractCompatibilityMetadata({})).toBeNull();
    expect(
      buildContractCompatibilityMetadata({ legacyRequestAccepted: false }),
    ).toBeNull();
  });

  it('builds metadata for missing plan token and/or idempotency key', () => {
    expect(
      buildContractCompatibilityMetadata({ missingPlanToken: true }),
    ).toEqual({
      legacyRequestAccepted: true,
      missingPlanToken: true,
    });
    expect(
      buildContractCompatibilityMetadata({ missingIdempotencyKey: true }),
    ).toEqual({
      legacyRequestAccepted: true,
      missingIdempotencyKey: true,
    });
    expect(
      buildContractCompatibilityMetadata({
        missingPlanToken: true,
        missingIdempotencyKey: true,
      }),
    ).toEqual({
      legacyRequestAccepted: true,
      missingPlanToken: true,
      missingIdempotencyKey: true,
    });
  });

  it('infers legacyRequestAccepted from missing requirements', () => {
    expect(
      buildContractCompatibilityMetadata({ missingPlanToken: true }).legacyRequestAccepted,
    ).toBe(true);
  });

  it('applies Deprecation and Warning headers when compatibility is set', () => {
    const res = NextResponse.json({ ok: true });
    applyPublicBookingResponseHeaders(res, {
      compatibility: {
        legacyRequestAccepted: true,
        missingIdempotencyKey: true,
      },
    });
    expect(res.headers.get('Deprecation')).toBe(DEPRECATION_HEADERS.Deprecation);
    expect(res.headers.get('Warning')).toBe(DEPRECATION_HEADERS.Warning);
  });

  it('omits deprecation headers when compatibility is null', () => {
    const res = NextResponse.json({ ok: true });
    applyPublicBookingResponseHeaders(res, { compatibility: null });
    expect(res.headers.get('Deprecation')).toBeNull();
    expect(res.headers.get('Warning')).toBeNull();
  });
});
