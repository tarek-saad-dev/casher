/**
 * Booking V2 Phase B3 — Weekly Baseline Availability Projection.
 * Pure / in-memory. No public routes, FE, or create behavior changes.
 */
import { describe, expect, it } from 'vitest';

import {
  AvailabilityBitmap,
  AVAILABILITY_BYTE_LENGTH,
  AVAILABILITY_QUANTUM_MINUTES,
  AVAILABILITY_SLOT_COUNT,
  BookingPolicy,
  weeklyBaselineKeyString,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain';
import { createWeeklyBaselineProjectionService } from '@/lib/booking/projection/WeeklyBaselineProjection';
import { createWeeklyBaselineMemoryStore } from '@/lib/booking/projection/WeeklyBaselineMemoryStore';
import { createWeeklyBaselineRevisionBoard } from '@/lib/booking/projection/WeeklyBaselineRevision';

const EMP = 42;
const BRANCH_GLEEM = 1;
const BRANCH_CAMP = 2;
const DOW_WED = 3 as const;

function inputs(
  partial: Partial<WeeklyBaselineSourceInputs> &
    Pick<WeeklyBaselineSourceInputs, 'key'>,
): WeeklyBaselineSourceInputs {
  return {
    employeeWindows: [{ startHhmm: '10:00', endHhmm: '18:00' }],
    isEmployeeWorkingDay: true,
    branchHours: { startHhmm: '09:00', endHhmm: '21:00' },
    branchIsOpen: true,
    ...partial,
  };
}

describe('5-MINUTE BITMAP CORE', () => {
  it('uses 5-minute quantum and 48h / 576-slot packing', () => {
    expect(AVAILABILITY_QUANTUM_MINUTES).toBe(5);
    expect(AVAILABILITY_SLOT_COUNT).toBe(576);
    expect(AVAILABILITY_BYTE_LENGTH).toBe(72);
    expect(AvailabilityBitmap.empty().toBytes().length).toBe(72);
  });

  it('set/clear range + AND / OR / NOT', () => {
    const a = AvailabilityBitmap.empty().setRange(10 * 60, 12 * 60);
    const b = AvailabilityBitmap.empty().setRange(11 * 60, 13 * 60);
    const anded = a.and(b);
    expect(anded.toFreeRanges()).toEqual([{ startMin: 11 * 60, endMin: 12 * 60 }]);

    const ored = a.or(b);
    expect(ored.toFreeRanges()).toEqual([{ startMin: 10 * 60, endMin: 13 * 60 }]);

    const cleared = ored.clone().clearRange(11 * 60, 12 * 60);
    expect(cleared.toFreeRanges()).toEqual([
      { startMin: 10 * 60, endMin: 11 * 60 },
      { startMin: 12 * 60, endMin: 13 * 60 },
    ]);

    const inverted = AvailabilityBitmap.empty().setRange(0, 60).not();
    expect(inverted.hasConsecutiveFreeAt(0, 5)).toBe(false);
    expect(inverted.hasConsecutiveFreeAt(60, 5)).toBe(true);
  });

  it('bitmap → ranges → bitmap roundtrip', () => {
    const original = AvailabilityBitmap.empty()
      .setRange(9 * 60, 12 * 60)
      .setRange(14 * 60, 16 * 60 + 30)
      .setRange(23 * 60, 25 * 60); // overnight-ish
    const ranges = original.toFreeRanges();
    const rebuilt = AvailabilityBitmap.fromFreeRanges(ranges);
    expect(rebuilt.equals(original)).toBe(true);
    expect(AvailabilityBitmap.fromBase64(original.toBase64()).equals(original)).toBe(
      true,
    );
  });
});

describe('OVERNIGHT BITMAP', () => {
  it('supports overnight 11:00 → 01:30', () => {
    const bm = AvailabilityBitmap.empty().setRange(11 * 60, 24 * 60 + 90);
    expect(bm.hasConsecutiveFreeAt(11 * 60, 60)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(23 * 60 + 45, 30)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(24 * 60 + 60, 30)).toBe(true); // 01:00
    expect(bm.hasConsecutiveFreeAt(24 * 60 + 90, 5)).toBe(false); // 01:30 exclusive
    expect(bm.toFreeRanges()).toEqual([{ startMin: 660, endMin: 1530 }]);
  });
});

describe('WEEKLY BASELINE PROJECTION', () => {
  it('normal daytime via BookingPolicy', () => {
    const plan = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
      }),
    );
    expect(plan.isWorking).toBe(true);
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0]!.startMin).toBe(10 * 60);
    expect(plan.windows[0]!.endMin).toBe(18 * 60);

    const bm = BookingPolicy.weeklyBaselineBitmap(plan);
    expect(bm.hasConsecutiveFreeAt(10 * 60, 60)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(17 * 60, 60)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(18 * 60, 5)).toBe(false);
  });

  it('overnight weekly baseline 11:00 → 01:30', () => {
    const plan = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_CAMP, dayOfWeek: DOW_WED },
        employeeWindows: [{ startHhmm: '11:00', endHhmm: '01:30' }],
        branchHours: { startHhmm: '11:00', endHhmm: '01:30' },
      }),
    );
    expect(plan.isWorking).toBe(true);
    expect(plan.windows[0]!.endDayOffset).toBe(1);
    expect(plan.windows[0]!.startMin).toBe(660);
    expect(plan.windows[0]!.endMin).toBe(1530);
    const bm = BookingPolicy.weeklyBaselineBitmap(plan);
    expect(bm.hasConsecutiveFreeAt(0, 30)).toBe(false);
    expect(bm.hasConsecutiveFreeAt(24 * 60 + 60, 30)).toBe(true);
  });

  it('multiple work windows', () => {
    const plan = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
        employeeWindows: [
          { startHhmm: '10:00', endHhmm: '13:00' },
          { startHhmm: '16:00', endHhmm: '20:00' },
        ],
        branchHours: { startHhmm: '09:00', endHhmm: '22:00' },
      }),
    );
    expect(plan.windows).toHaveLength(2);
    const bm = BookingPolicy.weeklyBaselineBitmap(plan);
    expect(bm.hasConsecutiveFreeAt(12 * 60, 30)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(14 * 60, 30)).toBe(false);
    expect(bm.hasConsecutiveFreeAt(17 * 60, 30)).toBe(true);
  });

  it('day off → empty baseline', () => {
    const plan = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: 5 },
        isEmployeeWorkingDay: false,
      }),
    );
    expect(plan.isWorking).toBe(false);
    expect(plan.denyReason).toBe('DAY_OFF');
    expect(BookingPolicy.weeklyBaselineBitmap(plan).isEmpty()).toBe(true);
  });

  it('employee in two branches — distinct keys, global EmpID preserved', () => {
    const gleem = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
        employeeWindows: [{ startHhmm: '10:00', endHhmm: '18:00' }],
      }),
    );
    const camp = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_CAMP, dayOfWeek: DOW_WED },
        employeeWindows: [{ startHhmm: '11:00', endHhmm: '01:30' }],
        branchHours: { startHhmm: '11:00', endHhmm: '01:30' },
      }),
    );
    expect(gleem.key.employeeId).toBe(camp.key.employeeId);
    expect(gleem.key.branchId).not.toBe(camp.key.branchId);
    expect(weeklyBaselineKeyString(gleem.key)).not.toBe(
      weeklyBaselineKeyString(camp.key),
    );
    expect(gleem.windows[0]!.endMin).toBe(18 * 60);
    expect(camp.windows[0]!.endMin).toBe(1530);
  });

  it('branch hours intersect employee schedule', () => {
    const plan = BookingPolicy.normalizeWeeklyBaseline(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
        employeeWindows: [{ startHhmm: '08:00', endHhmm: '20:00' }],
        branchHours: { startHhmm: '10:00', endHhmm: '18:00' },
      }),
    );
    expect(plan.windows).toEqual([
      expect.objectContaining({
        startMin: 10 * 60,
        endMin: 18 * 60,
        startHhmm: '10:00',
        endHhmm: '18:00',
      }),
    ]);
  });

  it('5/15/30/45/60 minute consecutive availability', () => {
    const bm = BookingPolicy.weeklyBaselineBitmap(
      BookingPolicy.normalizeWeeklyBaseline(
        inputs({
          key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
          employeeWindows: [{ startHhmm: '12:00', endHhmm: '13:00' }],
          branchHours: { startHhmm: '12:00', endHhmm: '13:00' },
        }),
      ),
    );
    // Window is exactly 60 minutes.
    expect(bm.hasConsecutiveFree(5)).toBe(true);
    expect(bm.hasConsecutiveFree(15)).toBe(true);
    expect(bm.hasConsecutiveFree(30)).toBe(true);
    expect(bm.hasConsecutiveFree(45)).toBe(true);
    expect(bm.hasConsecutiveFree(60)).toBe(true);
    expect(bm.hasConsecutiveFree(65)).toBe(false);
    expect(bm.hasConsecutiveFreeAt(12 * 60, 60)).toBe(true);
    expect(bm.hasConsecutiveFreeAt(12 * 60 + 5, 60)).toBe(false);
  });

  it('excludes daily adjustments from baseline inputs by construction', () => {
    // Baseline API has no late_start / bookings fields — only weekly + branch hours.
    const src = inputs({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
    });
    expect('late_start' in src).toBe(false);
    expect('bookings' in src).toBe(false);
    expect('holds' in src).toBe(false);
    const plan = BookingPolicy.normalizeWeeklyBaseline(src);
    expect(plan.isWorking).toBe(true);
  });
});

describe('REVISION INVALIDATION + REBUILDABLE', () => {
  it('rebuilds from SoT and invalidates only affected baselines', async () => {
    const store = createWeeklyBaselineMemoryStore();
    const board = createWeeklyBaselineRevisionBoard();
    const svc = createWeeklyBaselineProjectionService({ store, revisionBoard: board });

    const gleemWed = inputs({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
    });
    const gleemThu = inputs({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: 4 },
    });
    const campWed = inputs({
      key: { employeeId: EMP, branchId: BRANCH_CAMP, dayOfWeek: DOW_WED },
      employeeWindows: [{ startHhmm: '11:00', endHhmm: '01:30' }],
      branchHours: { startHhmm: '11:00', endHhmm: '01:30' },
    });

    const a = await svc.rebuild(gleemWed);
    const b = await svc.rebuild(gleemThu);
    const c = await svc.rebuild(campWed);
    expect(store.size?.()).toBe(3);
    expect(a.revision).toBe(1);

    // Weekly schedule change for Gleem Wednesday only.
    const inv = await svc.invalidate({
      reason: 'weekly_schedule_changed',
      employeeId: EMP,
      branchId: BRANCH_GLEEM,
      dayOfWeek: DOW_WED,
    });
    expect(inv.deleted).toBe(1);
    expect(await svc.get(gleemWed.key)).toBeNull();
    expect(await svc.get(gleemThu.key)).not.toBeNull();
    expect(await svc.get(campWed.key)).not.toBeNull();

    const rebuilt = await svc.getOrRebuild({
      ...gleemWed,
      employeeWindows: [{ startHhmm: '12:00', endHhmm: '18:00' }],
    });
    expect(rebuilt.revision).toBe(inv.revision);
    expect(rebuilt.plan.windows[0]!.startMin).toBe(12 * 60);
    expect(rebuilt.sourceFingerprint).not.toBe(a.sourceFingerprint);

    // Branch hours change invalidates all employees at that branch (dropMatching by branch).
    await svc.rebuild(gleemThu);
    const branchInv = await svc.invalidate({
      reason: 'branch_hours_changed',
      branchId: BRANCH_GLEEM,
    });
    expect(branchInv.deleted).toBeGreaterThanOrEqual(1);
    expect(await svc.get(campWed.key)).not.toBeNull();

    // Assignment change: emp × branch (all DOWs).
    await svc.rebuild(campWed);
    await svc.rebuild(
      inputs({
        key: { employeeId: EMP, branchId: BRANCH_CAMP, dayOfWeek: 4 },
        employeeWindows: [{ startHhmm: '11:00', endHhmm: '01:30' }],
        branchHours: { startHhmm: '11:00', endHhmm: '01:30' },
      }),
    );
    const assignInv = await svc.invalidate({
      reason: 'employee_branch_assignment_changed',
      employeeId: EMP,
      branchId: BRANCH_CAMP,
    });
    expect(assignInv.deleted).toBe(2);

    // Pure rebuild without store still works (correctness ≠ memory).
    const pure = svc.build(gleemWed);
    expect(pure.bitmap.hasConsecutiveFree(30)).toBe(true);
    expect(b.key.dayOfWeek).toBe(4);
    expect(c.key.branchId).toBe(BRANCH_CAMP);
  });

  it('getOrRebuild skips rebuild when revision + fingerprint match', async () => {
    const svc = createWeeklyBaselineProjectionService();
    const src = inputs({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
    });
    const first = await svc.getOrRebuild(src, { nowMs: 1000 });
    const second = await svc.getOrRebuild(src, { nowMs: 2000 });
    expect(second.builtAtMs).toBe(first.builtAtMs);
  });
});

describe('benchmark (approx)', () => {
  it('build + read baseline is sub-millisecond class for single key', async () => {
    const svc = createWeeklyBaselineProjectionService();
    const src = inputs({
      key: { employeeId: EMP, branchId: BRANCH_GLEEM, dayOfWeek: DOW_WED },
      employeeWindows: [{ startHhmm: '11:00', endHhmm: '01:30' }],
      branchHours: { startHhmm: '11:00', endHhmm: '01:30' },
    });

    const buildN = 2000;
    const t0 = performance.now();
    for (let i = 0; i < buildN; i++) svc.build(src);
    const buildMs = performance.now() - t0;

    await svc.rebuild(src);
    const readN = 5000;
    const t1 = performance.now();
    for (let i = 0; i < readN; i++) await svc.get(src.key);
    const readMs = performance.now() - t1;

    const buildPer = buildMs / buildN;
    const readPer = readMs / readN;
    // eslint-disable-next-line no-console
    console.log(
      '[B3 benchmark]',
      JSON.stringify({
        buildPerUs: Number((buildPer * 1000).toFixed(2)),
        readPerUs: Number((readPer * 1000).toFixed(2)),
        bitmapBytes: AVAILABILITY_BYTE_LENGTH,
      }),
    );
    // Loose ceilings — CI noise tolerant; documents order of magnitude.
    expect(buildPer).toBeLessThan(1); // < 1ms / build
    expect(readPer).toBeLessThan(0.5);
  });
});
