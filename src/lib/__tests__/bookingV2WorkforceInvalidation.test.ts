/**
 * Booking V2 — workforce CLOSE_DAY invalidation + EffectiveDay layer loader correctness.
 *
 * Reproduces production symptom: stale V2 read after close_day while /create correctly rejects.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import {
  createAvailabilityRevisionBoard,
  deriveAvailabilityRevision,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';
import {
  createHotAvailabilityCache,
  invalidateOnEffectiveDayChange,
  type HotAvailabilityDayPayload,
} from '@/lib/booking/cache';
import { __resetWarmMatrixContextForTests } from '@/lib/booking/cache/WarmMatrixContextCache';
import { mapEmployeeDailyAdjustmentsToEffectiveLayers } from '@/lib/booking/projection/mapDailyAdjustmentsToEffectiveLayers';
import type { EmployeeDailyAdjustment } from '@/lib/availability/dailyAdjustments';
import { shiftCalendarDate } from '@/lib/businessDate';

vi.mock('server-only', () => ({}));

const EMP = 7;
const BRANCH_A = 1;
const BRANCH_B = 2;
const DATE = '2026-08-30';

function adjCloseDay(): EmployeeDailyAdjustment {
  return {
    adjustmentId: 99,
    branchId: BRANCH_A,
    employeeId: EMP,
    businessDate: DATE,
    adjustmentType: 'CLOSE_DAY',
    reasonCode: null,
    reasonText: null,
    source: 'admin',
    windows: [],
    createdBy: 1,
    createdAt: '2026-08-30T10:00:00Z',
    version: 1,
  };
}

function openPayload(rev = 0): HotAvailabilityDayPayload {
  const parts: AvailabilityRevisionParts = {
    effectiveWorkRevision: rev,
    bookingOccupancyRevision: 0,
    holdOccupancyRevision: 0,
    queueOccupancyRevision: 0,
  };
  const work = AvailabilityBitmap.empty().setRange(10 * 60, 18 * 60);
  return {
    availabilityRevision: deriveAvailabilityRevision(parts),
    parts: {
      effectiveWorkRevision: parts.effectiveWorkRevision,
      bookingOccupancyRevision: parts.bookingOccupancyRevision,
      holdOccupancyRevision: parts.holdOccupancyRevision,
      queueOccupancyRevision: parts.queueOccupancyRevision,
    },
    effectiveWorkMask: work,
    bookingOccupancyMask: AvailabilityBitmap.empty(),
    holdOccupancyMask: AvailabilityBitmap.empty(),
    queueOccupancyMask: AvailabilityBitmap.empty(),
    freeMask: work.clone(),
    reusedBaseline: true,
    builtAtMs: Date.now(),
  };
}

function closedPayload(rev = 1): HotAvailabilityDayPayload {
  const parts: AvailabilityRevisionParts = {
    effectiveWorkRevision: rev,
    bookingOccupancyRevision: 0,
    holdOccupancyRevision: 0,
    queueOccupancyRevision: 0,
  };
  return {
    availabilityRevision: deriveAvailabilityRevision(parts),
    parts: {
      effectiveWorkRevision: parts.effectiveWorkRevision,
      bookingOccupancyRevision: parts.bookingOccupancyRevision,
      holdOccupancyRevision: parts.holdOccupancyRevision,
      queueOccupancyRevision: parts.queueOccupancyRevision,
    },
    effectiveWorkMask: AvailabilityBitmap.empty(),
    bookingOccupancyMask: AvailabilityBitmap.empty(),
    holdOccupancyMask: AvailabilityBitmap.empty(),
    queueOccupancyMask: AvailabilityBitmap.empty(),
    freeMask: AvailabilityBitmap.empty(),
    reusedBaseline: false,
    builtAtMs: Date.now(),
  };
}

describe('workforce CLOSE_DAY layer mapping', () => {
  it('maps CLOSE_DAY adjustment into EffectiveDay layers', () => {
    const layers = mapEmployeeDailyAdjustmentsToEffectiveLayers([adjCloseDay()]);
    expect(layers).toEqual([{ type: 'CLOSE_DAY' }]);
  });

  it('CLOSE_DAY layer yields zero free availability (create-path parity)', () => {
    const built = BookingPolicy.buildEffectiveDay({
      key: { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE },
      weeklyBaselineInputs: {
        key: { employeeId: EMP, branchId: BRANCH_A, dayOfWeek: 6 },
        employeeWindows: [{ startHhmm: '10:00', endHhmm: '18:00' }],
        isEmployeeWorkingDay: true,
        branchHours: { startHhmm: '09:00', endHhmm: '21:00' },
        branchIsOpen: true,
      },
      layers: {
        dailyAdjustments: mapEmployeeDailyAdjustmentsToEffectiveLayers([adjCloseDay()]),
      },
    });
    expect(built.isWorking).toBe(false);
    expect(built.bitmap.isEmpty()).toBe(true);
  });
});

describe('B7 loader wiring — daily adjustments', () => {
  it('does not reference removed WindowsJson column', () => {
    const batch = readFileSync(
      join(process.cwd(), 'src/lib/booking/projection/loadEffectiveDayLayersBatch.ts'),
      'utf8',
    );
    const single = readFileSync(
      join(process.cwd(), 'src/lib/booking/projection/EffectiveDayLayerLoader.ts'),
      'utf8',
    );
    expect(batch).not.toContain('WindowsJson');
    expect(batch).toContain('loadDailyAdjustmentsBatch');
    expect(single).not.toContain('WindowsJson');
    expect(single).toContain('loadDailyAdjustmentsBatch');
  });

  it('createDailyAdjustment awaits post-commit invalidation', () => {
    const svc = readFileSync(
      join(process.cwd(), 'src/lib/availability/dailyAdjustmentService.ts'),
      'utf8',
    );
    expect(svc).toContain('await invalidateEmployeeScheduleCachesAsync');
    expect(svc.indexOf('await transaction.commit()')).toBeLessThan(
      svc.indexOf('await invalidateEmployeeScheduleCachesAsync'),
    );
  });
});

describe('workforce invalidation — warm matrix parity', () => {
  beforeEach(() => {
    __resetWarmMatrixContextForTests();
  });

  async function readDayFree(
    cache: ReturnType<typeof createHotAvailabilityCache>,
    revParts: AvailabilityRevisionParts,
    branchId: number,
    businessDate: string,
    payload: HotAvailabilityDayPayload,
  ): Promise<boolean> {
    const key = { employeeId: EMP, branchId, businessDate };
    const expected = deriveAvailabilityRevision(revParts);
    const cached = cache.getCached(key);
    if (cached && cached.availabilityRevision === expected) {
      return !cached.freeMask.isEmpty();
    }
    await cache.put(key, { ...payload, availabilityRevision: expected });
    return !payload.freeMask.isEmpty();
  }

  it('warm 14-day then close_day bump: 1-day and 14-day reads agree (CLOSED)', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({ revisionBoard: board, softTtlMs: 60_000 });
    const from = DATE;
    const to = shiftCalendarDate(from, 13);

    const revOpen: AvailabilityRevisionParts = {
      effectiveWorkRevision: 0,
      bookingOccupancyRevision: 0,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    };
    const open = openPayload(0);

    // Warm 14-day matrix in L1
    let cur = from;
    while (cur <= to) {
      await cache.put(
        { employeeId: EMP, branchId: BRANCH_A, businessDate: cur },
        { ...open, availabilityRevision: deriveAvailabilityRevision(revOpen) },
      );
      cur = shiftCalendarDate(cur, 1);
    }
    expect(cache.l1Size()).toBe(14);

    const hasFreeBefore = await readDayFree(cache, revOpen, BRANCH_A, DATE, open);
    expect(hasFreeBefore).toBe(true);

    // close_day committed → effectiveWork revision bump + L1 drop
    board.bumpEffectiveWork(EMP, DATE);
    const revClosed: AvailabilityRevisionParts = {
      effectiveWorkRevision: 1,
      bookingOccupancyRevision: 0,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    };
    await invalidateOnEffectiveDayChange(
      {
        employeeId: EMP,
        branchId: BRANCH_A,
        businessDate: DATE,
        reason: 'close_day',
      },
      cache,
    );

    const closed = closedPayload(1);
    const oneDayFree = await readDayFree(cache, revClosed, BRANCH_A, DATE, closed);
    expect(oneDayFree).toBe(false);

    // 14-day range: affected day closed; other days may remain open
    let closedDays = 0;
    cur = from;
    while (cur <= to) {
      const parts =
        cur === DATE
          ? revClosed
          : revOpen;
      const payload = cur === DATE ? closed : open;
      const free = await readDayFree(cache, parts, BRANCH_A, cur, payload);
      if (cur === DATE) expect(free).toBe(false);
      if (!free) closedDays++;
      cur = shiftCalendarDate(cur, 1);
    }
    expect(closedDays).toBeGreaterThanOrEqual(1);
  });

  it('cross-branch: workforce invalidation drops Emp×Date across branches', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const open = openPayload(0);
    const keyA = { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE };
    const keyB = { employeeId: EMP, branchId: BRANCH_B, businessDate: DATE };
    await cache.put(keyA, open);
    await cache.put(keyB, open);

    await invalidateOnEffectiveDayChange(
      {
        employeeId: EMP,
        branchId: BRANCH_A,
        businessDate: DATE,
        reason: 'close_day',
      },
      cache,
    );

    expect(cache.getCached(keyA)).toBeNull();
    expect(cache.getCached(keyB)).toBeNull();
  });

  it('workforce invalidation does not clear booking occupancy revision layer', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({ revisionBoard: board, softTtlMs: 60_000 });
    board.note({
      employeeId: EMP,
      businessDate: DATE,
      effectiveWorkRevision: 0,
      bookingOccupancyRevision: 5,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    });

    await invalidateOnEffectiveDayChange(
      {
        employeeId: EMP,
        branchId: BRANCH_A,
        businessDate: DATE,
        reason: 'close_day',
      },
      cache,
    );

    expect(board.effectiveWorkRevision(EMP, DATE)).toBe(1);
    expect(board.bookingOccupancyRevision(EMP, DATE)).toBe(5);
  });
});

describe('invalidateEmployeeScheduleCachesAsync', () => {
  beforeEach(() => {
    vi.resetModules();
    __resetWarmMatrixContextForTests();
  });

  it('awaits employeeDayChanged and clears revision soft memo synchronously', async () => {
    const inv = await import('@/lib/booking/cache/HotAvailabilityInvalidation');
    const invalidateSpy = vi.spyOn(inv, 'invalidateOnEffectiveDayChange');

    const { invalidateEmployeeScheduleCachesAsync } = await import(
      '@/lib/hr/scheduleAvailabilityInvalidation'
    );
    const { loadAvailabilityRevisionBatchSoft } = await import(
      '@/lib/booking/cache/WarmMatrixContextCache'
    );

    await loadAvailabilityRevisionBatchSoft({
      employeeIds: [EMP],
      fromBusinessDate: DATE,
      toBusinessDate: shiftCalendarDate(DATE, 13),
    });

    await invalidateEmployeeScheduleCachesAsync({
      empId: EMP,
      workDate: DATE,
      branchIds: [BRANCH_A],
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: EMP,
        branchId: BRANCH_A,
        businessDate: DATE,
        reason: 'schedule_invalidate',
      }),
    );

    const after = await loadAvailabilityRevisionBatchSoft({
      employeeIds: [EMP],
      fromBusinessDate: DATE,
      toBusinessDate: shiftCalendarDate(DATE, 13),
    });
    expect(after.softHit).toBe(false);
  });
});

describe('rollback safety', () => {
  it('rolled-back createDailyAdjustment does not call post-commit invalidation', async () => {
    const invMod = await import('@/lib/hr/scheduleAvailabilityInvalidation');
    const invSpy = vi
      .spyOn(invMod, 'invalidateEmployeeScheduleCachesAsync')
      .mockResolvedValue(undefined);

    vi.doMock('@/lib/db', () => ({
      getPool: async () => ({
        request: () => ({
          input: () => ({ input: () => ({ query: async () => ({ recordset: [] }) }) }),
          query: async () => ({ recordset: [] }),
        }),
      }),
      sql: {
        Transaction: class {
          async begin() {}
          async commit() {
            throw new Error('commit failed');
          }
          async rollback() {}
          request() {
            return {
              input: () => ({
                input: () => ({
                  query: async () => ({
                    recordset: [{ AdjustmentID: 1, CreatedAt: new Date().toISOString() }],
                  }),
                }),
              }),
            };
          }
        },
        Int: 'Int',
        BigInt: 'BigInt',
        Date: 'Date',
        NVarChar: () => 'NVarChar',
        VarChar: () => 'VarChar',
        TinyInt: 'TinyInt',
      },
    }));
    vi.doMock('@/lib/branch/bookingQueueOwnership', () => ({
      isEmployeeEligibleForBranchBookings: async () => true,
    }));
    vi.doMock('@/lib/availability/ensureDailyAdjustmentTables', () => ({
      ensureDailyAdjustmentTables: async () => true,
    }));

    const { createDailyAdjustment } = await import(
      '@/lib/availability/dailyAdjustmentService'
    );

    await expect(
      createDailyAdjustment({
        branchId: BRANCH_A,
        empId: EMP,
        businessDate: DATE,
        adjustmentType: 'CLOSE_DAY',
        createdBy: 1,
      }),
    ).rejects.toThrow();

    expect(invSpy).not.toHaveBeenCalled();
    invSpy.mockRestore();
  });
});
