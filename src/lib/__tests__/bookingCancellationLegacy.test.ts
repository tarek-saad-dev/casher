/** Phase 7B — legacy ambiguous cutoff policy. */
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { resolvePublicCancellationCutoff } from '@/lib/booking/publicBookingCancellationPolicy';

describe('bookingCancellationLegacy', () => {
  it('ambiguous start requires staff (window closed)', () => {
    const r = resolvePublicCancellationCutoff({
      statusRaw: 'confirmed',
      absoluteStartUtc: null,
      dateSource: 'ambiguous',
    });
    expect(r.reason).toBe('ambiguous_start');
    expect(r.windowOpen).toBe(false);
  });
});
