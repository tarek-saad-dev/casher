/**
 * Booking V2 Phase B6 — Transactional Slot Claim Engine.
 * Memory-store concurrency + interval semantics. No public write cutover.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createBookingSlotClaimMemoryStore } from '@/lib/booking/claims/BookingSlotClaimMemoryStore';
import { createBookingSlotClaimService } from '@/lib/booking/claims/BookingSlotClaimService';
import {
  absoluteSlotStartsForInterval,
  findOverlappingIntervalPairs,
  SLOT_CLAIM_QUANTUM_MS,
} from '@/lib/booking/claims/slotClaimMath';
import {
  SlotClaimConflictError,
  isSlotClaimConflictError,
} from '@/lib/booking/claims/BookingSlotClaimTypes';
import {
  backfillBookingSlotClaims,
  scanLegacyBookingOverlaps,
  type LegacyBookingInterval,
} from '@/lib/booking/claims/slotClaimBackfill';
import {
  resolveBookingSlotClaimsMode,
  isBookingSlotClaimsEnforced,
} from '@/lib/booking/claims/BookingSlotClaimFlags';

const EMP = 77;
const BRANCH_A = 1;
const BRANCH_B = 2;

function at(h: number, m = 0): Date {
  // Fixed UTC base: 2026-08-16T00:00:00.000Z
  return new Date(Date.UTC(2026, 7, 16, h, m, 0, 0));
}

describe('B6 slot claim math', () => {
  it('expands intervals into 5-minute units (half-open)', () => {
    const slots = absoluteSlotStartsForInterval({
      startAt: at(10, 0),
      endAt: at(10, 15),
    });
    expect(slots).toHaveLength(3);
    expect(slots[1]! - slots[0]!).toBe(SLOT_CLAIM_QUANTUM_MS);
  });

  it('adjacent intervals share no slots', () => {
    const a = absoluteSlotStartsForInterval({ startAt: at(10, 0), endAt: at(10, 30) });
    const b = absoluteSlotStartsForInterval({ startAt: at(10, 30), endAt: at(11, 0) });
    expect(a.some((s) => b.includes(s))).toBe(false);
  });

  it('overlapping intervals share slots', () => {
    const a = absoluteSlotStartsForInterval({ startAt: at(10, 0), endAt: at(10, 30) });
    const b = absoluteSlotStartsForInterval({ startAt: at(10, 15), endAt: at(10, 45) });
    expect(a.filter((s) => b.includes(s)).length).toBeGreaterThan(0);
  });

  it('overnight spans midnight UTC', () => {
    const start = new Date(Date.UTC(2026, 7, 16, 23, 0));
    const end = new Date(Date.UTC(2026, 7, 17, 1, 0));
    const slots = absoluteSlotStartsForInterval({ startAt: start, endAt: end });
    expect(slots.length).toBe(24);
  });
});

describe('B6 feature flags', () => {
  it('defaults to off', () => {
    expect(resolveBookingSlotClaimsMode({})).toBe('off');
    expect(isBookingSlotClaimsEnforced({})).toBe(false);
  });

  it('parses shadow and enforce', () => {
    expect(resolveBookingSlotClaimsMode({ BOOKING_V2_SLOT_CLAIMS_MODE: 'shadow' })).toBe(
      'shadow',
    );
    expect(resolveBookingSlotClaimsMode({ BOOKING_V2_SLOT_CLAIMS_MODE: 'enforce' })).toBe(
      'enforce',
    );
  });
});

describe('B6 BookingSlotClaimService', () => {
  it('100 concurrent holds for same slot → exactly 1 success', async () => {
    const store = createBookingSlotClaimMemoryStore();
    const svc = createBookingSlotClaimService({ store });
    const startAt = at(12, 0);
    const endAt = at(12, 30);

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        svc.claimHoldInterval({
          empId: EMP,
          branchId: BRANCH_A,
          startAt,
          endAt,
          holdToken: `hold-${i}`,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(99);
    expect(
      fail.every(
        (r) =>
          r.status === 'rejected' &&
          isSlotClaimConflictError(r.reason) &&
          r.reason.code === 'HOLD_CONFLICT',
      ),
    ).toBe(true);
  });

  it('same EmpID cross-branch → conflict', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimHoldInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(9, 0),
      endAt: at(9, 30),
      holdToken: 'a',
    });
    await expect(
      svc.claimHoldInterval({
        empId: EMP,
        branchId: BRANCH_B,
        startAt: at(9, 0),
        endAt: at(9, 30),
        holdToken: 'b',
      }),
    ).rejects.toMatchObject({ code: 'HOLD_CONFLICT' });
  });

  it('adjacent intervals allowed; overlapping conflict', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimBookingInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(14, 0),
      endAt: at(14, 30),
      bookingId: 1,
    });
    await expect(
      svc.claimBookingInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(14, 30),
        endAt: at(15, 0),
        bookingId: 2,
      }),
    ).resolves.toMatchObject({ slots: 6 });
    await expect(
      svc.claimBookingInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(14, 15),
        endAt: at(14, 45),
        bookingId: 3,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_CLAIM_CONFLICT' });
  });

  it('expired hold can be reused', async () => {
    let now = Date.UTC(2026, 7, 16, 10, 0, 0, 0);
    const store = createBookingSlotClaimMemoryStore({ nowMs: () => now });
    const svc = createBookingSlotClaimService({ store });
    await svc.claimHoldInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(16, 0),
      endAt: at(16, 20),
      holdToken: 'old',
      ttlMs: 60_000,
      nowMs: now,
    });
    now += 120_000;
    await expect(
      svc.claimHoldInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(16, 0),
        endAt: at(16, 20),
        holdToken: 'new',
        ttlMs: 60_000,
        nowMs: now,
      }),
    ).resolves.toMatchObject({ slots: 4 });
  });

  it('atomic HOLD → BOOKING conversion (no release window)', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimHoldInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(11, 0),
      endAt: at(11, 25),
      holdToken: 'tok',
    });
    const n = await svc.convertHoldToBookingClaims({
      holdToken: 'tok',
      bookingId: 99,
    });
    expect(n).toBe(5);
    await expect(
      svc.claimHoldInterval({
        empId: EMP,
        branchId: BRANCH_B,
        startAt: at(11, 0),
        endAt: at(11, 25),
        holdToken: 'other',
      }),
    ).rejects.toMatchObject({ code: 'HOLD_CONFLICT' });
  });

  it('cancel releases booking claims', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimBookingInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(8, 0),
      endAt: at(8, 30),
      bookingId: 50,
    });
    expect(await svc.releaseBookingClaims(50)).toBe(6);
    await expect(
      svc.claimBookingInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(8, 0),
        endAt: at(8, 30),
        bookingId: 51,
      }),
    ).resolves.toMatchObject({ slots: 6 });
  });

  it('reschedule success moves claims atomically', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimBookingInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(13, 0),
      endAt: at(13, 30),
      bookingId: 7,
    });
    await svc.atomicRescheduleClaims({
      bookingId: 7,
      empId: EMP,
      branchId: BRANCH_A,
      oldStartAt: at(13, 0),
      oldEndAt: at(13, 30),
      newStartAt: at(15, 0),
      newEndAt: at(15, 30),
    });
    // old free
    await expect(
      svc.claimBookingInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(13, 0),
        endAt: at(13, 30),
        bookingId: 8,
      }),
    ).resolves.toMatchObject({ slots: 6 });
    // new blocked
    await expect(
      svc.claimBookingInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(15, 0),
        endAt: at(15, 30),
        bookingId: 9,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_CLAIM_CONFLICT' });
  });

  it('reschedule failure keeps old booking claims', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimBookingInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(17, 0),
      endAt: at(17, 30),
      bookingId: 20,
    });
    await svc.claimBookingInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(18, 0),
      endAt: at(18, 30),
      bookingId: 21,
    });
    await expect(
      svc.atomicRescheduleClaims({
        bookingId: 20,
        empId: EMP,
        branchId: BRANCH_A,
        oldStartAt: at(17, 0),
        oldEndAt: at(17, 30),
        newStartAt: at(18, 0),
        newEndAt: at(18, 30),
      }),
    ).rejects.toBeInstanceOf(SlotClaimConflictError);

    // old still held by 20
    await expect(
      svc.claimBookingInterval({
        empId: EMP,
        branchId: BRANCH_A,
        startAt: at(17, 0),
        endAt: at(17, 30),
        bookingId: 22,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_CLAIM_CONFLICT' });
  });

  it('idempotent rebuild from SoT', async () => {
    const svc = createBookingSlotClaimService({
      store: createBookingSlotClaimMemoryStore(),
    });
    await svc.claimBookingInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(19, 0),
      endAt: at(19, 20),
      bookingId: 30,
    });
    const again = await svc.rebuildBookingClaimsFromInterval({
      empId: EMP,
      branchId: BRANCH_A,
      startAt: at(19, 0),
      endAt: at(19, 20),
      bookingId: 30,
    });
    expect(again.slots).toBe(4);
  });
});

describe('B6 legacy backfill / conflict scan', () => {
  it('detects overlapping legacy bookings without mutating them', async () => {
    const bookings: LegacyBookingInterval[] = [
      {
        id: 1,
        empId: EMP,
        branchId: BRANCH_A,
        startMs: at(10, 0).getTime(),
        endMs: at(10, 30).getTime(),
        status: 'confirmed',
        hasAbsolute: true,
        malformedAbsolute: false,
      },
      {
        id: 2,
        empId: EMP,
        branchId: BRANCH_B,
        startMs: at(10, 15).getTime(),
        endMs: at(10, 45).getTime(),
        status: 'confirmed',
        hasAbsolute: true,
        malformedAbsolute: false,
      },
      {
        id: 3,
        empId: EMP,
        branchId: BRANCH_A,
        startMs: at(11, 0).getTime(),
        endMs: at(11, 30).getTime(),
        status: 'confirmed',
        hasAbsolute: true,
        malformedAbsolute: false,
      },
    ];
    const overlaps = scanLegacyBookingOverlaps(bookings);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.bookingIdA).toBe(1);
    expect(overlaps[0]!.bookingIdB).toBe(2);

    const store = createBookingSlotClaimMemoryStore();
    const svc = createBookingSlotClaimService({ store });
    const report = await backfillBookingSlotClaims({
      dryRun: false,
      bookings,
      service: svc,
    });
    expect(report.skippedConflict).toBe(2);
    expect(report.claimed).toBe(1);
    expect(report.conflictedBookingIds.sort()).toEqual([1, 2]);
    expect(report.legacyOverlaps).toHaveLength(1);
    // booking rows themselves unchanged — we only wrote claims for id=3
    const claimed = await store.withTransaction((tx) => tx.listByBookingId(3));
    expect(claimed.length).toBeGreaterThan(0);
    const skipped = await store.withTransaction((tx) => tx.listByBookingId(1));
    expect(skipped).toHaveLength(0);
  });

  it('findOverlappingIntervalPairs ignores adjacent', () => {
    const pairs = findOverlappingIntervalPairs([
      { id: 1, startMs: 0, endMs: 100 },
      { id: 2, startMs: 100, endMs: 200 },
    ]);
    expect(pairs).toHaveLength(0);
  });
});
