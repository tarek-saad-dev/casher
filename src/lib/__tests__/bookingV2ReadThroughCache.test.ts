/**
 * Booking V2 Phase B8.5 — Production Read-Through Hot Cache.
 * Pure / in-memory: warm path avoids full SoT rebuild; batch revision;
 * partial 14-day hits; single-flight; cross-instance revision; cross-branch.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  createAvailabilityRevisionBoard,
  deriveAvailabilityRevision,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';
import {
  createHotAvailabilityCache,
  composeHotAvailabilityRange,
  invalidateOnBookingCreated,
  createSingleFlight,
  hotAvailabilityDayKeyString,
  type HotAvailabilityDayPayload,
  type HotAvailabilityDayKey,
} from '@/lib/booking/cache';
import { shiftCalendarDate } from '@/lib/businessDate';

const EMP = 77;
const BRANCH_A = 1;
const BRANCH_B = 2;
const FROM = '2026-08-16';

function workMask(fromH = 10, toH = 18): AvailabilityBitmap {
  return AvailabilityBitmap.empty().setRange(fromH * 60, toH * 60);
}

function payloadFromParts(
  parts: AvailabilityRevisionParts,
  freeFrom = 10,
  freeTo = 18,
): HotAvailabilityDayPayload {
  const ew = workMask(freeFrom, freeTo);
  const composed = AvailabilityComposer.compose({
    effectiveWorkMask: ew,
    bookingOccupancyMask: AvailabilityBitmap.empty(),
    holdOccupancyMask: AvailabilityBitmap.empty(),
    queueOccupancyMask: AvailabilityBitmap.empty(),
    revisions: parts,
  });
  return {
    availabilityRevision: deriveAvailabilityRevision(parts),
    parts: {
      effectiveWorkRevision: parts.effectiveWorkRevision,
      bookingOccupancyRevision: parts.bookingOccupancyRevision,
      holdOccupancyRevision: parts.holdOccupancyRevision,
      queueOccupancyRevision: parts.queueOccupancyRevision ?? 0,
    },
    effectiveWorkMask: composed.effectiveWorkMask,
    bookingOccupancyMask: composed.bookingOccupancyMask,
    holdOccupancyMask: composed.holdOccupancyMask,
    queueOccupancyMask: composed.queueOccupancyMask,
    freeMask: composed.freeMask,
    reusedBaseline: true,
    builtAtMs: Date.now(),
  };
}

function datesInclusive(from: string, n: number): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < n; i++) {
    out.push(cur);
    cur = shiftCalendarDate(cur, 1);
  }
  return out;
}

/** In-memory stand-in for SQL revision batch (1 "query"). */
function createMemoryRevisionBatch() {
  const map = new Map<string, AvailabilityRevisionParts>();
  let queryCount = 0;
  return {
    loadBatch(employeeIds: number[], from: string, to: string) {
      queryCount++;
      const byKey = new Map<string, AvailabilityRevisionParts>();
      for (const empId of employeeIds) {
        let cur = from;
        while (cur <= to) {
          const k = `${empId}:${cur}`;
          byKey.set(k, map.get(k) ?? {
            effectiveWorkRevision: 0,
            bookingOccupancyRevision: 0,
            holdOccupancyRevision: 0,
            queueOccupancyRevision: 0,
          });
          cur = shiftCalendarDate(cur, 1);
        }
      }
      return { byKey, queryCount: 1 };
    },
    bump(empId: number, date: string, layer: keyof AvailabilityRevisionParts) {
      const k = `${empId}:${date}`;
      const cur = map.get(k) ?? {
        effectiveWorkRevision: 0,
        bookingOccupancyRevision: 0,
        holdOccupancyRevision: 0,
        queueOccupancyRevision: 0,
      };
      const next = { ...cur, [layer]: (cur[layer] as number) + 1 };
      map.set(k, next);
      return next;
    },
    getQueryCount: () => queryCount,
  };
}

/**
 * Read-through algorithm under test (mirrors resolveBookingAvailabilityV2ReadThrough).
 */
async function readThrough(args: {
  cache: ReturnType<typeof createHotAvailabilityCache>;
  rev: ReturnType<typeof createMemoryRevisionBatch>;
  employeeId: number;
  branchId: number;
  from: string;
  to: string;
  rebuildHeavy: () => Promise<HotAvailabilityDayPayload>;
}) {
  const t0 = performance.now();
  let heavyRebuilds = 0;
  const dates = datesInclusive(
    args.from,
    (() => {
      let n = 0;
      let cur = args.from;
      while (cur <= args.to) {
        n++;
        cur = shiftCalendarDate(cur, 1);
      }
      return n;
    })(),
  );

  const batch = args.rev.loadBatch([args.employeeId], args.from, args.to);
  let hit = 0;
  let miss = 0;
  let stale = 0;
  const misses: HotAvailabilityDayKey[] = [];

  for (const businessDate of dates) {
    const parts = batch.byKey.get(`${args.employeeId}:${businessDate}`)!;
    const expected = deriveAvailabilityRevision(parts);
    const key: HotAvailabilityDayKey = {
      employeeId: args.employeeId,
      branchId: args.branchId,
      businessDate,
    };
    const cached = args.cache.getCached(key);
    if (cached && cached.availabilityRevision === expected) {
      hit++;
    } else {
      if (cached) {
        stale++;
        await args.cache.invalidateDay(key, 'revision_mismatch');
      }
      miss++;
      misses.push(key);
    }
  }

  if (misses.length) {
    for (const key of misses) {
      heavyRebuilds++;
      const parts = batch.byKey.get(`${args.employeeId}:${key.businessDate}`)!;
      const expected = deriveAvailabilityRevision(parts);
      const built = await args.rebuildHeavy();
      await args.cache.put(key, {
        ...built,
        parts,
        availabilityRevision: expected,
        builtAtMs: Date.now(),
      });
    }
  }

  return {
    hit,
    miss,
    stale,
    heavyRebuilds,
    revisionQueryCount: batch.queryCount,
    totalMs: performance.now() - t0,
    dayCount: dates.length,
  };
}

describe('B8.5 read-through', () => {
  let rebuildCalls = 0;

  beforeEach(() => {
    rebuildCalls = 0;
  });

  async function heavyRebuild(): Promise<HotAvailabilityDayPayload> {
    rebuildCalls++;
    // Simulate "heavy" SoT cost
    await new Promise((r) => setTimeout(r, 1));
    return payloadFromParts({
      effectiveWorkRevision: 0,
      bookingOccupancyRevision: 0,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    });
  }

  it('1-day cold rebuilds once; warm does 0 heavy rebuilds', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const rev = createMemoryRevisionBatch();

    const cold = await readThrough({
      cache,
      rev,
      employeeId: EMP,
      branchId: BRANCH_A,
      from: FROM,
      to: FROM,
      rebuildHeavy: heavyRebuild,
    });
    expect(cold.heavyRebuilds).toBe(1);
    expect(cold.hit).toBe(0);
    expect(cold.revisionQueryCount).toBe(1);
    const coldRebuilds = rebuildCalls;

    const warm = await readThrough({
      cache,
      rev,
      employeeId: EMP,
      branchId: BRANCH_A,
      from: FROM,
      to: FROM,
      rebuildHeavy: heavyRebuild,
    });
    expect(warm.heavyRebuilds).toBe(0);
    expect(warm.hit).toBe(1);
    expect(rebuildCalls).toBe(coldRebuilds);
    expect(warm.revisionQueryCount).toBe(1);
  });

  it('14-day: batch revision is 1 query; warm rebuilds 0', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const rev = createMemoryRevisionBatch();
    const to = shiftCalendarDate(FROM, 13);

    const cold = await readThrough({
      cache,
      rev,
      employeeId: EMP,
      branchId: BRANCH_A,
      from: FROM,
      to,
      rebuildHeavy: heavyRebuild,
    });
    expect(cold.dayCount).toBe(14);
    expect(cold.heavyRebuilds).toBe(14);
    expect(cold.revisionQueryCount).toBe(1);

    const warm = await readThrough({
      cache,
      rev,
      employeeId: EMP,
      branchId: BRANCH_A,
      from: FROM,
      to,
      rebuildHeavy: heavyRebuild,
    });
    expect(warm.heavyRebuilds).toBe(0);
    expect(warm.hit).toBe(14);
    expect(warm.revisionQueryCount).toBe(1);
  });

  it('14-day partial: only misses rebuild', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const rev = createMemoryRevisionBatch();
    const all = datesInclusive(FROM, 14);
    const to = all[13]!;

    // Warm first 10 days
    for (const d of all.slice(0, 10)) {
      const parts = {
        effectiveWorkRevision: 0,
        bookingOccupancyRevision: 0,
        holdOccupancyRevision: 0,
        queueOccupancyRevision: 0,
      };
      await cache.put(
        { employeeId: EMP, branchId: BRANCH_A, businessDate: d },
        payloadFromParts(parts),
      );
    }

    const result = await readThrough({
      cache,
      rev,
      employeeId: EMP,
      branchId: BRANCH_A,
      from: FROM,
      to,
      rebuildHeavy: heavyRebuild,
    });
    expect(result.hit).toBe(10);
    expect(result.miss).toBe(4);
    expect(result.heavyRebuilds).toBe(4);
    expect(result.revisionQueryCount).toBe(1);
  });

  it('20 concurrent same range → single-flight (1 rebuild batch)', async () => {
    const flight = createSingleFlight<{ heavy: number }>();
    let heavy = 0;
    const run = () =>
      flight.do('emp77|14d', async () => {
        heavy++;
        await new Promise((r) => setTimeout(r, 5));
        return { heavy };
      });

    const results = await Promise.all(Array.from({ length: 20 }, () => run()));
    expect(heavy).toBe(1);
    expect(results.filter((r) => r.coalesced).length).toBe(19);
    expect(results.every((r) => r.value.heavy === 1)).toBe(true);
  });

  it('cross-instance: SQL revision bump prevents serving stale L1', async () => {
    const boardA = createAvailabilityRevisionBoard();
    const cacheA = createHotAvailabilityCache({
      revisionBoard: boardA,
      softTtlMs: 60_000,
    });
    const boardB = createAvailabilityRevisionBoard();
    const cacheB = createHotAvailabilityCache({
      revisionBoard: boardB,
      softTtlMs: 60_000,
    });

    const rev = createMemoryRevisionBatch();
    const parts0 = {
      effectiveWorkRevision: 0,
      bookingOccupancyRevision: 0,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    };
    const key: HotAvailabilityDayKey = {
      employeeId: EMP,
      branchId: BRANCH_A,
      businessDate: FROM,
    };
    const p0 = payloadFromParts(parts0);
    await cacheA.put(key, p0);
    await cacheB.put(key, p0);

    // Instance A writes booking → bumps shared SQL revision
    rev.bump(EMP, FROM, 'bookingOccupancyRevision');
    await invalidateOnBookingCreated(
      { employeeId: EMP, businessDate: FROM, branchId: BRANCH_A },
      cacheA,
    );

    // Instance B still has L1 entry, but shared revision says stale
    const batch = rev.loadBatch([EMP], FROM, FROM);
    const expected = deriveAvailabilityRevision(
      batch.byKey.get(`${EMP}:${FROM}`)!,
    );
    const cachedB = cacheB.getCached(key);
    expect(cachedB).not.toBeNull();
    expect(cachedB!.availabilityRevision).not.toBe(expected);

    // Read-through on B must rebuild, not serve stale
    let rebuilt = 0;
    const rt = await readThrough({
      cache: cacheB,
      rev,
      employeeId: EMP,
      branchId: BRANCH_A,
      from: FROM,
      to: FROM,
      rebuildHeavy: async () => {
        rebuilt++;
        return payloadFromParts(
          batch.byKey.get(`${EMP}:${FROM}`)!,
        );
      },
    });
    expect(rt.stale).toBe(1);
    expect(rebuilt).toBe(1);
    expect(cacheB.getCached(key)!.availabilityRevision).toBe(expected);
  });

  it('cross-branch: booking on branch A invalidates Emp day on branch B', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const parts = {
      effectiveWorkRevision: 0,
      bookingOccupancyRevision: 0,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    };
    await cache.put(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: FROM },
      payloadFromParts(parts),
    );
    await cache.put(
      { employeeId: EMP, branchId: BRANCH_B, businessDate: FROM },
      payloadFromParts(parts),
    );

    await invalidateOnBookingCreated(
      {
        employeeId: EMP,
        businessDate: FROM,
        branchId: BRANCH_A,
        reason: 'cross_branch',
      },
      cache,
    );

    expect(
      cache.getCached({
        employeeId: EMP,
        branchId: BRANCH_A,
        businessDate: FROM,
      }),
    ).toBeNull();
    expect(
      cache.getCached({
        employeeId: EMP,
        branchId: BRANCH_B,
        businessDate: FROM,
      }),
    ).toBeNull();
  });

  it('composeHotAvailabilityRange: partial hits + coalesce miss rebuild', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const all = datesInclusive(FROM, 14);
    const to = all[13]!;
    let rebuildBatches = 0;
    let rebuildKeys = 0;

    for (const d of all.slice(0, 11)) {
      await cache.put(
        { employeeId: EMP, branchId: BRANCH_A, businessDate: d },
        payloadFromParts({
          effectiveWorkRevision: 0,
          bookingOccupancyRevision: 0,
          holdOccupancyRevision: 0,
          queueOccupancyRevision: 0,
        }),
      );
    }

    const expectedRevisionForDate = () =>
      deriveAvailabilityRevision({
        effectiveWorkRevision: 0,
        bookingOccupancyRevision: 0,
        holdOccupancyRevision: 0,
        queueOccupancyRevision: 0,
      });

    const range = await composeHotAvailabilityRange({
      cache,
      employeeId: EMP,
      branchId: BRANCH_A,
      fromBusinessDate: FROM,
      toBusinessDate: to,
      durationMinutes: 30,
      expectedRevisionForDate,
      rebuild: async (key) => {
        rebuildKeys++;
        return payloadFromParts({
          effectiveWorkRevision: 0,
          bookingOccupancyRevision: 0,
          holdOccupancyRevision: 0,
          queueOccupancyRevision: 0,
        });
      },
      rebuildMissKeys: async (keys) => {
        rebuildBatches++;
        const map = new Map<string, HotAvailabilityDayPayload>();
        for (const key of keys) {
          rebuildKeys++;
          map.set(
            hotAvailabilityDayKeyString(key),
            payloadFromParts({
              effectiveWorkRevision: 0,
              bookingOccupancyRevision: 0,
              holdOccupancyRevision: 0,
              queueOccupancyRevision: 0,
            }),
          );
        }
        return map;
      },
    });

    expect(range.cacheHits).toBe(11);
    expect(range.cacheMisses).toBe(3);
    expect(range.rebuildCount).toBe(3);
    expect(rebuildBatches).toBe(1);
    expect(rebuildKeys).toBe(3);
    expect(range.days).toHaveLength(14);
  });

  it('cache delete + rebuild parity (same free starts)', async () => {
    const cache = createHotAvailabilityCache({ softTtlMs: 60_000 });
    const key: HotAvailabilityDayKey = {
      employeeId: EMP,
      branchId: BRANCH_A,
      businessDate: FROM,
    };
    const p = payloadFromParts({
      effectiveWorkRevision: 1,
      bookingOccupancyRevision: 2,
      holdOccupancyRevision: 0,
      queueOccupancyRevision: 0,
    });
    await cache.put(key, p);
    const startsBefore = AvailabilityComposer.generateStarts({
      freeMask: cache.getCached(key)!.freeMask,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });

    await cache.invalidateDay(key, 'delete');
    expect(cache.getCached(key)).toBeNull();

    await cache.put(key, { ...p, builtAtMs: Date.now() });
    const startsAfter = AvailabilityComposer.generateStarts({
      freeMask: cache.getCached(key)!.freeMask,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(startsAfter).toEqual(startsBefore);
  });
});

describe('B8.5 artifacts + wiring', () => {
  it('SQL revision migration exists', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'db/migrations/create-booking-availability-revision.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('TblBookingAvailabilityRevision');
    expect(sql).toContain('EffectiveWorkRevision');
    expect(sql).toContain('BookingOccupancyRevision');
  });

  it('live resolver is read-through (revision before rebuild)', () => {
    const src = readFileSync(
      join(
        process.cwd(),
        'src/lib/booking/projection/resolveBookingAvailabilityV2Live.ts',
      ),
      'utf8',
    );
    expect(src).toContain('resolveBookingAvailabilityV2ReadThrough');
    expect(src).toContain('rebuildHotPayloadsForMissKeys');
    expect(src).toContain('hotCacheHit');
    expect(src).toContain('revisionLookupMs');
    expect(src).toContain('rebuildDbMs');
    // Read-through body: revision batch then miss rebuild (not full DB then warm).
    const rtStart = src.indexOf('async function resolveBookingAvailabilityV2ReadThrough');
    const rt = src.slice(rtStart);
    const revIdx = rt.indexOf('await revStore.loadBatch');
    const rebuildIdx = rt.indexOf('await rebuildHotPayloadsForMissKeys');
    expect(revIdx).toBeGreaterThan(-1);
    expect(rebuildIdx).toBeGreaterThan(-1);
    expect(revIdx).toBeLessThan(rebuildIdx);
  });

  it('hot cache flag gates read-through; kill switch via READ_MODE', () => {
    const cutover = readFileSync(
      join(
        process.cwd(),
        'src/lib/booking/projection/bookingV2ReadCutover.ts',
      ),
      'utf8',
    );
    expect(cutover).toContain('BOOKING_V2_READ_MODE');
    expect(cutover).toContain('legacy');
    const flag = readFileSync(
      join(process.cwd(), 'src/lib/booking/cache/buildHotDayPayload.ts'),
      'utf8',
    );
    expect(flag).toContain('BOOKING_V2_HOT_CACHE');
  });

  it('write-path invalidation wiring present', () => {
    const files: Array<[string, string]> = [
      ['src/lib/booking/publicBookingCreate.ts', 'invalidateOnBookingCreated'],
      [
        'src/lib/booking/publicBookingCancellation.ts',
        'invalidateOnBookingCancelled',
      ],
      [
        'src/lib/bookingRescheduleCore.ts',
        'invalidateOnBookingRescheduled',
      ],
      ['src/lib/booking/bookingHold.ts', 'invalidateOnHoldCreated'],
      [
        'src/lib/hr/attendance-shift-schedule-sync.ts',
        'notifyHotEffectiveDay',
      ],
      [
        'src/lib/hr/attendance-break-schedule-sync.ts',
        'notifyHotEffectiveDay',
      ],
      [
        'src/lib/hr/employeeBranchScheduleSave.ts',
        'notifyHotWeeklyBaseline',
      ],
      [
        'src/lib/operationsQueueCreateCore.ts',
        'notifyHotQueueChanged',
      ],
      [
        'src/lib/availability/dailyAdjustmentService.ts',
        'invalidateEmployeeScheduleCaches',
      ],
      [
        'src/lib/availability/branchExceptionalHours.ts',
        'notifyHotBranchHours',
      ],
      ['src/lib/branch/updateBranchSetup.ts', 'notifyHotBranchHours'],
    ];
    for (const [rel, needle] of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).toContain(needle);
    }
  });
});
