import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  assertCheckSlotPlanParity,
  PublicBookingSelectionError,
} from '@/lib/booking/publicBookingSelectionEvaluator';

function evalStub(over: Record<string, unknown> = {}) {
  return {
    branchContext: { branchCode: 'GLEEM' },
    mode: 'any_barber',
    workDate: '2026-08-01',
    requestedTime: '23:45',
    requestedDayOffset: 0,
    totalDurationMinutes: 30,
    subtotal: 200,
    availabilityCode: null,
    selectedServices: [{ serviceId: 9 }],
    specificBarber: null,
    candidateBarbers: [
      { empId: 12, nameAr: 'زياد' },
      { empId: 5, nameAr: 'أ' },
    ],
    available: true,
    startDateTime: '2026-08-01T21:45:00.000Z',
    endDateTime: '2026-08-01T22:15:00.000Z',
    ...over,
  } as never;
}

describe('bookingCheckSlotPlanParity', () => {
  it('passes when check and plan agree', () => {
    expect(() => assertCheckSlotPlanParity(evalStub(), evalStub())).not.toThrow();
  });

  it('fails when candidate sets differ', () => {
    expect(() =>
      assertCheckSlotPlanParity(
        evalStub(),
        evalStub({ candidateBarbers: [{ empId: 12, nameAr: 'زياد' }] }),
      ),
    ).toThrow(PublicBookingSelectionError);
  });

  it('fails when plan available but check is not', () => {
    try {
      assertCheckSlotPlanParity(
        evalStub({ available: false, availabilityCode: 'SLOT_UNAVAILABLE' }),
        evalStub({ available: true }),
      );
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PublicBookingSelectionError);
      expect((e as PublicBookingSelectionError).code).toBe('PLAN_CHECK_SLOT_MISMATCH');
    }
  });
});
