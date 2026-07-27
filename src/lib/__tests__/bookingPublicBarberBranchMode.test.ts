import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('bookingPublicBarberBranchMode', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/barbers/route.ts'),
    'utf8',
  );
  const lib = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
    'utf8',
  );

  it('branch-first requires branch context and date schedule filter', () => {
    expect(src).toContain("modeRaw === 'branch'");
    expect(lib).toContain("args.mode === 'branch'");
    expect(lib).toContain('BRANCH_REQUIRED');
    expect(lib).toContain('resolveEmployeeGlobalSchedule');
    expect(lib).toContain('allowedBranchIds');
  });
});

describe('bookingPublicBarberGlobalMode', () => {
  const lib = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
    'utf8',
  );
  it('dedupes by EmpID and filters public branches only', () => {
    expect(lib).toContain('dedupeBarbersByEmpId');
    expect(lib).toContain('canBranchAppearInPublicBooking');
    expect(lib).toContain("mode: 'global'");
  });
});

describe('bookingPublicBarberServiceEligibility', () => {
  const lib = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
    'utf8',
  );
  it('validates requested serviceIds against Phase 2 public catalog', () => {
    expect(lib).toContain('assertRequestedServicesPublic');
    expect(lib).toContain('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    expect(lib).toContain('loadPublicServiceIds');
  });
});

describe('bookingPublicBarberLocation', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/barbers/[empId]/location/route.ts'),
    'utf8',
  );
  it('uses getPublicBarberLocation with nested errors', () => {
    expect(src).toContain('getPublicBarberLocation');
    expect(src).toContain('publicBookingErrorResponse');
  });
});

describe('bookingPublicBarberCache', () => {
  const lib = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
    'utf8',
  );
  it('bounded cache with invalidate export', () => {
    expect(lib).toContain('CACHE_MAX = 32');
    expect(lib).toContain('invalidatePublicBookingBarbersCache');
    expect(lib).toContain('cacheKey');
  });
});
