/**
 * Booking V2 B6 — BookingSlotClaimService
 *
 * DB (or memory) unique EmpID+AbsoluteSlotStartUtc is the correctness authority.
 * Occupancy projection hooks are speed-only and run after successful commit.
 */

import {
  SlotClaimConflictError,
  type SlotClaimRow,
} from '@/lib/booking/claims/BookingSlotClaimTypes';
import type { SlotClaimStore, SlotClaimStoreTx } from '@/lib/booking/claims/BookingSlotClaimStore';
import { createBookingSlotClaimMemoryStore } from '@/lib/booking/claims/BookingSlotClaimMemoryStore';
import {
  txAtomicRescheduleClaims,
  txClaimBookingInterval,
  txClaimHoldInterval,
  txConvertHoldToBooking,
  txRebuildBookingClaims,
  txReleaseBookingClaims,
} from '@/lib/booking/claims/slotClaimOps';

export type ClaimIntervalArgs = {
  empId: number;
  branchId: number;
  startAt: Date;
  endAt: Date;
  ownerKey?: string | null;
};

export type BookingSlotClaimService = {
  claimHoldInterval(
    args: ClaimIntervalArgs & {
      holdToken: string;
      ttlMs?: number;
      nowMs?: number;
    },
  ): Promise<{ slots: number; claims: SlotClaimRow[] }>;
  releaseHoldClaims(holdToken: string): Promise<number>;
  convertHoldToBookingClaims(args: {
    holdToken: string;
    bookingId: number;
    ownerKey?: string | null;
  }): Promise<number>;
  claimBookingInterval(
    args: ClaimIntervalArgs & { bookingId: number },
  ): Promise<{ slots: number; claims: SlotClaimRow[] }>;
  releaseBookingClaims(bookingId: number): Promise<number>;
  atomicRescheduleClaims(args: {
    bookingId: number;
    empId: number;
    branchId: number;
    oldStartAt: Date;
    oldEndAt: Date;
    newStartAt: Date;
    newEndAt: Date;
    ownerKey?: string | null;
  }): Promise<{ slots: number }>;
  cleanupExpiredClaims(nowMs?: number): Promise<number>;
  /** Rebuild booking claims from SoT interval (idempotent replace). */
  rebuildBookingClaimsFromInterval(
    args: ClaimIntervalArgs & { bookingId: number },
  ): Promise<{ slots: number }>;
  /** Ops against an external TX (shared with booking create/cancel/reschedule). */
  onTx: {
    claimHoldInterval: typeof txClaimHoldInterval;
    convertHoldToBookingClaims: typeof txConvertHoldToBooking;
    claimBookingInterval: typeof txClaimBookingInterval;
    releaseBookingClaims: typeof txReleaseBookingClaims;
    atomicRescheduleClaims: (
      tx: SlotClaimStoreTx,
      args: Parameters<typeof txAtomicRescheduleClaims>[1],
    ) => ReturnType<typeof txAtomicRescheduleClaims>;
    rebuildBookingClaimsFromInterval: typeof txRebuildBookingClaims;
  };
  store: SlotClaimStore;
};

export function createBookingSlotClaimService(opts?: {
  store?: SlotClaimStore;
  /** Optional post-commit occupancy hook (B5). Never used for correctness. */
  onHoldCommitted?: (args: {
    empId: number;
    branchId: number;
    startAtMs: number;
    endAtMs: number;
    holdToken: string;
  }) => void;
  onBookingCommitted?: (args: {
    empId: number;
    branchId: number;
    startAtMs: number;
    endAtMs: number;
    bookingId: number;
  }) => void;
  onBookingReleased?: (args: { empId: number; bookingId: number }) => void;
}): BookingSlotClaimService {
  const store = opts?.store ?? createBookingSlotClaimMemoryStore();

  return {
    store,

    onTx: {
      claimHoldInterval: txClaimHoldInterval,
      convertHoldToBookingClaims: txConvertHoldToBooking,
      claimBookingInterval: txClaimBookingInterval,
      releaseBookingClaims: txReleaseBookingClaims,
      atomicRescheduleClaims: txAtomicRescheduleClaims,
      rebuildBookingClaimsFromInterval: txRebuildBookingClaims,
    },

    async claimHoldInterval(args) {
      const result = await store.withTransaction((tx) =>
        txClaimHoldInterval(tx, args),
      );
      opts?.onHoldCommitted?.({
        empId: args.empId,
        branchId: args.branchId,
        startAtMs: args.startAt.getTime(),
        endAtMs: args.endAt.getTime(),
        holdToken: args.holdToken,
      });
      return result;
    },

    async releaseHoldClaims(holdToken) {
      return store.withTransaction(async (tx) => tx.deleteByHoldToken(holdToken));
    },

    async convertHoldToBookingClaims(args) {
      return store.withTransaction((tx) => txConvertHoldToBooking(tx, args));
    },

    async claimBookingInterval(args) {
      const result = await store.withTransaction((tx) =>
        txClaimBookingInterval(tx, args),
      );
      opts?.onBookingCommitted?.({
        empId: args.empId,
        branchId: args.branchId,
        startAtMs: args.startAt.getTime(),
        endAtMs: args.endAt.getTime(),
        bookingId: args.bookingId,
      });
      return result;
    },

    async releaseBookingClaims(bookingId) {
      const n = await store.withTransaction((tx) =>
        txReleaseBookingClaims(tx, bookingId),
      );
      opts?.onBookingReleased?.({ empId: 0, bookingId });
      return n;
    },

    async atomicRescheduleClaims(args) {
      try {
        const result = await store.withTransaction((tx) =>
          txAtomicRescheduleClaims(tx, {
            bookingId: args.bookingId,
            empId: args.empId,
            branchId: args.branchId,
            newStartAt: args.newStartAt,
            newEndAt: args.newEndAt,
            ownerKey: args.ownerKey,
          }),
        );
        opts?.onBookingCommitted?.({
          empId: args.empId,
          branchId: args.branchId,
          startAtMs: args.newStartAt.getTime(),
          endAtMs: args.newEndAt.getTime(),
          bookingId: args.bookingId,
        });
        return result;
      } catch (err) {
        if (err instanceof SlotClaimConflictError) throw err;
        throw err;
      }
    },

    async cleanupExpiredClaims(nowMs = Date.now()) {
      return store.deleteExpiredHolds(nowMs);
    },

    async rebuildBookingClaimsFromInterval(args) {
      return store.withTransaction((tx) => txRebuildBookingClaims(tx, args));
    },
  };
}

/** Default process-local service (tests). Production wires SQL via getBookingSlotClaimService. */
export const BookingSlotClaimService = createBookingSlotClaimService();
