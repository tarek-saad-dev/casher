/** Phase 10C — cross-branch barber availability contracts. */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

describe('bookingPhase10cCrossBranchAvailability', () => {
  const route = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/public/booking/barbers/[empId]/cross-branch-availability/route.ts',
    ),
    'utf8',
  );
  const domain = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingCrossBranchAvailability.ts'),
    'utf8',
  );
  const cors = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingCors.ts'),
    'utf8',
  );
  const rate = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingRateLimitPolicy.ts'),
    'utf8',
  );
  const avail = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
    'utf8',
  );

  it('exposes POST route with gate/CORS/finalize pattern', () => {
    expect(route).toContain("gatePublicBookingRoute(req, 'cross-branch-availability')");
    expect(route).toContain("PUBLIC_BOOKING_ROUTE_CORS['cross-branch-availability']");
    expect(route).toContain('getPublicCrossBranchBarberAvailability');
    expect(route).toContain('finalizePublicBookingJson');
    expect(route).toContain('finalizePublicBookingError');
    expect(route).toContain('export async function POST');
    expect(route).toContain('export async function OPTIONS');
  });

  it('registers CORS POST + rate-limit availability family', () => {
    expect(cors).toContain("'cross-branch-availability'");
    expect(cors).toContain("methods: ['POST', 'OPTIONS']");
    expect(rate).toContain("'cross-branch-availability': 'availability'");
  });

  it('limits days/services and preserves overnight dayOffset', () => {
    expect(domain).toContain('MAX_CROSS_BRANCH_AVAILABILITY_DAYS = 14');
    expect(domain).toContain('MAX_CROSS_BRANCH_AVAILABILITY_SERVICES = 12');
    expect(domain).toContain('dayOffset');
    const engine = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
      'utf8',
    );
    expect(engine).toContain('listSpecificEmpPublicSlotsMultiDate');
    expect(engine).toContain('PUBLIC_OVERNIGHT_SLOTS_LIMIT');
  });

  it('evaluates branches in parallel and isolates failures', () => {
    expect(domain).toContain('Promise.all');
    expect(domain).toContain('failed: true');
    expect(domain).toContain('failedBranchCodes');
    expect(domain).toContain('one failure must not invent slots');
  });

  it('batches eligibility/schedules and avoids BranchID on wire', () => {
    expect(domain).toContain('loadBookableAssignmentsInWindow');
    expect(domain).toContain('loadScheduleWorkingHints');
    expect(domain).toContain('PUBLIC_LIVE');
    expect(domain).toContain('listSpecificEmpPublicSlotsMultiDate');
    expect(domain).toContain('branchCode');
    expect(domain).toContain('branchName');
    expect(domain).toContain('export type PublicCrossBranchSlotWire');
    expect(domain).toMatch(
      /export type PublicCrossBranchSlotWire = \{[^}]*branchCode[^}]*branchName[^}]*date[^}]*time[^}]*dayOffset/,
    );
    expect(domain).not.toMatch(
      /export type PublicCrossBranchSlotWire = \{[^}]*branchId/,
    );
    expect(domain).toContain('queryCount');
    expect(domain).toContain('timingMs');
  });

  it('stable-sorts by date/time/branch and uses short cache + invalidation', () => {
    expect(domain).toContain('a.date.localeCompare(b.date)');
    expect(domain).toContain('a.time.localeCompare(b.time)');
    expect(domain).toContain('a.branchCode.localeCompare(b.branchCode)');
    expect(domain).toContain('CACHE_TTL_MS = 8_000');
    expect(domain).toContain('invalidatePublicBookingCrossBranchAvailabilityCache');
    expect(avail).toContain('invalidatePublicBookingCrossBranchAvailabilityCache');
  });

  it('exports contract version and limits constants', () => {
    expect(domain).toContain("CROSS_BRANCH_AVAILABILITY_CONTRACT = 'xbranch-v1'");
    expect(domain).toMatch(/export const MAX_CROSS_BRANCH_AVAILABILITY_DAYS = 14/);
    expect(domain).toMatch(/export const MAX_CROSS_BRANCH_AVAILABILITY_SERVICES = 12/);
  });
});
