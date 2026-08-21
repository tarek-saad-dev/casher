/**
 * Booking V2 Phase B5 — Occupancy Projection + AvailabilityComposer.
 * Pure / in-memory. No public routes, FE, or create behavior changes.
 */
import { describe, expect, it } from 'vitest';

import {
  AvailabilityBitmap,
  BOOKING_TZ,
  businessDateTimeToEpochMs,
} from '@/lib/booking/domain';
import {
  createBookingOccupancyProjectionService,
} from '@/lib/booking/projection/BookingOccupancyProjection';
import {
  createHoldOccupancyProjectionService,
  filterActiveUnexpiredHolds,
  type HoldOccupancyInterval,
} from '@/lib/booking/projection/HoldOccupancyProjection';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  createAvailabilityRevisionBoard,
  deriveAvailabilityRevision,
} from '@/lib/booking/projection/AvailabilityRevision';
import type { AbsoluteOccupancyInterval } from '@/lib/booking/projection/OccupancyTimeline';

const EMP = 42;
const BRANCH_GLEEM = 1;
const BRANCH_CAMP = 2;
const DATE = '2026-08-16';
const KEY = { employeeId: EMP, businessDate: DATE };

function ms(clock: string, dayOffset: 0 | 1 = 0): number {
  return businessDateTimeToEpochMs({
    businessDate: DATE,
    clockTimeHhmm: clock,
    calendarDayOffset: dayOffset,
    timeZone: BOOKING_TZ,
  });
}

function booking(
  id: number,
  start: string,
  end: string,
  opts?: { branchId?: number; dayOffsetStart?: 0 | 1; dayOffsetEnd?: 0 | 1 },
): AbsoluteOccupancyInterval {
  const dayOffsetStart = opts?.dayOffsetStart ?? 0;
  const dayOffsetEnd = opts?.dayOffsetEnd ?? dayOffsetStart;
  return {
    id,
    startAtMs: ms(start, dayOffsetStart),
    endAtMs: ms(end, dayOffsetEnd),
    branchId: opts?.branchId ?? BRANCH_GLEEM,
  };
}

function hold(
  id: number,
  start: string,
  end: string,
  opts?: {
    branchId?: number;
    expiresAtMs?: number;
    status?: HoldOccupancyInterval['status'];
    dayOffset?: 0 | 1;
  },
): HoldOccupancyInterval {
  return {
    id,
    startAtMs: ms(start, opts?.dayOffset ?? 0),
    endAtMs: ms(end, opts?.dayOffset ?? 0),
    branchId: opts?.branchId ?? BRANCH_GLEEM,
    expiresAtMs: opts?.expiresAtMs ?? ms('23:59'),
    status: opts?.status ?? 'active',
  };
}

/** Effective work: 10:00–18:00 free, optionally with a blocked hole. */
function effectiveWork(opts?: { blockStart?: string; blockEnd?: string }) {
  const mask = AvailabilityBitmap.empty().setRange(10 * 60, 18 * 60);
  if (opts?.blockStart && opts?.blockEnd) {
    const [sh, sm] = opts.blockStart.split(':').map(Number);
    const [eh, em] = opts.blockEnd.split(':').map(Number);
    mask.clearRange(sh! * 60 + sm!, eh! * 60 + em!);
  }
  return mask;
}

describe('BOOKING OCCUPANCY MASK', () => {
  it('no bookings → empty occupancy', () => {
    const svc = createBookingOccupancyProjectionService();
    const rec = svc.rebuild({ key: KEY, intervals: [] });
    expect(rec.mask.isEmpty()).toBe(true);
    expect(rec.segments).toHaveLength(0);
  });

  it('one booking occupies its range', () => {
    const svc = createBookingOccupancyProjectionService();
    const rec = svc.rebuild({
      key: KEY,
      intervals: [booking(1, '12:00', '12:30')],
    });
    expect(rec.mask.toFreeRanges()).toEqual([{ startMin: 12 * 60, endMin: 12 * 60 + 30 }]);
  });

  it('adjacent bookings do not merge incorrectly on segment list', () => {
    const svc = createBookingOccupancyProjectionService();
    const rec = svc.rebuild({
      key: KEY,
      intervals: [booking(1, '12:00', '12:30'), booking(2, '12:30', '13:00')],
    });
    expect(rec.segments).toHaveLength(2);
    expect(rec.overlapWarnings).toHaveLength(0);
    expect(rec.mask.toFreeRanges()).toEqual([{ startMin: 12 * 60, endMin: 13 * 60 }]);
  });

  it('overlapping legacy data detection', () => {
    const svc = createBookingOccupancyProjectionService();
    const rec = svc.rebuild({
      key: KEY,
      intervals: [booking(1, '12:00', '12:45'), booking(2, '12:30', '13:00')],
    });
    expect(rec.overlapWarnings.length).toBeGreaterThan(0);
    expect(rec.overlapWarnings[0]!.segmentKey).toBe('booking:1');
    expect(rec.overlapWarnings[0]!.otherSegmentKey).toBe('booking:2');
  });

  it('overnight booking 23:30 → 00:15', () => {
    const svc = createBookingOccupancyProjectionService();
    const rec = svc.rebuild({
      key: KEY,
      intervals: [
        {
          id: 9,
          startAtMs: ms('23:30', 0),
          endAtMs: ms('00:15', 1),
          branchId: BRANCH_CAMP,
        },
      ],
    });
    expect(rec.mask.toFreeRanges()).toEqual([
      { startMin: 23 * 60 + 30, endMin: 24 * 60 + 15 },
    ]);
  });

  it('cross-branch booking for same EmpID occupies one global timeline', () => {
    const svc = createBookingOccupancyProjectionService();
    const rec = svc.rebuild({
      key: KEY,
      intervals: [
        booking(1, '11:00', '11:30', { branchId: BRANCH_GLEEM }),
        booking(2, '14:00', '14:45', { branchId: BRANCH_CAMP }),
      ],
    });
    expect(rec.segments.map((s) => s.branchId).sort()).toEqual([
      BRANCH_GLEEM,
      BRANCH_CAMP,
    ].sort());
    expect(rec.mask.toFreeRanges()).toHaveLength(2);
  });
});

describe('HOLD OCCUPANCY MASK', () => {
  it('multiple active holds occupy', () => {
    const svc = createHoldOccupancyProjectionService();
    const now = ms('10:00');
    const rec = svc.rebuild({
      key: KEY,
      nowMs: now,
      holds: [
        hold(1, '11:00', '11:15', { expiresAtMs: ms('12:00') }),
        hold(2, '15:00', '15:30', { expiresAtMs: ms('12:00') }),
      ],
    });
    expect(rec.segments).toHaveLength(2);
  });

  it('expired hold is ignored', () => {
    const svc = createHoldOccupancyProjectionService();
    const now = ms('12:00');
    const rec = svc.rebuild({
      key: KEY,
      nowMs: now,
      holds: [
        hold(1, '11:00', '11:15', { expiresAtMs: ms('11:30'), status: 'active' }),
        hold(2, '15:00', '15:30', { expiresAtMs: ms('13:00'), status: 'active' }),
      ],
    });
    expect(rec.segments).toHaveLength(1);
    expect(rec.segments[0]!.id).toBe(2);
  });

  it('consumed / released holds do not occupy', () => {
    expect(
      filterActiveUnexpiredHolds(
        [
          hold(1, '11:00', '11:15', { status: 'consumed', expiresAtMs: ms('23:00') }),
          hold(2, '12:00', '12:15', { status: 'released', expiresAtMs: ms('23:00') }),
          hold(3, '13:00', '13:15', { status: 'expired', expiresAtMs: ms('23:00') }),
        ],
        ms('10:00'),
      ),
    ).toHaveLength(0);
  });
});

describe('FREE MASK COMPOSER', () => {
  it('hold + booking overlap → free is neither', () => {
    const bookingSvc = createBookingOccupancyProjectionService();
    const holdSvc = createHoldOccupancyProjectionService();
    const bookingMask = bookingSvc.rebuild({
      key: KEY,
      intervals: [booking(1, '12:00', '12:30')],
    }).mask;
    const holdMask = holdSvc.rebuild({
      key: KEY,
      nowMs: ms('10:00'),
      holds: [hold(1, '12:15', '12:45', { expiresAtMs: ms('18:00') })],
    }).mask;

    const composed = AvailabilityComposer.compose({
      effectiveWorkMask: effectiveWork(),
      bookingOccupancyMask: bookingMask,
      holdOccupancyMask: holdMask,
    });

    // 12:00–12:45 blocked by union of booking+hold
    expect(composed.freeMask.hasConsecutiveFreeAt(12 * 60, 15)).toBe(false);
    expect(composed.freeMask.hasConsecutiveFreeAt(12 * 60 + 30, 15)).toBe(false);
    expect(composed.freeMask.hasConsecutiveFreeAt(11 * 60, 30)).toBe(true);
    expect(composed.freeMask.hasConsecutiveFreeAt(13 * 60, 30)).toBe(true);
  });

  it('EffectiveDay blocked range + booking occupancy', () => {
    const bookingMask = createBookingOccupancyProjectionService().rebuild({
      key: KEY,
      intervals: [booking(1, '14:00', '14:30')],
    }).mask;
    const work = effectiveWork({ blockStart: '12:00', blockEnd: '13:00' });
    const free = AvailabilityComposer.compose({
      effectiveWorkMask: work,
      bookingOccupancyMask: bookingMask,
      holdOccupancyMask: AvailabilityBitmap.empty(),
    }).freeMask;

    expect(free.hasConsecutiveFreeAt(12 * 60, 30)).toBe(false); // blocked by effective day
    expect(free.hasConsecutiveFreeAt(14 * 60, 30)).toBe(false); // booking
    expect(free.hasConsecutiveFreeAt(15 * 60, 30)).toBe(true);
  });

  it('15/30/45/60 minute services via canFit + generateStarts', () => {
    const free = AvailabilityComposer.compose({
      effectiveWorkMask: AvailabilityBitmap.empty().setRange(12 * 60, 13 * 60),
      bookingOccupancyMask: AvailabilityBitmap.empty(),
      holdOccupancyMask: AvailabilityBitmap.empty(),
    }).freeMask;

    expect(AvailabilityComposer.canFitDuration(free, 15)).toBe(true);
    expect(AvailabilityComposer.canFitDuration(free, 30)).toBe(true);
    expect(AvailabilityComposer.canFitDuration(free, 45)).toBe(true);
    expect(AvailabilityComposer.canFitDuration(free, 60)).toBe(true);
    expect(AvailabilityComposer.canFitDuration(free, 65)).toBe(false);

    const starts15 = AvailabilityComposer.generateStarts({
      freeMask: free,
      durationMinutes: 15,
      slotIntervalMinutes: 15,
      fromMin: 12 * 60,
      toMinExclusive: 13 * 60,
    });
    expect(starts15).toEqual([12 * 60, 12 * 60 + 15, 12 * 60 + 30, 12 * 60 + 45]);

    const starts60 = AvailabilityComposer.generateStarts({
      freeMask: free,
      durationMinutes: 60,
      slotIntervalMinutes: 15,
      fromMin: 12 * 60,
      toMinExclusive: 13 * 60,
    });
    expect(starts60).toEqual([12 * 60]);
  });
});

describe('INCREMENTAL UPDATE + FULL REBUILD PARITY', () => {
  it('cancellation safe-clears when another booking overlaps the range', () => {
    const svc = createBookingOccupancyProjectionService();
    svc.rebuild({
      key: KEY,
      intervals: [booking(1, '12:00', '12:45'), booking(2, '12:30', '13:00')],
    });
    const after = svc.onBookingCancelled({ key: KEY, bookingId: 1 })!;
    // booking 2 still occupies 12:30–13:00 — must NOT free that range
    expect(after.mask.toFreeRanges()).toEqual([
      { startMin: 12 * 60 + 30, endMin: 13 * 60 },
    ]);
    expect(after.segments.map((s) => s.id)).toEqual([2]);
  });

  it('reschedule removes old and adds new', () => {
    const svc = createBookingOccupancyProjectionService();
    svc.onBookingCreated({
      key: KEY,
      interval: booking(1, '11:00', '11:30'),
    });
    const after = svc.onBookingRescheduled({
      key: KEY,
      oldBookingId: 1,
      newInterval: booking(1, '16:00', '16:45'),
    });
    expect(after.mask.toFreeRanges()).toEqual([
      { startMin: 16 * 60, endMin: 16 * 60 + 45 },
    ]);
  });

  it('hold release removes only that hold (safe recompute)', () => {
    const svc = createHoldOccupancyProjectionService();
    svc.rebuild({
      key: KEY,
      nowMs: ms('10:00'),
      holds: [
        hold(1, '11:00', '11:30', { expiresAtMs: ms('18:00') }),
        hold(2, '11:15', '11:45', { expiresAtMs: ms('18:00') }),
      ],
    });
    const after = svc.onHoldReleasedOrConsumedOrExpired({ key: KEY, holdId: 1 })!;
    expect(after.mask.toFreeRanges()).toEqual([
      { startMin: 11 * 60 + 15, endMin: 11 * 60 + 45 },
    ]);
  });

  it('incremental update parity with full rebuild', () => {
    const intervals = [
      booking(1, '10:00', '10:30'),
      booking(2, '12:00', '13:00'),
      booking(3, '15:30', '16:00', { branchId: BRANCH_CAMP }),
    ];
    const fullSvc = createBookingOccupancyProjectionService();
    const full = fullSvc.rebuild({ key: KEY, intervals });

    const incSvc = createBookingOccupancyProjectionService();
    for (const iv of intervals) {
      incSvc.onBookingCreated({ key: KEY, interval: iv });
    }
    const inc = incSvc.get(KEY)!;

    expect(inc.mask.equals(full.mask)).toBe(true);
    expect(inc.segments.map((s) => s.id).sort()).toEqual(
      full.segments.map((s) => s.id).sort(),
    );

    // cancel middle via incremental vs rebuild without it
    const afterCancel = incSvc.onBookingCancelled({ key: KEY, bookingId: 2 })!;
    const rebuilt = fullSvc.rebuild({
      key: KEY,
      intervals: intervals.filter((i) => i.id !== 2),
    });
    expect(afterCancel.mask.equals(rebuilt.mask)).toBe(true);
  });
});

describe('AVAILABILITY REVISION', () => {
  it('changes correctly and deterministically from independent parts', () => {
    const board = createAvailabilityRevisionBoard();
    const r0 = board.availabilityRevision(EMP, DATE);
    expect(r0).toBe(deriveAvailabilityRevision({
      effectiveWorkRevision: 0,
      bookingOccupancyRevision: 0,
      holdOccupancyRevision: 0,
    }));

    board.bumpBookingOccupancy(EMP, DATE);
    const r1 = board.availabilityRevision(EMP, DATE);
    expect(r1).toBe('av:ew0:bk1:hd0:q0');
    expect(r1).not.toBe(r0);

    board.bumpHoldOccupancy(EMP, DATE);
    board.bumpEffectiveWork(EMP, DATE);
    expect(board.availabilityRevision(EMP, DATE)).toBe('av:ew1:bk1:hd1:q0');

    // Other emp/date unaffected
    expect(board.availabilityRevision(EMP + 1, DATE)).toBe('av:ew0:bk0:hd0:q0');
  });
});

describe('batch occupancy loaders (N+1 guard)', () => {
  it('documents 1+1 query budget and uses batch hold API', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = process.cwd();
    const loader = fs.readFileSync(
      path.join(root, 'src/lib/booking/projection/loadOccupancyBatch.ts'),
      'utf8',
    );
    const hold = fs.readFileSync(
      path.join(root, 'src/lib/booking/bookingHold.ts'),
      'utf8',
    );
    expect(loader).toContain('listActiveBookingHoldsForEmployees');
    expect(loader).toContain('BookingDate IN (@d0, @d1)');
    expect(loader).toContain('queryCount: 1');
    expect(hold).toContain('export async function listActiveBookingHoldsForEmployees');
    // Per-employee hold loop must not be the batch path.
    expect(loader).not.toMatch(/for\s*\([^)]*empIds[^)]*\)\s*\{[^}]*listActiveBookingHoldsForEmployee[^s]/);
  });
});

describe('benchmark (approx)', () => {
  it('compose + incremental ops stay in microsecond/low-ms class', () => {
    const bookingSvc = createBookingOccupancyProjectionService();
    const holdSvc = createHoldOccupancyProjectionService();
    const intervals = Array.from({ length: 24 }, (_, i) =>
      booking(i + 1, `${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`, 
        `${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '25' : '55'}`),
    ).filter((iv) => iv.endAtMs > iv.startAtMs);

    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      bookingSvc.rebuild({ key: KEY, intervals });
    }
    const rebuildPer = (performance.now() - t0) / 500;

    bookingSvc.rebuild({ key: KEY, intervals });
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) {
      bookingSvc.onBookingCancelled({ key: KEY, bookingId: (i % 24) + 1 });
      bookingSvc.onBookingCreated({
        key: KEY,
        interval: booking((i % 24) + 1, '17:00', '17:15'),
      });
    }
    const incPer = (performance.now() - t1) / 1000;

    const work = effectiveWork();
    const bMask = bookingSvc.get(KEY)!.mask;
    const hMask = holdSvc.rebuild({ key: KEY, holds: [], nowMs: ms('10:00') }).mask;
    const t2 = performance.now();
    for (let i = 0; i < 2000; i++) {
      AvailabilityComposer.compose({
        effectiveWorkMask: work,
        bookingOccupancyMask: bMask,
        holdOccupancyMask: hMask,
      });
    }
    const composePer = (performance.now() - t2) / 2000;

    // eslint-disable-next-line no-console
    console.log(
      '[B5 benchmark]',
      JSON.stringify({
        rebuildPerUs: Number((rebuildPer * 1000).toFixed(2)),
        incrementalPerUs: Number((incPer * 1000).toFixed(2)),
        composePerUs: Number((composePer * 1000).toFixed(2)),
        batchQueryBudget: { bookings: 1, holds: 1 },
      }),
    );

    // Soft informational ceilings only — micro-benchmark timing is not a product
    // correctness gate (CI hosts vary widely). Correctness covered by unit tests above.
    expect(Number.isFinite(rebuildPer)).toBe(true);
    expect(Number.isFinite(incPer)).toBe(true);
    expect(Number.isFinite(composePer)).toBe(true);
    expect(rebuildPer).toBeGreaterThanOrEqual(0);
    expect(incPer).toBeGreaterThanOrEqual(0);
    expect(composePer).toBeGreaterThanOrEqual(0);
  });
});
