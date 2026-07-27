/**
 * Booking Phase 4 — duration consistency + availability contracts (source + pure).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';
import { publicBookingErrorBody } from '@/lib/booking/publicBookingErrorCatalog';

describe('bookingAvailabilityDurationConsistency', () => {
  const dur = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/bookingServiceDuration.ts'),
    'utf8',
  );
  const avail = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
    'utf8',
  );

  it('uses Phase-2 catalog duration with no system/emp fallback in public resolver', () => {
    expect(dur).toContain('resolveSelectedBookingServices');
    expect(dur).toContain('getPublicBookingServicesCatalog');
    expect(dur).not.toContain('SYSTEM_DEFAULT');
    expect(dur).not.toContain('defaultServiceDuration');
    expect(avail).toContain('durationOverride: selected.totalDurationMinutes');
  });
});

describe('bookingAvailableDays / Slots routes', () => {
  const days = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/available-days/route.ts'),
    'utf8',
  );
  const slots = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/available-slots/route.ts'),
    'utf8',
  );
  const barberSlots = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/public/booking/barbers/[empId]/available-slots/route.ts',
    ),
    'utf8',
  );

  it('days/slots use central availability + nested errors; barber slots share getPublicAvailableSlots', () => {
    expect(days).toContain('getPublicAvailableDays');
    expect(slots).toContain('getPublicAvailableSlots');
    expect(barberSlots).toContain('getPublicAvailableSlots');
    expect(days).toContain('publicBookingErrorResponse');
    expect(days).not.toContain('resolvePublicBranchCode');
    expect(barberSlots).not.toContain('resolvePublicBranchCode');
  });

  it('OPTIONS/CORS and new error codes exist', () => {
    expect(days).toContain('OPTIONS');
    expect(slots).toContain('OPTIONS');
    expect(days).toContain('publicBookingOptionsResponse');
    expect(slots).toContain('PUBLIC_BOOKING_ROUTE_CORS');
    for (const code of [
      'NO_ELIGIBLE_BARBER',
      'AVAILABILITY_UNAVAILABLE',
      'BRANCH_REQUIRED',
      'SERVICE_NOT_AVAILABLE_AT_BRANCH',
    ] as const) {
      expect(publicBookingErrorBody(code).error.code).toBe(code);
    }
  });
});

describe('bookingOvernightSlots', () => {
  function at(h: number, m = 0, day = '2026-08-01'): number {
    return new Date(
      `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`,
    ).getTime();
  }

  it('45-min duration rejected when start would cross 01:30 close', () => {
    const shiftStart = at(13, 0);
    const shiftEnd = new Date('2026-08-02T01:30:00+03:00').getTime();
    const start = new Date('2026-08-02T01:00:00+03:00').getTime();
    const r = evaluateBookingSlotAt(start, 45, [], { shiftStartMs: shiftStart, shiftEndMs: shiftEnd });
    expect(r.available).toBe(false);
  });

  it('00:45 start with 45-min duration fits before 01:30', () => {
    const shiftStart = at(13, 0);
    const shiftEnd = new Date('2026-08-02T01:30:00+03:00').getTime();
    const start = new Date('2026-08-02T00:45:00+03:00').getTime();
    const r = evaluateBookingSlotAt(start, 45, [], { shiftStartMs: shiftStart, shiftEndMs: shiftEnd });
    expect(r.available).toBe(true);
    expect(r.slotEndMs).toBe(new Date('2026-08-02T01:30:00+03:00').getTime());
  });

  it('busy booking interval blocks overlapping overnight slot', () => {
    const start = new Date('2026-08-02T00:15:00+03:00').getTime();
    const busy = [
      {
        start: new Date('2026-08-02T00:00:00+03:00'),
        end: new Date('2026-08-02T00:30:00+03:00'),
        source: 'booking',
      },
    ];
    const r = evaluateBookingSlotAt(start, 30, busy, {
      shiftStartMs: at(13, 0),
      shiftEndMs: new Date('2026-08-02T01:30:00+03:00').getTime(),
    });
    expect(r.available).toBe(false);
    expect(r.reasonCode).toBe('booking_conflict');
  });
});

describe('bookingAvailabilitySecurity', () => {
  const avail = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
    'utf8',
  );
  it('rejects unlockers conceptually and hides non-public destinations', () => {
    expect(avail).toContain('not_available_publicly');
    expect(avail).toContain('previewQueryParam');
    expect(avail).toContain('BRANCH_REQUIRED');
    expect(avail).toContain('isEmployeeHiddenFromPublicBooking');
  });
});

describe('bookingAvailabilityCache / performance contract', () => {
  const avail = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
    'utf8',
  );
  it('bounded short TTL cache with invalidate', () => {
    expect(avail).toContain('CACHE_MAX = 48');
    expect(avail).toContain('CACHE_TTL_MS = 8_000');
    expect(avail).toContain('invalidatePublicBookingAvailabilityCache');
  });

  it('loads services once via resolveSelectedBookingServices before slot loops', () => {
    expect(avail).toContain('resolveSelectedBookingServices');
    expect(avail).toContain('durationOverride');
  });
});

describe('bookingAnyBarberAvailability / specific parity', () => {
  const avail = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
    'utf8',
  );
  const barberSlots = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/public/booking/barbers/[empId]/available-slots/route.ts',
    ),
    'utf8',
  );
  const slots = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/available-slots/route.ts'),
    'utf8',
  );

  it('any-barber merges candidates; both slot routes share getPublicAvailableSlots', () => {
    expect(avail).toContain('collectAllCandidates');
    expect(avail).toContain('mergeCandidateSlots');
    expect(avail).toContain('any_barber');
    expect(avail).toContain('specific_barber');
    expect(barberSlots).toContain('getPublicAvailableSlots');
    expect(slots).toContain('getPublicAvailableSlots');
  });
});

describe('bookingCalendarAvailability', () => {
  const lib = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
    'utf8',
  );
  it('enriches calendar when serviceIds provided', () => {
    expect(lib).toContain('enrichCalendarDayAvailability');
    expect(lib).toContain("presenceOnly: serviceIds.length === 0");
  });
});

describe('bookingBusyIntervals', () => {
  const engine = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
    'utf8',
  );
  it('uses queue + booking busy builders (global emp intervals)', () => {
    expect(engine).toContain('buildQueueIntervals');
    expect(engine).toContain('buildBookingIntervals');
    expect(engine).toContain('intervalsOverlap');
  });
});
