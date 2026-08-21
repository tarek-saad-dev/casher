/**
 * Booking V2 Phase B4 — Effective Day Projection tests.
 * Pure / in-memory. No public route migration.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BookingPolicy,
  findBookingsOutsideEffectiveMask,
  hasDateSpecificLayers,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain';
import {
  createEffectiveDayMemoryStore,
  createEffectiveDayProjectionService,
  createEffectiveDayRevisionBoard,
  resolveEffectiveDayBitmap,
} from '@/lib/booking/projection';

const EMP = 42;
const BRANCH_GLEEM = 1;
const BRANCH_CAMP = 2;
const DATE = '2026-08-16';
const DOW = 0 as const; // Sunday Aug 16 2026

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function weekly(
  partial?: Partial<WeeklyBaselineSourceInputs>,
): WeeklyBaselineSourceInputs {
  return {
    key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW },
    employeeWindows: [{ startHhmm: '10:00', endHhmm: '18:00' }],
    isEmployeeWorkingDay: true,
    branchHours: { startHhmm: '09:00', endHhmm: '21:00' },
    branchIsOpen: true,
    ...partial,
  };
}

function overnightWeekly(): WeeklyBaselineSourceInputs {
  return weekly({
    key: { employeeId: EMP, branchId: BRANCH_CAMP, dayOfWeek: DOW },
    employeeWindows: [{ startHhmm: '14:00', endHhmm: '02:00' }],
    branchHours: { startHhmm: '14:00', endHhmm: '02:00' },
  });
}

describe('BOOKING V2 EFFECTIVE DAY', () => {
  it('normal day reuses weekly baseline (no store row)', async () => {
    const store = createEffectiveDayMemoryStore();
    const svc = createEffectiveDayProjectionService({ store });
    const record = await svc.getOrRebuild({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: {},
      sourceRevision: 1,
    });
    expect(record.reusedBaseline).toBe(true);
    expect(record.bitmap).toBeNull();
    expect(record.changeMask).toEqual([]);
    expect(store.size?.()).toBe(0);

    const plan = BookingPolicy.normalizeWeeklyBaseline(weekly());
    const baselineBm = BookingPolicy.weeklyBaselineBitmap(plan);
    const resolved = resolveEffectiveDayBitmap(record, baselineBm);
    expect(resolved.equals(baselineBm)).toBe(true);
    expect(hasDateSpecificLayers({})).toBe(false);
  });

  it('late_start clears morning and sets ChangeMask', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { lateStartHhmm: '12:00' },
    });
    expect(built.reusedBaseline).toBe(false);
    expect(built.changeMask.has('late_start')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(11 * 60, 30)).toBe(false);
    expect(built.bitmap.hasConsecutiveFreeAt(12 * 60, 30)).toBe(true);
  });

  it('early_leave clears afternoon', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { earlyLeaveHhmm: '15:00' },
    });
    expect(built.changeMask.has('early_leave')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(14 * 60, 60)).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(15 * 60, 30)).toBe(false);
  });

  it('multiple block_ranges', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: {
        blockRanges: [
          { startHhmm: '11:00', endHhmm: '11:30' },
          { startHhmm: '14:00', endHhmm: '15:00' },
        ],
      },
    });
    expect(built.changeMask.has('block_range')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(11 * 60, 15)).toBe(false);
    expect(built.bitmap.hasConsecutiveFreeAt(14 * 60, 30)).toBe(false);
    expect(built.bitmap.hasConsecutiveFreeAt(12 * 60, 30)).toBe(true);
  });

  it('close_day empties mask', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { closeDay: true },
    });
    expect(built.changeMask.has('close_day')).toBe(true);
    expect(built.isWorking).toBe(false);
    expect(built.bitmap.isEmpty()).toBe(true);
  });

  it('absent empties mask', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { absent: true },
    });
    expect(built.changeMask.has('attendance_absent')).toBe(true);
    expect(built.bitmap.isEmpty()).toBe(true);
  });

  it('present_on_day_off unlocks weekly day off', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly({
        isEmployeeWorkingDay: false,
        employeeWindows: [],
      }),
      layers: {
        presentOnDayOff: { startHhmm: '12:00', endHhmm: '16:00' },
      },
    });
    expect(built.changeMask.has('present_on_day_off')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(12 * 60, 60)).toBe(true);
    expect(built.isWorking).toBe(true);
  });

  it('freelancer unlock', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly({
        isEmployeeWorkingDay: false,
        employeeWindows: [],
      }),
      layers: {
        freelancerUnlock: { startHhmm: '13:00', endHhmm: '17:00' },
      },
    });
    expect(built.changeMask.has('freelancer_unlock')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(13 * 60, 60)).toBe(true);
  });

  it('exceptional branch hours intersect', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: {
        branchException: {
          isClosed: false,
          openHhmm: '12:00',
          closeHhmm: '16:00',
          endDayOffset: 0,
        },
      },
    });
    expect(built.changeMask.has('branch_exception')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(11 * 60, 30)).toBe(false);
    expect(built.bitmap.hasConsecutiveFreeAt(12 * 60, 60)).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(16 * 60, 30)).toBe(false);
  });

  it('overnight branch + employee schedule', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_CAMP, businessDate: DATE },
      weeklyBaselineInputs: overnightWeekly(),
      layers: {},
    });
    expect(built.reusedBaseline).toBe(true);
    const plan = BookingPolicy.normalizeWeeklyBaseline(overnightWeekly());
    const bm = BookingPolicy.weeklyBaselineBitmap(plan);
    expect(bm.hasConsecutiveFreeAt(23 * 60, 30)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(24 * 60 + 30, 30)).toBe(true); // 00:30
    expect(bm.hasConsecutiveFreeAt(24 * 60 + 120, 5)).toBe(false); // 02:00
  });

  it('overnight early_leave after midnight', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_CAMP, businessDate: DATE },
      weeklyBaselineInputs: overnightWeekly(),
      layers: { earlyLeaveHhmm: '01:00' },
    });
    expect(built.changeMask.has('early_leave')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(24 * 60 + 30, 30)).toBe(true); // 00:30
    expect(built.bitmap.hasConsecutiveFreeAt(24 * 60 + 60, 30)).toBe(false); // 01:00
  });

  it('multiple overrides combined', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: {
        lateStartHhmm: '11:00',
        earlyLeaveHhmm: '17:00',
        blockRanges: [{ startHhmm: '13:00', endHhmm: '14:00' }],
      },
    });
    expect(built.changeMask.has('late_start')).toBe(true);
    expect(built.changeMask.has('early_leave')).toBe(true);
    expect(built.changeMask.has('block_range')).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(10 * 60, 30)).toBe(false);
    expect(built.bitmap.hasConsecutiveFreeAt(13 * 60, 30)).toBe(false);
    expect(built.bitmap.hasConsecutiveFreeAt(15 * 60, 30)).toBe(true);
    expect(built.bitmap.hasConsecutiveFreeAt(17 * 60, 30)).toBe(false);
  });

  it('two branches same employee stay independent', () => {
    const a = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { closeDay: true },
    });
    const b = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_CAMP, businessDate: DATE },
      weeklyBaselineInputs: overnightWeekly(),
      layers: {},
    });
    expect(a.isWorking).toBe(false);
    expect(b.reusedBaseline).toBe(true);
    expect(b.isWorking).toBe(true);
  });

  it('date-scoped invalidation + stale rebuild', async () => {
    const board = createEffectiveDayRevisionBoard();
    const store = createEffectiveDayMemoryStore();
    const svc = createEffectiveDayProjectionService({ store, revisionBoard: board });

    const key = { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE };
    const first = await svc.rebuild({
      key,
      weeklyBaselineInputs: weekly(),
      layers: { lateStartHhmm: '12:00' },
      sourceRevision: 1,
    });
    expect(store.size?.()).toBe(1);
    expect(first.projectionRevision).toBeGreaterThan(0);

    const { revision } = await svc.invalidate({
      reason: 'late_start_changed',
      employeeId: EMP,
      branchId: BRANCH_GLEEM,
      businessDate: DATE,
    });
    expect(revision).toBeGreaterThan(first.projectionRevision);
    expect(store.size?.()).toBe(0);

    const second = await svc.getOrRebuild({
      key,
      weeklyBaselineInputs: weekly(),
      layers: { lateStartHhmm: '13:00' },
      sourceRevision: 1,
    });
    expect(second.projectionRevision).toBe(revision);
    expect(second.bitmap!.hasConsecutiveFreeAt(12 * 60, 30)).toBe(false);
    expect(second.bitmap!.hasConsecutiveFreeAt(13 * 60, 30)).toBe(true);
  });

  it('existing booking outside mask is reported, never cancelled', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { blockRanges: [{ startHhmm: '11:00', endHhmm: '12:00' }] },
    });
    const affected = findBookingsOutsideEffectiveMask({
      bookings: [
        { bookingId: 1001, startMin: 11 * 60, endMin: 11 * 60 + 30 },
        { bookingId: 1002, startMin: 14 * 60, endMin: 14 * 60 + 30 },
      ],
      effectiveBitmap: built.bitmap,
    });
    expect(affected.map((a) => a.bookingId)).toEqual([1001]);
    expect(affected[0]!.reason).toBe('OUTSIDE_EFFECTIVE_MASK');
    // Still only a report — no mutation API invoked
    expect(affected).toHaveLength(1);
  });

  it('daily CLOSE_DAY adjustment via layers', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
      weeklyBaselineInputs: weekly(),
      layers: { dailyAdjustments: [{ type: 'CLOSE_DAY' }] },
    });
    expect(built.changeMask.has('close_day')).toBe(true);
    expect(built.bitmap.isEmpty()).toBe(true);
  });

  it('benchmark: 200 effective-day builds stay under 50ms typical', () => {
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) {
      BookingPolicy.buildEffectiveDay({
        key: { employeeId: EMP, branchId: BRANCH_GLEEM, businessDate: DATE },
        weeklyBaselineInputs: weekly(),
        layers:
          i % 2 === 0
            ? {}
            : {
                lateStartHhmm: '11:00',
                blockRanges: [{ startHhmm: '13:00', endHhmm: '13:30' }],
              },
      });
    }
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(200);
  });

  it('no public route wiring + deploy-time migration only', () => {
    const slots = read('src/app/api/public/booking/available-slots/route.ts');
    const create = read('src/app/api/public/booking/create/route.ts');
    const dbStore = read('src/lib/booking/projection/EffectiveDayDbStore.ts');
    const migration = read('db/migrations/create-effective-day-projection.sql');
    const sot = read('src/lib/booking/projection/WeeklyBaselineSourceLoader.ts');

    expect(slots).not.toContain('EffectiveDayProjection');
    expect(create).not.toContain('EffectiveDayProjection');
    expect(dbStore).not.toContain('CREATE TABLE');
    expect(dbStore).not.toMatch(/ensure\w*\s*\(/);
    expect(dbStore).not.toContain('IF OBJECT_ID');
    expect(migration).toContain('TblBookingEffectiveDayProjection');
    expect(sot).toContain('TblEmpBranchAssignment');
    expect(sot).toContain('TblEmpBranchWorkSchedule');
    expect(sot).toContain('DefaultOpenTime');
    expect(sot).not.toContain('resolveEmployeeDayPlan');
    expect(sot).not.toContain('ensureEmpBranchWorkScheduleTable');
  });
});
