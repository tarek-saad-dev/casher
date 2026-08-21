/**
 * Booking V2 Phase B8 — Hot Availability Cache + revision invalidation.
 * Cache is NOT authority. Pure / in-memory tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  createAvailabilityRevisionBoard,
  deriveAvailabilityRevision,
} from '@/lib/booking/projection/AvailabilityRevision';
import {
  createHotAvailabilityCache,
  createMemoryHotAvailabilityL2Store,
  composeHotAvailabilityRange,
  invalidateOnBookingCreated,
  invalidateOnBookingCancelled,
  invalidateOnHoldCreated,
  invalidateOnHoldReleasedOrExpired,
  invalidateOnEffectiveDayChange,
  createStaticBootstrapCache,
  BoundedLruCache,
  createSingleFlight,
  type HotAvailabilityDayPayload,
  type HotAvailabilityDayKey,
} from '@/lib/booking/cache';
import { shiftCalendarDate } from '@/lib/businessDate';

const EMP = 42;
const BRANCH_A = 1;
const BRANCH_B = 2;
const DATE = '2026-08-16';

function workMask(fromH = 10, toH = 18): AvailabilityBitmap {
  return AvailabilityBitmap.empty().setRange(fromH * 60, toH * 60);
}

function payloadFromMasks(args: {
  ew: AvailabilityBitmap;
  booking?: AvailabilityBitmap;
  hold?: AvailabilityBitmap;
  queue?: AvailabilityBitmap;
  parts?: { ew?: number; bk?: number; hd?: number; q?: number };
  reusedBaseline?: boolean;
}): HotAvailabilityDayPayload {
  const parts = {
    effectiveWorkRevision: args.parts?.ew ?? 0,
    bookingOccupancyRevision: args.parts?.bk ?? 0,
    holdOccupancyRevision: args.parts?.hd ?? 0,
    queueOccupancyRevision: args.parts?.q ?? 0,
  };
  const composed = AvailabilityComposer.compose({
    effectiveWorkMask: args.ew,
    bookingOccupancyMask: args.booking ?? AvailabilityBitmap.empty(),
    holdOccupancyMask: args.hold ?? AvailabilityBitmap.empty(),
    queueOccupancyMask: args.queue ?? AvailabilityBitmap.empty(),
    revisions: parts,
  });
  return {
    availabilityRevision: deriveAvailabilityRevision(parts),
    parts,
    effectiveWorkMask: composed.effectiveWorkMask,
    bookingOccupancyMask: composed.bookingOccupancyMask,
    holdOccupancyMask: composed.holdOccupancyMask,
    queueOccupancyMask: composed.queueOccupancyMask,
    freeMask: composed.freeMask,
    reusedBaseline: args.reusedBaseline ?? true,
    builtAtMs: Date.now(),
  };
}

function key(date = DATE, branchId = BRANCH_A): HotAvailabilityDayKey {
  return { employeeId: EMP, branchId, businessDate: date };
}

describe('B8 bounded L1', () => {
  it('evicts oldest when maxEntries exceeded', () => {
    const lru = new BoundedLruCache<number>({ maxEntries: 2 });
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe(2);
    expect(lru.get('c')).toBe(3);
    expect(lru.stats().evictions).toBe(1);
  });
});

describe('B8 single-flight coalescing', () => {
  it('20 concurrent misses → 1 rebuild', async () => {
    const flight = createSingleFlight<number>();
    let builds = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        flight.do('k', async () => {
          builds++;
          await new Promise((r) => setTimeout(r, 5));
          return 99;
        }),
      ),
    );
    expect(builds).toBe(1);
    expect(results.every((r) => r.value === 99)).toBe(true);
    expect(results.filter((r) => r.coalesced).length).toBe(19);
  });
});

describe('B8 hot availability cache', () => {
  let rebuildCount = 0;
  let baseFree: HotAvailabilityDayPayload;

  beforeEach(() => {
    rebuildCount = 0;
    baseFree = payloadFromMasks({ ew: workMask() });
  });

  async function rebuild(_k: HotAvailabilityDayKey): Promise<HotAvailabilityDayPayload> {
    rebuildCount++;
    await new Promise((r) => setTimeout(r, 1));
    // Stamp with current board revisions so cache key matches.
    return {
      ...baseFree,
      builtAtMs: Date.now(),
    };
  }

  it('cold miss then warm hit', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    const rev = board.availabilityRevision(EMP, DATE);
    baseFree = {
      ...payloadFromMasks({ ew: workMask() }),
      availabilityRevision: rev,
      parts: {
        effectiveWorkRevision: 0,
        bookingOccupancyRevision: 0,
        holdOccupancyRevision: 0,
        queueOccupancyRevision: 0,
      },
    };

    const cold = await cache.getOrRebuild(k, rebuild);
    expect(cold.source).toBe('rebuild');
    expect(rebuildCount).toBe(1);

    const warm = await cache.getOrRebuild(k, rebuild);
    expect(warm.source).toBe('l1');
    expect(rebuildCount).toBe(1);
    expect(warm.payload.freeMask.equals(baseFree.freeMask)).toBe(true);

    const m = cache.metrics();
    expect(m.hits).toBe(1);
    expect(m.misses).toBe(1);
    expect(m.hitRatio).toBe(0.5);
  });

  it('revision mismatch forces rebuild', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    const syncPayload = () => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      baseFree = {
        ...payloadFromMasks({ ew: workMask(), parts: { ew: parts.effectiveWorkRevision, bk: parts.bookingOccupancyRevision, hd: parts.holdOccupancyRevision, q: parts.queueOccupancyRevision } }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };
    syncPayload();

    await cache.getOrRebuild(k, async () => {
      rebuildCount++;
      syncPayload();
      return { ...baseFree };
    });
    expect(rebuildCount).toBe(1);

    board.bumpBookingOccupancy(EMP, DATE);
    await cache.getOrRebuild(k, async () => {
      rebuildCount++;
      syncPayload();
      return { ...baseFree };
    });
    expect(rebuildCount).toBe(2);
    expect(cache.metrics().revisionMismatches).toBeGreaterThanOrEqual(1);
  });

  it('simultaneous cache miss coalesces', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    const rev = board.availabilityRevision(EMP, DATE);
    baseFree = { ...payloadFromMasks({ ew: workMask() }), availabilityRevision: rev, parts: { effectiveWorkRevision: 0, bookingOccupancyRevision: 0, holdOccupancyRevision: 0, queueOccupancyRevision: 0 } };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => cache.getOrRebuild(k, rebuild)),
    );
    expect(rebuildCount).toBe(1);
    expect(results.some((r) => r.source === 'rebuild')).toBe(true);
    expect(results.some((r) => r.source === 'coalesced')).toBe(true);
    expect(cache.metrics().coalesced).toBeGreaterThanOrEqual(1);
  });

  it('booking invalidation removes slot immediately on next read', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();

    const sync = (bookingOcc?: AvailabilityBitmap) => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          booking: bookingOcc,
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };

    let occupied = false;
    const rb = async () => {
      rebuildCount++;
      return sync(
        occupied
          ? AvailabilityBitmap.empty().setRange(12 * 60, 12 * 60 + 30)
          : undefined,
      );
    };

    const before = await cache.getOrRebuild(k, rb);
    const startsBefore = cache.composeStarts({
      freeMask: before.payload.freeMask,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(startsBefore).toContain(12 * 60);

    occupied = true;
    await invalidateOnBookingCreated(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE },
      cache,
    );

    const after = await cache.getOrRebuild(k, rb);
    expect(after.source).toBe('rebuild');
    const startsAfter = cache.composeStarts({
      freeMask: after.payload.freeMask,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    expect(startsAfter).not.toContain(12 * 60);
  });

  it('cancel restores slot safely', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    let occupied = true;
    const rb = async () => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          booking: occupied
            ? AvailabilityBitmap.empty().setRange(14 * 60, 14 * 60 + 45)
            : undefined,
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };

    await cache.getOrRebuild(k, rb);
    occupied = false;
    await invalidateOnBookingCancelled(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE },
      cache,
    );
    const restored = await cache.getOrRebuild(k, rb);
    const starts = cache.composeStarts({
      freeMask: restored.payload.freeMask,
      durationMinutes: 45,
      slotIntervalMinutes: 15,
    });
    expect(starts).toContain(14 * 60);
  });

  it('hold create removes / release restores', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    let held = false;
    const rb = async () => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          hold: held
            ? AvailabilityBitmap.empty().setRange(11 * 60, 11 * 60 + 30)
            : undefined,
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };

    await cache.getOrRebuild(k, rb);
    held = true;
    await invalidateOnHoldCreated(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE },
      cache,
    );
    let got = await cache.getOrRebuild(k, rb);
    expect(
      cache.composeStarts({
        freeMask: got.payload.freeMask,
        durationMinutes: 30,
        slotIntervalMinutes: 15,
      }),
    ).not.toContain(11 * 60);

    held = false;
    await invalidateOnHoldReleasedOrExpired(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE },
      cache,
    );
    got = await cache.getOrRebuild(k, rb);
    expect(
      cache.composeStarts({
        freeMask: got.payload.freeMask,
        durationMinutes: 30,
        slotIntervalMinutes: 15,
      }),
    ).toContain(11 * 60);
  });

  it('close_day invalidates effective day', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    let closed = false;
    const rb = async () => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      return {
        ...payloadFromMasks({
          ew: closed ? AvailabilityBitmap.empty() : workMask(),
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        reusedBaseline: !closed,
        builtAtMs: Date.now(),
      };
    };

    await cache.getOrRebuild(k, rb);
    closed = true;
    await invalidateOnEffectiveDayChange(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE, reason: 'close_day' },
      cache,
    );
    const got = await cache.getOrRebuild(k, rb);
    expect(got.payload.freeMask.isEmpty()).toBe(true);
    expect(got.payload.reusedBaseline).toBe(false);
  });

  it('cross-branch same EmpID shares occupancy invalidation by emp/date', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const rb = async (k: HotAvailabilityDayKey) => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(k.employeeId, k.businessDate),
        bookingOccupancyRevision: board.bookingOccupancyRevision(k.employeeId, k.businessDate),
        holdOccupancyRevision: board.holdOccupancyRevision(k.employeeId, k.businessDate),
        queueOccupancyRevision: board.queueOccupancyRevision(k.employeeId, k.businessDate),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };

    await cache.getOrRebuild(key(DATE, BRANCH_A), (k) => rb(k));
    await cache.getOrRebuild(key(DATE, BRANCH_B), (k) => rb(k));
    expect(cache.l1Size()).toBe(2);

    // Emp-global bump without branch → invalidate both branch day entries
    await invalidateOnBookingCreated(
      { employeeId: EMP, businessDate: DATE, reason: 'cross_branch' },
      cache,
    );
    expect(cache.getCached(key(DATE, BRANCH_A))).toBeNull();
    expect(cache.getCached(key(DATE, BRANCH_B))).toBeNull();
  });

  it('overnight free range survives in FreeMask (not service slots)', async () => {
    const ew = AvailabilityBitmap.empty().setRange(22 * 60, 26 * 60); // 22:00→02:00
    const p = payloadFromMasks({ ew, reusedBaseline: true });
    const starts = AvailabilityComposer.generateStarts({
      freeMask: p.freeMask,
      durationMinutes: 60,
      slotIntervalMinutes: 15,
    });
    expect(starts).toContain(22 * 60);
    expect(starts).toContain(24 * 60); // midnight+
  });

  it('cache delete + rebuild parity', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    const rb = async () => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };
    const a = await cache.getOrRebuild(k, rb);
    cache.clear();
    const b = await cache.getOrRebuild(k, rb);
    expect(a.payload.freeMask.equals(b.payload.freeMask)).toBe(true);
    expect(a.payload.availabilityRevision).toBe(b.payload.availabilityRevision);
  });

  it('multi-instance: stale L1 ignored when revision bumped (shared L2)', async () => {
    const shared = { map: new Map() };
    const board = createAvailabilityRevisionBoard();
    const l2 = createMemoryHotAvailabilityL2Store(shared);
    const inst1 = createHotAvailabilityCache({
      revisionBoard: board,
      l2,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const inst2 = createHotAvailabilityCache({
      revisionBoard: board,
      l2,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    const rb = async () => {
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(EMP, DATE),
        bookingOccupancyRevision: board.bookingOccupancyRevision(EMP, DATE),
        holdOccupancyRevision: board.holdOccupancyRevision(EMP, DATE),
        queueOccupancyRevision: board.queueOccupancyRevision(EMP, DATE),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };

    await inst1.getOrRebuild(k, rb);
    // Instance2 fills from L2
    const fromL2 = await inst2.getOrRebuild(k, rb);
    expect(fromL2.source === 'l2' || fromL2.source === 'l1').toBe(true);

    await invalidateOnBookingCreated(
      { employeeId: EMP, branchId: BRANCH_A, businessDate: DATE },
      inst1,
    );
    expect(inst1.getCached(k)).toBeNull();
    // Instance2 L1 may still hold a stale copy until next read (process-local).
    expect(inst2.getCached(k)).not.toBeNull();

    let rebuilds = 0;
    const after = await inst2.getOrRebuild(k, async () => {
      rebuilds++;
      return rb();
    });
    expect(rebuilds).toBe(1);
    expect(after.source).toBe('rebuild');
    expect(inst2.metrics().revisionMismatches).toBeGreaterThanOrEqual(1);
  });

  it('14-day warm range is cache lookups + compose', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
      maxEntries: 64,
    });
    const from = DATE;
    const to = shiftCalendarDate(DATE, 13);
    const rb = async (k: HotAvailabilityDayKey) => {
      rebuildCount++;
      const parts = {
        effectiveWorkRevision: board.effectiveWorkRevision(k.employeeId, k.businessDate),
        bookingOccupancyRevision: board.bookingOccupancyRevision(k.employeeId, k.businessDate),
        holdOccupancyRevision: board.holdOccupancyRevision(k.employeeId, k.businessDate),
        queueOccupancyRevision: board.queueOccupancyRevision(k.employeeId, k.businessDate),
      };
      return {
        ...payloadFromMasks({
          ew: workMask(),
          parts: {
            ew: parts.effectiveWorkRevision,
            bk: parts.bookingOccupancyRevision,
            hd: parts.holdOccupancyRevision,
            q: parts.queueOccupancyRevision,
          },
        }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };

    const cold = await composeHotAvailabilityRange({
      cache,
      employeeId: EMP,
      branchId: BRANCH_A,
      fromBusinessDate: from,
      toBusinessDate: to,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      rebuild: rb,
    });
    expect(cold.days).toHaveLength(14);
    expect(cold.cacheMisses).toBe(14);
    const coldRebuilds = rebuildCount;

    rebuildCount = 0;
    const warm = await composeHotAvailabilityRange({
      cache,
      employeeId: EMP,
      branchId: BRANCH_A,
      fromBusinessDate: from,
      toBusinessDate: to,
      durationMinutes: 45, // duration change — no rebuild of masks
      slotIntervalMinutes: 15,
      rebuild: rb,
    });
    expect(warm.cacheHits).toBe(14);
    expect(warm.cacheMisses).toBe(0);
    expect(rebuildCount).toBe(0);
    expect(warm.composeMs).toBeLessThan(50);
    expect(coldRebuilds).toBe(14);
  });

  it('does not cache service-specific slot arrays', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/booking/cache/HotAvailabilityTypes.ts'),
      'utf8',
    );
    expect(src).toContain('freeMask');
    expect(src).not.toMatch(/availableStarts|slotStarts|serviceIds/);
  });
});

describe('B8 static bootstrap cache (separate)', () => {
  it('does not mix with hot availability keys', () => {
    const boot = createStaticBootstrapCache();
    boot.set({
      kind: 'branches',
      scopeKey: 'global',
      revision: '1',
      payload: [{ code: 'GLEEM' }],
      builtAtMs: Date.now(),
    });
    expect(boot.get('branches', 'global')?.payload).toEqual([{ code: 'GLEEM' }]);
    expect(boot.size()).toBe(1);
  });
});

describe('B8 performance targets (app-side, synthetic)', () => {
  it('warm 1 day p95-ish under 30ms; compose << 1ms bulk', async () => {
    const board = createAvailabilityRevisionBoard();
    const cache = createHotAvailabilityCache({
      revisionBoard: board,
      softTtlMs: 60_000,
      allowStaleWhileRevalidate: false,
    });
    const k = key();
    const rb = async () => {
      const parts = {
        effectiveWorkRevision: 0,
        bookingOccupancyRevision: 0,
        holdOccupancyRevision: 0,
        queueOccupancyRevision: 0,
      };
      return {
        ...payloadFromMasks({ ew: workMask() }),
        availabilityRevision: deriveAvailabilityRevision(parts),
        parts,
        builtAtMs: Date.now(),
      };
    };
    await cache.getOrRebuild(k, rb);

    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const got = await cache.getOrRebuild(k, rb);
      cache.composeStarts({
        freeMask: got.payload.freeMask,
        durationMinutes: 30,
        slotIntervalMinutes: 15,
      });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1]!;
    expect(p95).toBeLessThan(30);
  });
});
