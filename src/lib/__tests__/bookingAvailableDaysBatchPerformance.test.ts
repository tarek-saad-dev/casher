/**
 * Phase 7C2 — available-days uses parallel preloaded slot path (not per-day getPublicAvailableSlots).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingAvailableDaysBatchPerformance', () => {
  it('uses parallel Promise.all and preloaded listSlotsForPreloadedContext', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
      'utf8',
    );
    expect(src).toContain('listSlotsForPreloadedContext');
    expect(src).toContain('buildAvailableDayWire');
    expect(src).toContain('Promise.all');
    expect(src).not.toMatch(
      /getPublicAvailableDays[\s\S]*?for \(const date of eachDateInclusive[\s\S]*?getPublicAvailableSlots/,
    );
  });
});
