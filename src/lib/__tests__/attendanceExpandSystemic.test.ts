/**
 * Guard: booking/ops bookable windows must use loadBookingOverridesForDate
 * (ops closes + attendance early-in / late-out opens), not raw loadOverridesForDate.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '../..');

const BOOKING_OPS_PATHS = [
  'lib/bookingAvailabilityEngine.ts',
  'lib/availabilityEngine.ts',
  'lib/barberAvailability.ts',
  'lib/bookingRescheduleCore.ts',
  'lib/scheduleIntegrity.ts',
  'lib/operationsQueuePlanCore.ts',
  'app/api/public/booking/available-slots/route.ts',
  'app/api/public/booking/available-days/route.ts',
  'app/api/public/booking/plan/route.ts',
  'app/api/operations/flow-board/route.ts',
  'app/api/operations/schedule-control/route.ts',
];

describe('attendance expand is systemic in booking/ops', () => {
  it('booking/ops modules resolve windows via booking overrides helper or attendance merge', () => {
    for (const rel of BOOKING_OPS_PATHS) {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) continue;
      const src = fs.readFileSync(full, 'utf8');

      // Raw override loader alone is not enough for bookable windows
      const usesRawOnly =
        /loadOverridesForDate\s*\(/.test(src) &&
        !/loadBookingOverridesForDate|loadBookingOverridesForBarber|loadAttendanceExpandOverrides/.test(
          src,
        );

      expect(usesRawOnly, `${rel} still uses raw loadOverridesForDate without attendance expand`).toBe(
        false,
      );
    }
  });

  it('applyOverrides documents attendance expand widen-only', () => {
    const src = fs.readFileSync(path.join(root, 'lib/scheduleOverrides.ts'), 'utf8');
    expect(src).toContain('ATTENDANCE_SHIFT_OVERRIDE_SOURCE');
    expect(src).toContain('widen only');
  });
});
