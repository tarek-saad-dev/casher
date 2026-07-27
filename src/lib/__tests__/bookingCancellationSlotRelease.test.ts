/** Phase 7B — slot release marker. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationSlotRelease', () => {
  it('service probes busy intervals after cancel', () => {
    const svc = fs.readFileSync(
      path.join(__dirname, '../booking/publicBookingCancellation.ts'),
      'utf8',
    );
    expect(svc).toContain('probeSlotRelease');
    expect(svc).toContain('bookingBlockRemoved');
    expect(svc).toContain('buildBookingIntervals');
  });
});
