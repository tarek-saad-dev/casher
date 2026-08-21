/**
 * Booking V2 B6 — slot claim types & errors.
 */

export type SlotClaimType = 'HOLD' | 'BOOKING';

export type SlotClaimRow = {
  claimId: number;
  empId: number;
  branchId: number;
  absoluteSlotStartUtcMs: number;
  claimType: SlotClaimType;
  holdToken: string | null;
  bookingId: number | null;
  ownerKey: string | null;
  expiresAtUtcMs: number | null;
  createdAtUtcMs: number;
};

export type SlotClaimConflictCode =
  | 'HOLD_CONFLICT'
  | 'SLOT_CLAIM_CONFLICT'
  | 'SLOT_CLAIM_NOT_FOUND'
  | 'SLOT_CLAIM_INVALID_INTERVAL'
  | 'SLOT_CLAIM_RESCHEDULE_FAILED';

export class SlotClaimConflictError extends Error {
  readonly code: SlotClaimConflictCode;
  readonly meta: Record<string, unknown>;
  constructor(code: SlotClaimConflictCode, meta: Record<string, unknown> = {}) {
    super(code);
    this.name = 'SlotClaimConflictError';
    this.code = code;
    this.meta = meta;
  }
}

export function isSlotClaimConflictError(err: unknown): err is SlotClaimConflictError {
  return err instanceof SlotClaimConflictError;
}
