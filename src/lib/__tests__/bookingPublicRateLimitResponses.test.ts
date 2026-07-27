/** Booking Phase 7C2 — rate-limit 429 response shape and headers. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { gatePublicBookingRoute } from '@/lib/booking/publicBookingRouteGate';
import { resetPublicBookingRateLimitsForTests } from '@/lib/booking/publicBookingRateLimitPolicy';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';

beforeEach(() => {
  resetPublicBookingRateLimitsForTests();
  process.env.PUBLIC_BOOKING_RL_DISCOVERY = '1';
});

describe('bookingPublicRateLimitResponses', () => {
  it('returns 429 with RATE_LIMIT_EXCEEDED nested error shape', async () => {
    const req = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-real-ip': '198.51.100.99' },
    });
    gatePublicBookingRoute(req, 'branches');
    const { blocked } = gatePublicBookingRoute(req, 'branches');
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    const body = await blocked!.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.message).toBe(PUBLIC_BOOKING_ERROR_CATALOG.RATE_LIMIT_EXCEEDED.messageAr);
    expect(body.error.technicalMessage).toBe(
      PUBLIC_BOOKING_ERROR_CATALOG.RATE_LIMIT_EXCEEDED.messageEn,
    );
  });

  it('sets Retry-After and X-RateLimit-* headers on block', async () => {
    const req = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-real-ip': '198.51.100.100' },
    });
    gatePublicBookingRoute(req, 'branches');
    const { blocked } = gatePublicBookingRoute(req, 'branches');
    expect(blocked!.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(blocked!.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked!.headers.get('X-Request-Id')).toMatch(/^pb-/);
    expect(blocked!.headers.get('X-Booking-Contract-Version')).toBe('booking-public-v1');
  });
});
