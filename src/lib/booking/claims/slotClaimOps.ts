/**
 * Pure claim operations on a SlotClaimStoreTx (shared by service + in-TX dual-guard).
 */

import { absoluteSlotStartsForInterval } from '@/lib/booking/claims/slotClaimMath';
import {
  SlotClaimConflictError,
  type SlotClaimRow,
} from '@/lib/booking/claims/BookingSlotClaimTypes';
import type { SlotClaimStoreTx } from '@/lib/booking/claims/BookingSlotClaimStore';

/** Mirrors BOOKING_HOLD_TTL_MS — keep in sync; avoid importing server-only hold module. */
const DEFAULT_HOLD_TTL_MS = 5 * 60_000;

function requireSlots(startAt: Date, endAt: Date): number[] {
  const slots = absoluteSlotStartsForInterval({ startAt, endAt });
  if (!slots.length) {
    throw new SlotClaimConflictError('SLOT_CLAIM_INVALID_INTERVAL', {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });
  }
  return slots;
}

export async function txClaimHoldInterval(
  tx: SlotClaimStoreTx,
  args: {
    empId: number;
    branchId: number;
    startAt: Date;
    endAt: Date;
    holdToken: string;
    ttlMs?: number;
    nowMs?: number;
    ownerKey?: string | null;
  },
): Promise<{ slots: number; claims: SlotClaimRow[] }> {
  const slots = requireSlots(args.startAt, args.endAt);
  const nowMs = args.nowMs ?? Date.now();
  const expiresAtUtcMs = nowMs + (args.ttlMs ?? DEFAULT_HOLD_TTL_MS);

  await tx.deleteExpiredHoldsForSlots({
    empId: args.empId,
    slotStartsUtcMs: slots,
    nowMs,
  });

  const claims: SlotClaimRow[] = [];
  for (const slotMs of slots) {
    claims.push(
      await tx.insert({
        empId: args.empId,
        branchId: args.branchId,
        absoluteSlotStartUtcMs: slotMs,
        claimType: 'HOLD',
        holdToken: args.holdToken,
        ownerKey: args.ownerKey ?? null,
        expiresAtUtcMs,
      }),
    );
  }
  return { slots: claims.length, claims };
}

export async function txConvertHoldToBooking(
  tx: SlotClaimStoreTx,
  args: { holdToken: string; bookingId: number; ownerKey?: string | null },
): Promise<number> {
  const existing = await tx.listByHoldToken(args.holdToken);
  if (!existing.length) {
    throw new SlotClaimConflictError('SLOT_CLAIM_NOT_FOUND', {
      holdToken: args.holdToken,
    });
  }
  return tx.convertHoldToBooking({
    holdToken: args.holdToken,
    bookingId: args.bookingId,
    ownerKey: args.ownerKey ?? null,
  });
}

export async function txClaimBookingInterval(
  tx: SlotClaimStoreTx,
  args: {
    empId: number;
    branchId: number;
    startAt: Date;
    endAt: Date;
    bookingId: number;
    ownerKey?: string | null;
  },
): Promise<{ slots: number; claims: SlotClaimRow[] }> {
  const slots = requireSlots(args.startAt, args.endAt);
  const claims: SlotClaimRow[] = [];
  for (const slotMs of slots) {
    claims.push(
      await tx.insert({
        empId: args.empId,
        branchId: args.branchId,
        absoluteSlotStartUtcMs: slotMs,
        claimType: 'BOOKING',
        bookingId: args.bookingId,
        ownerKey: args.ownerKey ?? null,
      }),
    );
  }
  return { slots: claims.length, claims };
}

/**
 * Secure NEW claims first (slots not already owned), then release OLD-only slots.
 * Never releases first — failure leaves prior claims intact (TX rollback).
 */
export async function txAtomicRescheduleClaims(
  tx: SlotClaimStoreTx,
  args: {
    bookingId: number;
    empId: number;
    branchId: number;
    newStartAt: Date;
    newEndAt: Date;
    ownerKey?: string | null;
    nowMs?: number;
  },
): Promise<{ slots: number }> {
  const newSlots = requireSlots(args.newStartAt, args.newEndAt);
  const newSet = new Set(newSlots);
  const nowMs = args.nowMs ?? Date.now();

  await tx.deleteExpiredHoldsForSlots({
    empId: args.empId,
    slotStartsUtcMs: newSlots,
    nowMs,
  });

  const own = await tx.listByBookingId(args.bookingId);
  const ownSlots = new Set(own.map((r) => r.absoluteSlotStartUtcMs));

  // 1) Secure new slots not already owned by this booking.
  for (const slotMs of newSlots) {
    if (ownSlots.has(slotMs)) continue;
    await tx.insert({
      empId: args.empId,
      branchId: args.branchId,
      absoluteSlotStartUtcMs: slotMs,
      claimType: 'BOOKING',
      bookingId: args.bookingId,
      ownerKey: args.ownerKey ?? null,
    });
  }

  // 2) Release old-only slots (keep intersection).
  const oldOnly = own
    .map((r) => r.absoluteSlotStartUtcMs)
    .filter((ms) => !newSet.has(ms));
  if (oldOnly.length) {
    await tx.deleteByBookingIdAndSlots(args.bookingId, oldOnly);
  }

  return { slots: newSlots.length };
}

export async function txReleaseBookingClaims(
  tx: SlotClaimStoreTx,
  bookingId: number,
): Promise<number> {
  return tx.deleteByBookingId(bookingId);
}

export async function txRebuildBookingClaims(
  tx: SlotClaimStoreTx,
  args: {
    empId: number;
    branchId: number;
    startAt: Date;
    endAt: Date;
    bookingId: number;
    ownerKey?: string | null;
  },
): Promise<{ slots: number }> {
  const slots = requireSlots(args.startAt, args.endAt);
  await tx.deleteByBookingId(args.bookingId);
  for (const slotMs of slots) {
    await tx.insert({
      empId: args.empId,
      branchId: args.branchId,
      absoluteSlotStartUtcMs: slotMs,
      claimType: 'BOOKING',
      bookingId: args.bookingId,
      ownerKey: args.ownerKey ?? null,
    });
  }
  return { slots: slots.length };
}
