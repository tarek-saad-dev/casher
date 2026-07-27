/** Booking Phase 7C2 — centralized rate-limit policy matrix. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import {
  PUBLIC_BOOKING_ROUTE_RATE_FAMILY,
  getPublicBookingRateLimitPolicy,
  digestPublicBookingRateSubject,
  buildPublicBookingRateLimitKey,
  checkPublicBookingRateLimit,
  resetPublicBookingRateLimitsForTests,
  getRateLimitStorageKind,
} from '@/lib/booking/publicBookingRateLimitPolicy';

beforeEach(() => resetPublicBookingRateLimitsForTests());

describe('bookingPublicRateLimitPolicy', () => {
  it('maps route families to audited baseline limits', () => {
    expect(PUBLIC_BOOKING_ROUTE_RATE_FAMILY.create).toBe('create');
    expect(PUBLIC_BOOKING_ROUTE_RATE_FAMILY.cancel).toBe('cancel');
    expect(PUBLIC_BOOKING_ROUTE_RATE_FAMILY.upcoming).toBe('upcoming');
    expect(getPublicBookingRateLimitPolicy('create').limit).toBe(8);
    expect(getPublicBookingRateLimitPolicy('lookup').subjectAware).toBe(true);
    expect(getPublicBookingRateLimitPolicy('discovery').limit).toBe(60);
  });

  it('accepts bounded env overrides (1–500) and ignores invalid values', () => {
    expect(
      getPublicBookingRateLimitPolicy('create', { PUBLIC_BOOKING_RL_CREATE: '12' }).limit,
    ).toBe(12);
    expect(
      getPublicBookingRateLimitPolicy('create', { PUBLIC_BOOKING_RL_CREATE: '0' }).limit,
    ).toBe(8);
    expect(
      getPublicBookingRateLimitPolicy('create', { PUBLIC_BOOKING_RL_CREATE: '999' }).limit,
    ).toBe(8);
    expect(
      getPublicBookingRateLimitPolicy('create', { PUBLIC_BOOKING_RL_CREATE: 'nope' }).limit,
    ).toBe(8);
  });

  it('builds subject-aware keys with one-way digest', () => {
    const digest = digestPublicBookingRateSubject('phone', '01012345678');
    expect(digest).toHaveLength(16);
    expect(digestPublicBookingRateSubject('phone', '   ')).toBeNull();
    const key = buildPublicBookingRateLimitKey({
      family: 'lookup',
      clientIp: '1.2.3.4',
      subjectDigest: digest,
      policy: getPublicBookingRateLimitPolicy('lookup'),
    });
    expect(key).toContain('lookup');
    expect(key).toContain(digest!);
    expect(key).not.toContain('01012345678');
  });

  it('enforces per-IP limits in-memory', () => {
    const env = { PUBLIC_BOOKING_RL_DISCOVERY: '2' };
    const ip = '203.0.113.10';
    expect(checkPublicBookingRateLimit({ family: 'discovery', clientIp: ip, env }).allowed).toBe(
      true,
    );
    expect(checkPublicBookingRateLimit({ family: 'discovery', clientIp: ip, env }).allowed).toBe(
      true,
    );
    const blocked = checkPublicBookingRateLimit({ family: 'discovery', clientIp: ip, env });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('uses in-memory storage kind', () => {
    expect(getRateLimitStorageKind()).toBe('in-memory');
  });

  it('resolves IP from request for rate limiting', async () => {
    const { resolveRateLimitFromRequest } = await import(
      '@/lib/booking/publicBookingRateLimitPolicy'
    );
    process.env.PUBLIC_BOOKING_RL_DISCOVERY = '2';
    const req = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-real-ip': '198.51.100.22' },
    });
    resetPublicBookingRateLimitsForTests();
    const first = resolveRateLimitFromRequest(req, 'discovery');
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(2);
  });
});
