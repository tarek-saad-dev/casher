/**
 * Phase 1C — multi-branch barber availability days/slots contracts.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  buildBarberAvailabilitySlotId,
  humanizeBranchCode,
  sortBarberAvailabilitySlotsByAbsoluteStart,
  MAX_BARBER_AVAILABILITY_DAYS,
  MAX_BARBER_AVAILABILITY_SERVICES,
  BRANCH_EVAL_CONCURRENCY,
} from '@/lib/booking/publicBarberMultiBranchAvailabilityPure';

const read = (...parts: string[]) =>
  fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8');

describe('phase1c multi-branch barber availability — routes & wiring', () => {
  const daysRoute = read(
    'src/app/api/public/booking/barbers/[empId]/availability/days/route.ts',
  );
  const slotsRoute = read(
    'src/app/api/public/booking/barbers/[empId]/availability/slots/route.ts',
  );
  const domain = read('src/lib/booking/publicBarberMultiBranchAvailability.ts');
  const cors = read('src/lib/booking/publicBookingCors.ts');
  const rate = read('src/lib/booking/publicBookingRateLimitPolicy.ts');
  const health = read('src/lib/booking/publicBookingHealthMetrics.ts');
  const errors = read('src/lib/booking/publicBookingErrorCatalog.ts');
  const avail = read('src/lib/booking/publicBookingAvailability.ts');
  const planRoute = read('src/app/api/public/booking/plan/route.ts');
  const createRoute = read('src/app/api/public/booking/create/route.ts');
  const xbranch = read('src/lib/booking/publicBookingCrossBranchAvailability.ts');

  it('exposes POST days/slots routes with gate/CORS/finalize pattern', () => {
    expect(daysRoute).toContain("gatePublicBookingRoute(req, 'barber-availability-days')");
    expect(slotsRoute).toContain("gatePublicBookingRoute(req, 'barber-availability-slots')");
    expect(daysRoute).toContain('getBarberAvailabilityDays');
    expect(slotsRoute).toContain('getBarberAvailabilitySlots');
    expect(daysRoute).toContain('finalizePublicBookingJson');
    expect(slotsRoute).toContain('finalizePublicBookingError');
    expect(daysRoute).toContain('export async function POST');
    expect(slotsRoute).toContain('export async function OPTIONS');
  });

  it('registers CORS POST + rate-limit families', () => {
    expect(cors).toContain("'barber-availability-days'");
    expect(cors).toContain("'barber-availability-slots'");
    expect(rate).toContain("'barber-availability-days': 'available-days'");
    expect(rate).toContain("'barber-availability-slots': 'availability'");
    expect(health).toContain("'barber-availability-days'");
    expect(health).toContain("'barber-availability-slots'");
  });

  it('reuses AvailabilityEngine multi-date helper (no second scheduling engine)', () => {
    expect(domain).toContain('listSpecificEmpPublicSlotsMultiDate');
    expect(domain).toContain('resolveSelectedBookingServices');
    expect(domain).not.toMatch(/FROM dbo\.Bookings[\s\S]{0,200}busy/i);
    expect(domain).toContain('BRANCH_EVAL_CONCURRENCY');
    expect(BRANCH_EVAL_CONCURRENCY).toBe(2);
    expect(MAX_BARBER_AVAILABILITY_DAYS).toBe(31);
    expect(MAX_BARBER_AVAILABILITY_SERVICES).toBe(12);
  });

  it('supports all_public and specific_branch scopes with branchCode identity', () => {
    expect(domain).toContain("'all_public'");
    expect(domain).toContain("'specific_branch'");
    expect(domain).toContain('normalizePublicBranchCode');
    expect(domain).toContain('NO_PUBLIC_BRANCHES_FOR_BARBER');
    expect(domain).toContain('BARBER_NOT_ASSIGNED');
    expect(domain).toContain('BRANCH_REQUIRED');
  });

  it('returns partial warnings for branch failures; specific_branch fails hard', () => {
    expect(domain).toContain('BRANCH_AVAILABILITY_UNAVAILABLE');
    expect(domain).toContain('partial');
    expect(domain).toContain("failHard = common.scope === 'specific_branch'");
    expect(domain).toContain("failHard ? 'BRANCH_AVAILABILITY_UNAVAILABLE' : 'AVAILABILITY_UNAVAILABLE'");
    expect(errors).toContain('BRANCH_AVAILABILITY_UNAVAILABLE');
    expect(errors).toContain('INVALID_AVAILABILITY_SCOPE');
    expect(errors).toContain('BARBER_NOT_BOOKABLE');
    expect(errors).toContain('NO_PUBLIC_BRANCHES_FOR_BARBER');
  });

  it('preserves dayOffset, slotId identity, and absolute chronological sort', () => {
    expect(domain).toContain('dayOffset');
    expect(domain).toContain('buildBarberAvailabilitySlotId');
    expect(domain).toContain('sortBarberAvailabilitySlotsByAbsoluteStart');
    expect(domain).toContain('earliestDayOffset');
    expect(domain).toContain('hasOvernightSlots');
  });

  it('invalidates multi-branch cache with create/cancel availability invalidation', () => {
    expect(avail).toContain('invalidatePublicBarberMultiBranchAvailabilityCache');
    expect(domain).toContain('invalidatePublicBarberMultiBranchAvailabilityCache');
  });

  it('does not modify plan/create contracts', () => {
    expect(planRoute).toContain('evaluatePublicBookingSelection');
    expect(planRoute).toContain('planToken');
    expect(createRoute).toContain('createPublicBooking');
    expect(planRoute).not.toContain('getBarberAvailabilityDays');
    expect(createRoute).not.toContain('getBarberAvailabilitySlots');
    expect(planRoute).not.toContain('publicBarberMultiBranchAvailability');
    expect(createRoute).not.toContain('publicBarberMultiBranchAvailability');
  });

  it('keeps Phase 10C cross-branch endpoint intact', () => {
    expect(xbranch).toContain('getPublicCrossBranchBarberAvailability');
    expect(xbranch).toContain('CROSS_BRANCH_AVAILABILITY_CONTRACT');
  });

  it('documents public assignment filters (inactive / non-public excluded)', () => {
    expect(domain).toContain('CanReceiveBookings = 1');
    expect(domain).toContain('IsActive = 1');
    expect(domain).toContain("LifecycleStatus = N'PUBLIC_LIVE'");
    expect(domain).toContain('PublicBookingEnabled');
  });
});

describe('phase1c multi-branch barber availability — pure helpers', () => {
  it('builds stable slot identity including emp, branch, date, time, dayOffset', () => {
    expect(
      buildBarberAvailabilitySlotId({
        empId: 12,
        branchCode: 'GLEEM',
        date: '2026-08-06',
        time: '22:00',
        dayOffset: 0,
      }),
    ).toBe('12:GLEEM:2026-08-06:22:00:0');
    expect(
      buildBarberAvailabilitySlotId({
        empId: 12,
        branchCode: 'CAMP_CAESAR',
        date: '2026-08-06',
        time: '22:00',
        dayOffset: 0,
      }),
    ).toBe('12:CAMP_CAESAR:2026-08-06:22:00:0');
  });

  it('same clock time at two branches stays as two slots (no time-only dedupe)', () => {
    const sorted = sortBarberAvailabilitySlotsByAbsoluteStart([
      {
        startDateTime: '2026-08-06T19:00:00.000Z',
        branchCode: 'GLEEM',
        time: '22:00',
      },
      {
        startDateTime: '2026-08-06T19:00:00.000Z',
        branchCode: 'CAMP_CAESAR',
        time: '22:00',
      },
    ]);
    expect(sorted).toHaveLength(2);
    expect(sorted.map((s) => s.branchCode)).toEqual(['CAMP_CAESAR', 'GLEEM']);
  });

  it('sorts by absolute startDateTime so overnight follows evening', () => {
    const sorted = sortBarberAvailabilitySlotsByAbsoluteStart([
      {
        startDateTime: '2026-08-07T00:30:00.000Z',
        branchCode: 'GLEEM',
        time: '03:30',
        dayOffset: 1 as const,
      },
      {
        startDateTime: '2026-08-06T19:00:00.000Z',
        branchCode: 'GLEEM',
        time: '22:00',
        dayOffset: 0 as const,
      },
      {
        startDateTime: '2026-08-06T20:00:00.000Z',
        branchCode: 'CAMP_CAESAR',
        time: '23:00',
        dayOffset: 0 as const,
      },
    ]);
    expect(sorted.map((s) => s.time)).toEqual(['22:00', '23:00', '03:30']);
  });

  it('humanizes branch codes when English localization is missing', () => {
    expect(humanizeBranchCode('CAMP_CAESAR')).toBe('Camp Caesar');
    expect(humanizeBranchCode('GLEEM')).toBe('Gleem');
  });
});

describe('phase1c assignment resolution scenarios (contract expectations)', () => {
  const domain = read('src/lib/booking/publicBarberMultiBranchAvailability.ts');

  it('Ziad-style all_public can resolve multiple public assignment branches', () => {
    expect(domain).toContain('loadBookableAssignmentsInWindow');
    expect(domain).toContain('all_public');
    expect(domain).toContain('Promise.all');
  });

  it('specific_branch filters to one branchCode and rejects unassigned', () => {
    expect(domain).toContain("args.scope === 'specific_branch'");
    expect(domain).toContain('BARBER_NOT_ASSIGNED');
    expect(domain).toContain('BRANCH_NOT_PUBLIC');
  });

  it('rejects invalid services and barber service permission failures', () => {
    expect(domain).toContain('INVALID_SERVICE_IDS');
    expect(domain).toContain('validateEmployeeSupportsServices');
    expect(domain).toContain('BARBER_CANNOT_PERFORM_SERVICE');
  });

  it('preserves duration/price via plan-aligned resolveSelectedBookingServices', () => {
    expect(domain).toContain('durationOverride: selected.totalDurationMinutes');
    expect(domain).toContain('totalPrice');
    expect(domain).toContain('PUBLIC_BOOKING_CURRENCY');
  });

  it('returns every requested date in stable order for days endpoint', () => {
    expect(domain).toContain('dates.map((date) =>');
    expect(domain).toContain('available: branches.length > 0');
  });
});

describe('phase1c plan/create regression — source contracts unchanged', () => {
  it('plan still validates assignment, services, slot, price, dayOffset', () => {
    const evaluator = read('src/lib/booking/publicBookingSelectionEvaluator.ts');
    expect(evaluator).toContain('validateBookingSlot');
    expect(evaluator).toContain('resolveSelectedBookingServices');
    expect(evaluator).toContain('requestedDayOffset');
    expect(evaluator).toContain('classifySpecificBarberDay');
    expect(evaluator).toContain('subtotal');
  });

  it('create still uses plan token + idempotency', () => {
    const create = read('src/lib/booking/publicBookingCreate.ts');
    expect(create).toContain('planToken');
    expect(create).toContain('Idempotency');
    expect(create).toContain('evaluatePublicBookingSelection');
  });
});
