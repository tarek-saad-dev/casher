/** Phase 7C1 — CORS security focused suite. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  resolvePublicBookingCorsPolicy,
  resetPublicBookingCorsCacheForTests,
} from '@/lib/booking/publicBookingCors';

beforeEach(() => resetPublicBookingCorsCacheForTests());

describe('bookingPublicCorsSecurity', () => {
  it('rejects null origin, evil subdomain, and custom port unless configured', () => {
    const env = {
      NODE_ENV: 'production',
      PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
    };
    expect(
      resolvePublicBookingCorsPolicy({ requestOrigin: 'null', environment: env }).kind,
    ).toBe('disallowed');
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'https://cutsaloon.com.evil.com',
        environment: env,
      }).kind,
    ).toBe('disallowed');
    expect(
      resolvePublicBookingCorsPolicy({
        requestOrigin: 'https://cutsaloon.com:444',
        environment: env,
      }).kind,
    ).toBe('disallowed');
  });
});
