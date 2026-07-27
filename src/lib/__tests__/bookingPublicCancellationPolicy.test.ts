/** Phase 7B — cancellation policy unit cases. */
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  resolvePublicCancellationCutoff,
  PUBLIC_CANCELLATION_CUTOFF_MINUTES,
} from '@/lib/booking/publicBookingCancellationPolicy';

describe('bookingPublicCancellationPolicy', () => {
  it('uses shared 30-minute cutoff', () => {
    expect(PUBLIC_CANCELLATION_CUTOFF_MINUTES).toBe(30);
    const far = new Date(Date.now() + 2 * 3600_000).toISOString();
    expect(
      resolvePublicCancellationCutoff({
        statusRaw: 'confirmed',
        absoluteStartUtc: far,
        dateSource: 'canonical',
      }).windowOpen,
    ).toBe(true);
  });
});
