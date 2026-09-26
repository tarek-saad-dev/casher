/**
 * Source-level guard: V2 range rebuild must never collapse asOf to range.to.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Booking V2 asOfDate caller guard', () => {
  it('full DB + hot rebuild use per-business-date asOf helpers', () => {
    const root = join(__dirname, '..', 'booking');
    const live = readFileSync(
      join(root, 'projection', 'resolveBookingAvailabilityV2Live.ts'),
      'utf8',
    );
    const rebuild = readFileSync(
      join(root, 'cache', 'rebuildHotPayloadsForMissKeys.ts'),
      'utf8',
    );
    const batch = readFileSync(
      join(root, 'projection', 'loadWeeklyBaselineBatch.ts'),
      'utf8',
    );

    expect(live).toContain('buildWeeklyBaselineKeysForBusinessDates');
    expect(live).not.toMatch(/asOfDate\s*=\s*args\.businessDateRange\.to/);
    expect(rebuild).toContain('buildWeeklyBaselineKeysForBusinessDates');
    expect(rebuild).not.toMatch(/const asOfDate = to/);
    // Batch loader must not collapse to max asOf for SQL evaluation.
    expect(batch).not.toMatch(/asOfDates\.sort\(\)\.at\(-1\)/);
    expect(batch).toContain('pickLatestEffectiveRow');
  });
});
