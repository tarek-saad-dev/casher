/** Phase 7C1 — CORS route matrix focused suite. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PUBLIC_BOOKING_ROUTE_CORS } from '@/lib/booking/publicBookingCors';

describe('bookingPublicCorsRouteMatrix', () => {
  it('matrix covers all public booking families', () => {
    for (const key of [
      'branches',
      'config',
      'status',
      'services',
      'barbers',
      'calendar',
      'location',
      'barber-available-slots',
      'available-days',
      'available-slots',
      'check-slot',
      'plan',
      'create',
      'lookup',
      'upcoming',
      'cancel',
      'cancel-by-code',
    ]) {
      expect(PUBLIC_BOOKING_ROUTE_CORS[key]).toBeTruthy();
    }
    const create = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/create/route.ts'),
      'utf8',
    );
    expect(create).toContain("PUBLIC_BOOKING_ROUTE_CORS['create']");
  });
});
