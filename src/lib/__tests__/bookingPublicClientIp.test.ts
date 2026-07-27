/** Booking Phase 7C2 — trusted client IP resolution. */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { resolvePublicBookingClientIp } from '@/lib/booking/publicBookingClientIp';

describe('bookingPublicClientIp', () => {
  it('prefers x-real-ip when valid', () => {
    const req = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '1.2.3.4' },
    });
    expect(resolvePublicBookingClientIp(req)).toBe('198.51.100.1');
  });

  it('trusts first x-forwarded-for hop on production/Vercel', () => {
    const req = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(
      resolvePublicBookingClientIp(req, { NODE_ENV: 'production' }),
    ).toBe('203.0.113.5');
    expect(
      resolvePublicBookingClientIp(req, { VERCEL: '1' }),
    ).toBe('203.0.113.5');
  });

  it('in dev only trusts single-hop x-forwarded-for', () => {
    const single = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-forwarded-for': '192.0.2.44' },
    });
    expect(
      resolvePublicBookingClientIp(single, { NODE_ENV: 'development' }),
    ).toBe('192.0.2.44');

    const multi = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-forwarded-for': '192.0.2.44, 10.0.0.1' },
    });
    expect(
      resolvePublicBookingClientIp(multi, { NODE_ENV: 'development' }),
    ).toBe('anonymous');
  });

  it('returns anonymous for missing/invalid headers', () => {
    const req = new NextRequest('http://localhost/api/public/branches');
    expect(resolvePublicBookingClientIp(req)).toBe('anonymous');
    const bad = new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-real-ip': 'not-an-ip' },
    });
    expect(resolvePublicBookingClientIp(bad)).toBe('anonymous');
  });
});
