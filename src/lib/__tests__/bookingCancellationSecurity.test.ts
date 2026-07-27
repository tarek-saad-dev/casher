/** Phase 7B — security contract markers. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationSecurity', () => {
  it('routes reject BookingID and use generic unauthorized', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '../../../src/app/api/public/booking/cancel/route.ts'),
      'utf8',
    );
    const svc = fs.readFileSync(
      path.join(__dirname, '../booking/publicBookingCancellation.ts'),
      'utf8',
    );
    expect(route).toContain('numeric_booking_id_rejected');
    expect(svc).toContain('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  });
});
