/** Phase 7C1 — CORS error response focused suite. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
import {
  publicBookingJson,
  resetPublicBookingCorsCacheForTests,
} from '@/lib/booking/publicBookingCors';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';

beforeEach(() => resetPublicBookingCorsCacheForTests());

describe('bookingPublicCorsErrors', () => {
  it('error responses include ACAO for allowed origin', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    const req = new NextRequest('http://localhost/api/public/booking/services', {
      headers: { Origin: 'https://cutsaloon.com' },
    });
    // Inject env via publicBookingJson path
    const res = publicBookingJson(
      req,
      { ok: false },
      { status: 400, allowedMethods: ['GET', 'OPTIONS'], environment: env },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://cutsaloon.com');

    const err = publicBookingErrorResponse('BRANCH_REQUIRED', undefined, req, {
      allowedMethods: ['GET', 'OPTIONS'],
    });
    // Without env override, process NODE_ENV=test uses dev defaults — must never wildcard.
    expect(err.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });
});
