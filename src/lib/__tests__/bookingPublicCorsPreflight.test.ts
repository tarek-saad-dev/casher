/** Phase 7C1 — CORS preflight focused suite. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
  resetPublicBookingCorsCacheForTests,
} from '@/lib/booking/publicBookingCors';

beforeEach(() => resetPublicBookingCorsCacheForTests());

describe('bookingPublicCorsPreflight', () => {
  it('create OPTIONS allows Idempotency-Key for approved origin', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('http://localhost/api/public/booking/create', {
      method: 'OPTIONS',
      headers: { Origin: 'https://cutsaloon.com' },
    });
    const res = publicBookingOptionsResponse({
      request: req,
      allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.create.methods],
      allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
      environment: env,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key');
  });
});
