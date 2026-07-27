/** Phase 8B1A — booking paused must not become empty catalogs. */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

describe('bookingPhase8b1aPausedBranchGates', () => {
  it('services route returns BRANCH_BOOKING_DISABLED when booking disabled (not empty 200)', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/services/route.ts'),
      'utf8',
    );
    expect(src).toContain("finalizePublicBookingError(req, gate, 'BRANCH_BOOKING_DISABLED')");
    expect(src).toContain('!ctx.bookingEnabled || !ctx.publicBookingEnabled');
    // Empty catalog is a different code, only after enabled gate
    expect(src).toContain('SERVICES_NOT_CONFIGURED');
    const disabledIdx = src.indexOf('BRANCH_BOOKING_DISABLED');
    const emptyIdx = src.indexOf('SERVICES_NOT_CONFIGURED');
    expect(disabledIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(disabledIdx);
  });

  it('barbers library gates on bookingEnabled before listing', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
      'utf8',
    );
    expect(src).toContain("throw new PublicBookingBarberError('BRANCH_BOOKING_DISABLED')");
    expect(src).toContain('!branchCtx.bookingEnabled || !branchCtx.publicBookingEnabled');
  });

  it('public branch visibility requires QueueBookingSettings.BookingEnabled', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/branch/publicBranchVisibility.ts'),
      'utf8',
    );
    expect(src).toContain('BookingEnabled');
    expect(src).toContain('canBranchAppearInPublicBooking');
  });

  it('available-days maps isGlobalDayOff to global_leave for specific barber', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
      'utf8',
    );
    expect(src).toContain("if (global.isGlobalDayOff) return 'global_leave'");
  });

  it('global schedule marks day off when no working branches remain', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/hr/employeeBranchScheduleResolver.ts'),
      'utf8',
    );
    expect(src).toContain('isGlobalDayOff: branches.length === 0');
    expect(src).toContain('publicOnly');
    expect(src).toContain('canBranchAppearInPublicBooking');
  });

  it('config reports BOOKING_PAUSED when salon booking disabled', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/config/route.ts'),
      'utf8',
    );
    expect(src).toContain('PUBLIC_BOOKING_PAUSED_CODE');
    expect(src).toContain('bookingEnabled');
  });
});
