import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BookingCreateLockError } from '@/lib/booking/publicBookingCreateLocks';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import { bridgeAcquireEmpIntervalLock } from '@/lib/booking/schedulingPortLegacyBridge';

const rescheduleOpsBooking = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ UserID: 13 })),
}));

vi.mock('@/apps/booking/public', () => ({
  isBookingSchedulingPortEnabled: () => true,
  rescheduleOpsBooking: (...args: unknown[]) => rescheduleOpsBooking(...args),
}));

vi.mock('@/lib/bookingSchedulingComposition', () => ({
  buildStaffActorContext: vi.fn(async () => ({ actorId: '13' })),
  buildSchedulingPortHooksForActor: vi.fn(async () => ({})),
}));

vi.mock('@/lib/bookingRescheduleCore', () => ({
  rescheduleBookingMove: vi.fn(),
}));

vi.mock('@/lib/scheduleIntegrity', () => ({
  ScheduleConflictError: class ScheduleConflictError extends Error {
    code = 'SCHEDULE_CONFLICT';
    conflict?: unknown;
    constructor(message: string) {
      super(message);
      this.name = 'ScheduleConflictError';
    }
  },
}));

import { PATCH } from '@/app/api/operations/bookings/[id]/reschedule/route';

describe('workforce lock timeout mapping', () => {
  it('maps WORKFORCE_OCCUPANCY_LOCK_TIMEOUT to catalog code BOOKING_LOCK_TIMEOUT', async () => {
    const err = await bridgeAcquireEmpIntervalLock(
      {
        schedulingPortHooks: {
          acquireEmpIntervalLock: async () => {
            throw new Error('WORKFORCE_OCCUPANCY_LOCK_TIMEOUT');
          },
        } as never,
      },
      {} as never,
      5,
      1,
      2,
    ).catch((caught) => caught);

    expect(err).toBeInstanceOf(BookingCreateLockError);
    expect(err.code).toBe('BOOKING_LOCK_TIMEOUT');
    expect(PUBLIC_BOOKING_ERROR_CATALOG[err.code].httpStatus).toBe(409);
  });

  it('staff reschedule returns 409 BOOKING_LOCK_TIMEOUT', async () => {
    rescheduleOpsBooking.mockRejectedValueOnce(new BookingCreateLockError('BOOKING_LOCK_TIMEOUT'));

    const res = await PATCH(
      new NextRequest('http://localhost/api/operations/bookings/1798/reschedule', {
        method: 'PATCH',
        body: JSON.stringify({
          newStartAt: '2026-07-21T20:00:00+03:00',
          operationalDate: '2026-07-21',
        }),
      }),
      { params: Promise.resolve({ id: '1798' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      code: 'BOOKING_LOCK_TIMEOUT',
      message: PUBLIC_BOOKING_ERROR_CATALOG.BOOKING_LOCK_TIMEOUT.messageAr,
    });
  });
});
