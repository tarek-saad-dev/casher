/** Phase 7C1 — CORS rate-limit focused suite. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
import {
  publicBookingRateLimitedResponse,
  resetPublicBookingCorsCacheForTests,
} from '@/lib/booking/publicBookingCors';

beforeEach(() => resetPublicBookingCorsCacheForTests());

describe('bookingPublicCorsRateLimit', () => {
  it('429 preserves ACAO for allowed origin', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('http://localhost/api/public/branches', {
      headers: { Origin: 'https://cutsaloon.com' },
    });
    const res = publicBookingRateLimitedResponse(req, {
      allowedMethods: ['GET', 'OPTIONS'],
      environment: env,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://cutsaloon.com');
    expect(res.headers.get('Vary')).toContain('Origin');
  });
});
