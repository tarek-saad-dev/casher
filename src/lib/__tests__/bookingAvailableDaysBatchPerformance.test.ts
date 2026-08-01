/**
 * Phase 7C2+ — available-days uses bounded parallel summary path (not full slot grids).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingAvailableDaysBatchPerformance', () => {
  it('uses mapPool + summary-only preloaded slots (not per-day getPublicAvailableSlots)', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
      'utf8',
    );
    expect(src).toContain('listSlotsForPreloadedContext');
    expect(src).toContain('buildAvailableDayWire');
    expect(src).toContain('summaryOnly: true');
    expect(src).toContain('maxAvailableSlots');
    expect(src).toContain('DAYS_CACHE_TTL_MS');
    expect(src).toContain('mapPool');
    expect(src).not.toMatch(
      /getPublicAvailableDays[\s\S]*?for \(const date of eachDateInclusive[\s\S]*?getPublicAvailableSlots/,
    );
  });

  it('engine supports early-exit maxAvailableSlots and skips future public queue', () => {
    const eng = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
      'utf8',
    );
    expect(eng).toContain('maxAvailableSlots');
    expect(eng).toContain('source === \'public\' && date > todayBusinessDate');
  });
});
