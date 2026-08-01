/**
 * available-days uses ONE range preload (not N engines).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingAvailableDaysBatchPerformance', () => {
  it('getPublicAvailableDays uses summarizeAvailableDaysRange', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
      'utf8',
    );
    expect(src).toContain('summarizeAvailableDaysRange');
    expect(src).toContain('DAYS_CACHE_TTL_MS');
    expect(src).not.toMatch(
      /getPublicAvailableDays[\s\S]*?mapPool\(dateRange/,
    );
  });

  it('range engine batches day-offs, bookings, and windows', () => {
    const eng = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicAvailableDaysRange.ts'),
      'utf8',
    );
    expect(eng).toContain('export async function summarizeAvailableDaysRange');
    expect(eng).toContain('BookingDate BETWEEN');
    expect(eng).toContain('loadAttendanceExpandOverridesRange');
    expect(eng).toContain('break outer');
  });
});
