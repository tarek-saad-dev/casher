/**
 * Booking V2 B6 — claim store contract (memory or SQL).
 */

import type { SlotClaimRow, SlotClaimType } from '@/lib/booking/claims/BookingSlotClaimTypes';

export type SlotClaimInsert = {
  empId: number;
  branchId: number;
  absoluteSlotStartUtcMs: number;
  claimType: SlotClaimType;
  holdToken?: string | null;
  bookingId?: number | null;
  ownerKey?: string | null;
  expiresAtUtcMs?: number | null;
};

export type SlotClaimStoreTx = {
  /** Insert one claim; throws SlotClaimConflictError on unique violation. */
  insert(row: SlotClaimInsert): Promise<SlotClaimRow>;
  deleteByHoldToken(holdToken: string): Promise<number>;
  deleteByBookingId(bookingId: number): Promise<number>;
  /** Delete specific BOOKING claim slots for a booking (reschedule old-only). */
  deleteByBookingIdAndSlots(
    bookingId: number,
    slotStartsUtcMs: number[],
  ): Promise<number>;
  /** Convert HOLD → BOOKING in place (same EmpID+slot rows). */
  convertHoldToBooking(args: {
    holdToken: string;
    bookingId: number;
    ownerKey?: string | null;
  }): Promise<number>;
  listByHoldToken(holdToken: string): Promise<SlotClaimRow[]>;
  listByBookingId(bookingId: number): Promise<SlotClaimRow[]>;
  listByEmpSlots(args: {
    empId: number;
    slotStartsUtcMs: number[];
  }): Promise<SlotClaimRow[]>;
  deleteExpiredHolds(nowMs: number): Promise<number>;
  /** Delete expired HOLD claims for specific slots only. */
  deleteExpiredHoldsForSlots(args: {
    empId: number;
    slotStartsUtcMs: number[];
    nowMs: number;
  }): Promise<number>;
};

export type SlotClaimStore = {
  /** Run work inside a transactional unit (memory or SQL SERIALIZABLE). */
  withTransaction<T>(fn: (tx: SlotClaimStoreTx) => Promise<T>): Promise<T>;
  /** Non-tx helpers for cleanup / scan. */
  deleteExpiredHolds(nowMs: number): Promise<number>;
  listByEmpRange(args: {
    empId: number;
    rangeStartMs: number;
    rangeEndMs: number;
  }): Promise<SlotClaimRow[]>;
  /** Test/diag */
  size?(): number;
};
