/**
 * Booking V2 B8.6 — AvailabilityMutationNotifier (deferral + wiring audits).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/booking/cache/HotAvailabilityInvalidation', () => ({
  invalidateOnEffectiveDayChange: vi.fn(async () => undefined),
  invalidateOnWeeklyBaselineChange: vi.fn(async () => undefined),
  invalidateOnBranchHoursChange: vi.fn(async () => undefined),
  invalidateOnBookingCreated: vi.fn(async () => undefined),
  invalidateOnBookingCancelled: vi.fn(async () => undefined),
  invalidateOnBookingRescheduled: vi.fn(async () => undefined),
  invalidateOnHoldCreated: vi.fn(async () => undefined),
  invalidateOnHoldReleasedOrExpired: vi.fn(async () => undefined),
  invalidateOnQueueChanged: vi.fn(async () => undefined),
}));

describe('AvailabilityMutationNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers notifications until post-commit flush', async () => {
    const inv = await import('@/lib/booking/cache/HotAvailabilityInvalidation');
    const {
      AvailabilityMutationNotifier,
      __peekMutationDeferralPendingCount,
    } = await import('@/lib/booking/AvailabilityMutationNotifier');

    await AvailabilityMutationNotifier.runWithPostCommit(async () => {
      await AvailabilityMutationNotifier.queueOccupancyChanged({
        employeeId: 12,
        businessDate: '2026-08-17',
        reason: 'test',
      });
      expect(__peekMutationDeferralPendingCount()).toBe(1);
      expect(inv.invalidateOnQueueChanged).not.toHaveBeenCalled();
      return 'ok';
    });

    expect(inv.invalidateOnQueueChanged).toHaveBeenCalledTimes(1);
    expect(inv.invalidateOnQueueChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 12,
        businessDate: '2026-08-17',
        reason: 'test',
      }),
    );
  });

  it('discards notifications on rollback / throw', async () => {
    const inv = await import('@/lib/booking/cache/HotAvailabilityInvalidation');
    const { AvailabilityMutationNotifier } = await import(
      '@/lib/booking/AvailabilityMutationNotifier'
    );

    await expect(
      AvailabilityMutationNotifier.runWithPostCommit(async () => {
        await AvailabilityMutationNotifier.bookingOccupancyChanged({
          employeeId: 12,
          businessDate: '2026-08-17',
        });
        throw new Error('tx failed');
      }),
    ).rejects.toThrow('tx failed');

    expect(inv.invalidateOnBookingCreated).not.toHaveBeenCalled();
  });

  it('applies immediately when not inside runWithPostCommit', async () => {
    const inv = await import('@/lib/booking/cache/HotAvailabilityInvalidation');
    const { AvailabilityMutationNotifier } = await import(
      '@/lib/booking/AvailabilityMutationNotifier'
    );

    await AvailabilityMutationNotifier.employeeDayChanged({
      employeeId: 7,
      businessDate: '2026-08-17',
      branchId: 1,
    });

    expect(inv.invalidateOnEffectiveDayChange).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 7,
        businessDate: '2026-08-17',
        branchId: 1,
      }),
    );
  });

  it('maps assignment + weekly + occupancy methods', async () => {
    const inv = await import('@/lib/booking/cache/HotAvailabilityInvalidation');
    const { AvailabilityMutationNotifier } = await import(
      '@/lib/booking/AvailabilityMutationNotifier'
    );

    await AvailabilityMutationNotifier.employeeBranchAssignmentChanged({
      employeeId: 12,
      branchId: 2,
      businessDates: ['2026-08-17'],
    });
    expect(inv.invalidateOnWeeklyBaselineChange).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 12,
        branchId: 2,
        businessDates: ['2026-08-17'],
      }),
    );

    await AvailabilityMutationNotifier.holdOccupancyChanged({
      employeeId: 12,
      businessDate: '2026-08-17',
    });
    expect(inv.invalidateOnHoldCreated).toHaveBeenCalled();
  });
});

describe('B8.6 weak-path wiring', () => {
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  it('admin assignment create/remove use notifier', () => {
    const commit = read('src/lib/branch/employeeAssignmentCommit.ts');
    const remove = read('src/lib/branch/launchRosterService.ts');
    expect(commit).toContain('runWithPostCommit');
    expect(commit).toContain('employeeBranchAssignmentChanged');
    expect(remove).toContain('employeeBranchAssignmentChanged');
  });

  it('legacy queue + arrive + settle-expired wired', () => {
    expect(read('src/app/api/operations/queue/[id]/cancel/route.ts')).toContain(
      'queueOccupancyChanged',
    );
    expect(read('src/app/api/queue/settle-expired/route.ts')).toContain(
      'queueOccupancyChanged',
    );
    expect(
      read('src/app/api/operations/bookings/[id]/arrive/route.ts'),
    ).toContain('queueOccupancyChanged');
    expect(read('src/app/api/admin/cleanup-queue/route.ts')).toContain(
      'queueOccupancyChanged',
    );
  });

  it('freelance/attendance outside admin sync wired', () => {
    expect(
      read('src/modules/attendance/application/AttendanceCommandService.ts'),
    ).toContain('employeeDayChanged');
    expect(read('src/lib/hr/finalize-incomplete-attendance.ts')).toContain(
      'employeeDayChanged',
    );
  });

  it('legacy bookings + affected cancel wired', () => {
    expect(read('src/app/api/bookings/route.ts')).toContain(
      'bookingOccupancyChanged',
    );
    const patchRoute = read('src/app/api/bookings/[id]/route.ts');
    expect(patchRoute).toContain('bookingOccupancyChanged');
    expect(patchRoute).toContain('bookingOccupancyCancelled');
    expect(patchRoute).toContain('assignedEmpId: priorEmpId');
    expect(
      read('src/app/api/operations/affected-bookings/route.ts'),
    ).toContain('bookingOccupancyChanged');
  });

  it('hotCache helpers route through central notifier', () => {
    const src = read('src/lib/booking/cache/hotCacheInvalidateBestEffort.ts');
    expect(src).toContain('AvailabilityMutationNotifier');
    expect(src).toContain('employeeDayChanged');
    expect(src).toContain('queueOccupancyChanged');
  });

  it('stale verifier script exists and is report-only by default', () => {
    const src = read('scripts/verify-booking-v2-stale-projections.ts');
    expect(src).toContain('BOOKING_V2_STALE_FIX');
    expect(src).toContain('Does NOT auto-repair by default');
  });
});
