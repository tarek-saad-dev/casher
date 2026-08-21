/**
 * Booking V2 Phase B7B — staged read cutover (flags, canary, contracts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveBookingV2ReadMode,
  resolveBookingV2ReadDecision,
  bookingV2CanaryBucket,
  buildBookingV2CanaryKey,
  recordBookingV2ReadMetric,
  getBookingV2ReadCutoverMetrics,
  __resetBookingV2ReadCutoverMetricsForTests,
  isBookingV2TechnicalFailure,
} from '@/lib/booking/projection/bookingV2ReadCutover';
import { mapV2DaysToPublicSlots } from '@/lib/booking/projection/bookingV2PublicWire';
import type { V2EmployeeDayAvailability } from '@/lib/booking/projection/resolveBookingAvailabilityV2';

describe('B7B READ MODE FLAGS', () => {
  it('defaults to shadow (legacy authoritative)', () => {
    expect(resolveBookingV2ReadMode({} as NodeJS.ProcessEnv)).toBe('shadow');
  });

  it('kill switch legacy disables V2 serve + shadow', () => {
    const d = resolveBookingV2ReadDecision({
      env: { BOOKING_V2_READ_MODE: 'legacy' } as NodeJS.ProcessEnv,
      canaryKey: 'x',
    });
    expect(d.serveV2).toBe(false);
    expect(d.forwardShadow).toBe(false);
    expect(d.reverseShadow).toBe(false);
    expect(d.reason).toContain('kill_switch');
  });

  it('v2 mode serves V2 with reverse shadow', () => {
    const d = resolveBookingV2ReadDecision({
      env: { BOOKING_V2_READ_MODE: 'v2' } as NodeJS.ProcessEnv,
    });
    expect(d.serveV2).toBe(true);
    expect(d.reverseShadow).toBe(true);
    expect(d.forwardShadow).toBe(false);
  });
});

describe('DETERMINISTIC CANARY', () => {
  it('same key always same bucket', () => {
    const k = buildBookingV2CanaryKey({ clientId: 'cutsaloon-user-42' });
    expect(bookingV2CanaryBucket(k)).toBe(bookingV2CanaryBucket(k));
  });

  it('sticky assignment does not flip for same client', () => {
    const env = {
      BOOKING_V2_READ_MODE: 'canary',
      BOOKING_V2_READ_CANARY_PERCENT: '10',
    } as NodeJS.ProcessEnv;
    const key = 'sticky-client-abc';
    const a = resolveBookingV2ReadDecision({ env, canaryKey: key });
    const b = resolveBookingV2ReadDecision({ env, canaryKey: key });
    expect(a.serveV2).toBe(b.serveV2);
    expect(a.canaryBucket).toBe(b.canaryBucket);
  });

  it('respects canary percent boundary', () => {
    const env = {
      BOOKING_V2_READ_MODE: 'canary',
      BOOKING_V2_READ_CANARY_PERCENT: '0',
    } as NodeJS.ProcessEnv;
    expect(
      resolveBookingV2ReadDecision({ env, canaryKey: 'anyone' }).serveV2,
    ).toBe(false);
    const env100 = {
      BOOKING_V2_READ_MODE: 'canary',
      BOOKING_V2_READ_CANARY_PERCENT: '100',
    } as NodeJS.ProcessEnv;
    expect(
      resolveBookingV2ReadDecision({ env: env100, canaryKey: 'anyone' }).serveV2,
    ).toBe(true);
  });
});

describe('FALLBACK + METRICS', () => {
  it('does not treat PublicBookingAvailabilityError as technical fallback', () => {
    const err = Object.assign(new Error('BARBER_NOT_FOUND'), {
      name: 'PublicBookingAvailabilityError',
      code: 'BARBER_NOT_FOUND',
    });
    expect(isBookingV2TechnicalFailure(err)).toBe(false);
    expect(isBookingV2TechnicalFailure(new Error('ECONNRESET'))).toBe(true);
  });

  it('records per-engine metrics including fallbacks', () => {
    __resetBookingV2ReadCutoverMetricsForTests();
    recordBookingV2ReadMetric({
      engine: 'legacy',
      ok: true,
      totalMs: 100,
      slotCount: 5,
    });
    recordBookingV2ReadMetric({
      engine: 'v2',
      ok: false,
      fallback: true,
    });
    const m = getBookingV2ReadCutoverMetrics();
    expect(m.legacy.requestCount).toBe(1);
    expect(m.v2.fallbackCount).toBe(1);
  });
});

describe('PUBLIC CONTRACT MAPPING', () => {
  it('maps V2 starts to PublicSlotWire with barbers array', () => {
    const day: V2EmployeeDayAvailability = {
      employeeId: 5,
      branchId: 1,
      businessDate: '2026-08-17',
      availableStarts: [
        {
          startMin: 16 * 60,
          time: '16:00',
          dayOffset: 0,
          startAtMs: Date.parse('2026-08-17T13:00:00.000Z'),
        },
        {
          startMin: 24 * 60 + 30,
          time: '00:30',
          dayOffset: 1,
          startAtMs: Date.parse('2026-08-17T21:30:00.000Z'),
        },
      ],
      freeRanges: [],
      availabilityRevision: 'av:1:1:1:1',
      changeMask: [],
      reusedBaseline: true,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    };
    const slots = mapV2DaysToPublicSlots({
      days: [day],
      businessDate: '2026-08-17',
      durationMinutes: 30,
      namesByEmpId: new Map([[5, 'أحمد']]),
      empId: 5,
    });
    expect(slots).toHaveLength(2);
    expect(slots[0]!.barbers).toEqual([{ empId: 5, nameAr: 'أحمد' }]);
    expect(slots[0]!.time).toBe('16:00');
    expect(slots[1]!.dayOffset).toBe(1);
    expect(slots[0]!.startDateTime).toBeTruthy();
    expect(slots[0]!.endDateTime).toBeTruthy();
  });
});

describe('WRITE PATH UNCHANGED + HOOKS', () => {
  it('public routes pass canaryKey; create/hold not using READ_MODE', () => {
    const root = process.cwd();
    const slots = readFileSync(
      join(root, 'src/app/api/public/booking/available-slots/route.ts'),
      'utf8',
    );
    const days = readFileSync(
      join(root, 'src/app/api/public/booking/available-days/route.ts'),
      'utf8',
    );
    const pub = readFileSync(
      join(root, 'src/lib/booking/publicBookingAvailability.ts'),
      'utf8',
    );
    const create = readFileSync(
      join(root, 'src/lib/booking/publicBookingCreate.ts'),
      'utf8',
    );
    expect(slots).toContain('extractBookingV2CanaryKeyFromRequest');
    expect(days).toContain('extractBookingV2CanaryKeyFromRequest');
    expect(pub).toContain('logBookingV2ReadFallback');
    expect(pub).toContain('resolveBookingV2ReadDecision');
    expect(create).not.toContain('BOOKING_V2_READ_MODE');
    expect(create).not.toContain('resolveBookingV2ReadDecision');
  });
});
