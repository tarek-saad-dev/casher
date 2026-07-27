/** Phase 7C1 — CORS normalization focused suite. */
import { describe, expect, it, beforeEach, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  normalizePublicBookingOrigin,
  resetPublicBookingCorsCacheForTests,
} from '@/lib/booking/publicBookingCors';

beforeEach(() => resetPublicBookingCorsCacheForTests());

describe('bookingPublicCorsNormalization', () => {
  it('exact origin equality only', () => {
    expect(normalizePublicBookingOrigin('https://cutsaloon.com/')).toBe('https://cutsaloon.com');
    expect(normalizePublicBookingOrigin('https://cutsaloon.com/path')).toBeNull();
    expect(normalizePublicBookingOrigin('https://evilcutsaloon.com')).not.toBe(
      'https://cutsaloon.com',
    );
  });
});
