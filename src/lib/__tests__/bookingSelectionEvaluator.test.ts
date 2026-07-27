/**
 * Booking Phase 5 — selection evaluator / check-slot / plan contracts.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  BOOKING_PLAN_CONTRACT_VERSION,
  buildPlanContentDigest,
  mintPlanFingerprint,
  verifyPlanToken,
} from '@/lib/booking/publicBookingPlanFingerprint';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import {
  assertCheckSlotPlanParity,
  PublicBookingSelectionError,
} from '@/lib/booking/publicBookingSelectionEvaluator';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const fingerprintInput = {
  contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
  branchCode: 'GLEEM',
  serviceIds: [9, 15],
  mode: 'specific_barber' as const,
  empId: 12,
  workDate: '2026-08-01',
  time: '23:45',
  dayOffset: 0 as const,
  totalDurationMinutes: 50,
  subtotal: 350,
};

describe('bookingSelectionEvaluator', () => {
  const src = read('src/lib/booking/publicBookingSelectionEvaluator.ts');

  it('exports evaluatePublicBookingSelection with Phase-5 purposes', () => {
    expect(src).toContain("purpose: PublicSelectionPurpose");
    expect(src).toContain("'check_slot'");
    expect(src).toContain("'plan'");
    expect(src).toContain("'create_precheck'");
    expect(src).toContain('resolveSelectedBookingServices');
    expect(src).toContain('resolvePublicBookingBranchContext');
    expect(src).toContain("'public_booking'");
  });

  it('uses strong_fresh evaluation and never Phase-4 slot cache', () => {
    expect(src).toContain("evaluationMode: 'strong_fresh'");
    expect(src).not.toContain('getPublicAvailableSlots');
    expect(src).not.toContain('getPublicAvailableDays');
    expect(src).not.toContain('cacheGet');
    expect(src).toContain('durationOverride');
    expect(src).toContain('collectAllCandidates');
  });

  it('rejects employee/system duration fallbacks and client price/duration', () => {
    expect(src).not.toContain('calculateServicePlanDuration');
    expect(src).not.toContain('defaultServiceDurationMinutes');
    expect(src).not.toMatch(/ISNULL\(.*DurationMinutes/i);
  });

  it('supports specific and any-barber assignment strategies', () => {
    expect(src).toContain('fixed_barber');
    expect(src).toContain('server_select_on_create');
    expect(src).toContain('INVALID_DAY_OFFSET');
    expect(src).toContain('assertCheckSlotPlanParity');
  });
});

describe('bookingCheckSlot', () => {
  const route = read('src/app/api/public/booking/check-slot/route.ts');

  it('uses canonical evaluator; no legacy branch fallback', () => {
    expect(route).toContain('evaluatePublicBookingSelection');
    expect(route).toContain("purpose: 'check_slot'");
    expect(route).not.toContain('resolvePublicBranchCode');
    expect(route).not.toContain('validateBookingSlot');
    expect(route).toMatch(/OPTIONS/);
    expect(route).toContain('publicBookingOptionsResponse');
  });

  it('keeps HTTP 200 for business unavailability compatibility', () => {
    expect(route).toContain('available: false');
    expect(route).toContain('status: 200');
    expect(route).toContain('publicBookingErrorResponse');
  });

  it('ignores client BranchID/price/duration/preview drivers', () => {
    expect(route).toContain('void body.BranchID');
    expect(route).toContain('void body.price');
    expect(route).toContain('void body.duration');
    expect(route).toContain('previewQueryParam');
  });
});

describe('bookingPlan', () => {
  const route = read('src/app/api/public/booking/plan/route.ts');

  it('is read-only plan — no INSERT / customer upsert / write-guard', () => {
    expect(route).toContain('evaluatePublicBookingSelection');
    expect(route).toContain("purpose: 'plan'");
    expect(route).not.toMatch(/INSERT\s+INTO/i);
    expect(route).not.toContain('upsertCustomer');
    expect(route).not.toContain('assertEmployeeIntervalAvailable');
    expect(route).not.toContain('resolvePublicBranchCode');
    expect(route).toContain('planFingerprint');
    expect(route).toContain('BOOKING_PLAN_UNAVAILABLE');
  });

  it('OPTIONS + CORS present', () => {
    expect(route).toMatch(/OPTIONS/);
    expect(route).toContain('publicBookingOptionsResponse');
    expect(route).toContain('PUBLIC_BOOKING_ROUTE_CORS');
  });
});

describe('bookingPlanSpecificBarber / anyBarber / overnight / security', () => {
  const evalSrc = read('src/lib/booking/publicBookingSelectionEvaluator.ts');
  const check = read('src/app/api/public/booking/check-slot/route.ts');
  const plan = read('src/app/api/public/booking/plan/route.ts');

  it('specific barber classifies leave / transfer / non-public location', () => {
    expect(evalSrc).toContain('classifySpecificBarberDay');
    expect(evalSrc).toContain('BARBER_DAY_OFF');
    expect(evalSrc).toContain('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
    expect(evalSrc).toContain('not_available_publicly');
    expect(evalSrc).toContain('isEmployeeHiddenFromPublicBooking');
  });

  it('any-barber returns candidates without permanent assignment', () => {
    expect(evalSrc).toContain('server_select_on_create');
    expect(evalSrc).toContain('candidateBarbers');
    expect(evalSrc).toContain('sortCandidates');
    expect(plan).toContain('candidateBarbers');
    expect(plan).toContain('barber:');
  });

  it('overnight dayOffset required and validated', () => {
    expect(evalSrc).toContain('parseDayOffset');
    expect(evalSrc).toContain('expectedDayOffset');
    expect(evalSrc).toContain('INVALID_DAY_OFFSET');
  });

  it('security: no BranchID exposure; Camp Caesar preview blocked', () => {
    expect(plan).not.toContain('branchId');
    expect(check).not.toMatch(/BranchID:\s/);
    expect(evalSrc).toContain("previewQueryParam");
    expect(evalSrc).toContain('BRANCH_NOT_PUBLIC');
    for (const code of [
      'BRANCH_REQUIRED',
      'BRANCH_NOT_FOUND',
      'BRANCH_NOT_PUBLIC',
      'INVALID_TIME',
      'INVALID_DAY_OFFSET',
      'CHECK_SLOT_UNAVAILABLE',
      'BOOKING_PLAN_UNAVAILABLE',
      'BOOKING_PLAN_GENERATION_FAILED',
      'PLAN_CHECK_SLOT_MISMATCH',
    ] as const) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code]).toBeTruthy();
    }
  });
});

describe('bookingPlanFingerprint', () => {
  it('is deterministic for equivalent normalized input', () => {
    const a = buildPlanContentDigest(fingerprintInput);
    const b = buildPlanContentDigest(fingerprintInput);
    expect(a).toBe(b);
  });

  it('changes when services or time change', () => {
    const base = buildPlanContentDigest(fingerprintInput);
    const svc = buildPlanContentDigest({ ...fingerprintInput, serviceIds: [9] });
    const time = buildPlanContentDigest({ ...fingerprintInput, time: '22:00' });
    expect(svc).not.toBe(base);
    expect(time).not.toBe(base);
  });

  it('mints signed short-lived token verifiable with SESSION_SECRET', () => {
    const minted = mintPlanFingerprint(fingerprintInput, '2026-07-27T00:00:00.000Z');
    expect(minted.planFingerprint).toBe(buildPlanContentDigest(fingerprintInput));
    const ok = verifyPlanToken(minted.planToken);
    expect(ok.ok).toBe(true);
    const bad = verifyPlanToken(minted.planToken + 'x');
    expect(bad.ok).toBe(false);
  });
});

describe('bookingCheckSlotPlanParity', () => {
  it('throws PLAN_CHECK_SLOT_MISMATCH when available drifts', () => {
    const base = {
      branchContext: { branchCode: 'GLEEM' },
      mode: 'specific_barber',
      workDate: '2026-08-01',
      requestedTime: '10:00',
      requestedDayOffset: 0,
      totalDurationMinutes: 30,
      subtotal: 200,
      availabilityCode: null,
      selectedServices: [{ serviceId: 9 }],
      specificBarber: { empId: 12 },
      candidateBarbers: [],
      available: true,
      startDateTime: 'a',
      endDateTime: 'b',
    } as never;

    expect(() =>
      assertCheckSlotPlanParity(
        { ...base, available: false, availabilityCode: 'SLOT_UNAVAILABLE' } as never,
        { ...base, available: true } as never,
      ),
    ).toThrow(PublicBookingSelectionError);
  });
});

describe('bookingPlanPerformanceContract', () => {
  const evalSrc = read('src/lib/booking/publicBookingSelectionEvaluator.ts');

  it('evaluates one date — no available-days horizon loop', () => {
    expect(evalSrc).not.toContain('getPublicAvailableDays');
    expect(evalSrc).not.toContain('eachDateInclusive');
    expect(evalSrc).toContain('listAvailableBookingSlots');
    expect(evalSrc).toContain('strong_fresh');
  });

  it('does not accept Phase-4 cache for final busy state', () => {
    const avail = read('src/lib/booking/publicBookingAvailability.ts');
    expect(avail).toContain('CACHE_TTL_MS');
    expect(evalSrc).not.toContain('invalidatePublicBookingAvailabilityCache');
    expect(evalSrc).not.toMatch(/cacheGet|cacheSet/);
  });
});
