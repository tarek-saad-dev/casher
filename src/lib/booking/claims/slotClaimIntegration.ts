/**
 * Booking V2 B6 — dual-guard integration helpers (feature-flagged).
 * Does not replace publicBookingCreate TX/locks; additive only.
 *
 * enforce → claim ops inside the caller's write TX (via bindBookingSlotClaimTx)
 * shadow → post-commit best-effort; conflicts logged; legacy remains authority
 * off → no-op
 */

import type { Transaction } from 'mssql';
import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';
import {
  isBookingSlotClaimsEnabled,
  isBookingSlotClaimsEnforced,
  resolveBookingSlotClaimsMode,
} from '@/lib/booking/claims/BookingSlotClaimFlags';
import {
  createBookingSlotClaimService,
  type BookingSlotClaimService,
} from '@/lib/booking/claims/BookingSlotClaimService';
import {
  createBookingSlotClaimSqlStore,
  bindBookingSlotClaimTx,
} from '@/lib/booking/claims/BookingSlotClaimSqlStore';
import {
  isSlotClaimConflictError,
  SlotClaimConflictError,
} from '@/lib/booking/claims/BookingSlotClaimTypes';
import {
  txAtomicRescheduleClaims,
  txClaimBookingInterval,
  txClaimHoldInterval,
  txConvertHoldToBooking,
  txReleaseBookingClaims,
} from '@/lib/booking/claims/slotClaimOps';
import type { SlotClaimStoreTx } from '@/lib/booking/claims/BookingSlotClaimStore';
import { logSlotClaimShadowEvent } from '@/lib/booking/claims/slotClaimShadowTelemetry';

let cachedService: BookingSlotClaimService | null = null;

function notifyHoldOccupancy(args: {
  empId: number;
  branchId: number;
  startAtMs: number;
  endAtMs: number;
  holdToken: string;
  businessDate?: string | null;
}): void {
  try {
    void import('@/lib/booking/projection/HoldOccupancyProjection').then((m) => {
      const businessDate =
        args.businessDate ?? new Date(args.startAtMs).toISOString().slice(0, 10);
      m.HoldOccupancyProjection.onHoldCreated({
        key: { employeeId: args.empId, businessDate },
        hold: {
          id: hashToken(args.holdToken),
          startAtMs: args.startAtMs,
          endAtMs: args.endAtMs,
          branchId: args.branchId,
          expiresAtMs: Date.now() + 5 * 60_000,
          status: 'active',
        },
      });
    });
    void import('@/lib/booking/cache/HotAvailabilityInvalidation').then((m) => {
      const businessDate =
        args.businessDate ?? new Date(args.startAtMs).toISOString().slice(0, 10);
      return m.invalidateOnHoldCreated({
        employeeId: args.empId,
        branchId: args.branchId,
        businessDate,
        reason: 'hold_created',
      });
    });
  } catch {
    /* occupancy/hot cache optional — never correctness */
  }
}

function notifyBookingOccupancy(args: {
  empId: number;
  branchId: number;
  startAtMs: number;
  endAtMs: number;
  bookingId: number;
  businessDate?: string | null;
}): void {
  try {
    void import('@/lib/booking/projection/BookingOccupancyProjection').then((m) => {
      const businessDate =
        args.businessDate ?? new Date(args.startAtMs).toISOString().slice(0, 10);
      m.BookingOccupancyProjection.onBookingCreated({
        key: { employeeId: args.empId, businessDate },
        interval: {
          id: args.bookingId,
          startAtMs: args.startAtMs,
          endAtMs: args.endAtMs,
          branchId: args.branchId,
        },
      });
    });
    void import('@/lib/booking/cache/HotAvailabilityInvalidation').then((m) => {
      const businessDate =
        args.businessDate ?? new Date(args.startAtMs).toISOString().slice(0, 10);
      return m.invalidateOnBookingCreated({
        employeeId: args.empId,
        branchId: args.branchId,
        businessDate,
        reason: 'booking_created',
      });
    });
  } catch {
    /* optional */
  }
}

function hashToken(token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export function getBookingSlotClaimService(): BookingSlotClaimService {
  if (!cachedService) {
    cachedService = createBookingSlotClaimService({
      store: createBookingSlotClaimSqlStore(),
      onHoldCommitted: notifyHoldOccupancy,
      onBookingCommitted: notifyBookingOccupancy,
    });
  }
  return cachedService;
}

/** Test helper — reset singleton. */
export function __resetBookingSlotClaimServiceForTests(): void {
  cachedService = null;
}

export function claimTxFromBookingTransaction(
  transaction: Transaction,
): SlotClaimStoreTx {
  return bindBookingSlotClaimTx(transaction);
}

/**
 * Inside an open booking/hold TX when enforce mode is on.
 * Throws SlotClaimConflictError on unique conflict.
 */
export async function enforceClaimHoldInTx(
  tx: SlotClaimStoreTx,
  args: {
    empId: number;
    branchId: number;
    startAt: Date;
    endAt: Date;
    holdToken: string;
    ttlMs?: number;
  },
): Promise<void> {
  if (!isBookingSlotClaimsEnforced()) return;
  await txClaimHoldInterval(tx, args);
}

export async function enforceClaimOrConvertBookingInTx(
  tx: SlotClaimStoreTx,
  args: {
    empId: number;
    branchId: number;
    startAt: Date;
    endAt: Date;
    bookingId: number;
    holdToken?: string | null;
  },
): Promise<void> {
  if (!isBookingSlotClaimsEnforced()) return;
  const holdToken = args.holdToken?.trim() || null;
  if (holdToken) {
    const existing = await tx.listByHoldToken(holdToken);
    if (existing.length) {
      await txConvertHoldToBooking(tx, {
        holdToken,
        bookingId: args.bookingId,
      });
      return;
    }
  }
  await txClaimBookingInterval(tx, {
    empId: args.empId,
    branchId: args.branchId,
    startAt: args.startAt,
    endAt: args.endAt,
    bookingId: args.bookingId,
  });
}

export async function enforceReleaseBookingInTx(
  tx: SlotClaimStoreTx,
  bookingId: number,
): Promise<void> {
  if (!isBookingSlotClaimsEnforced()) return;
  await txReleaseBookingClaims(tx, bookingId);
}

export async function enforceAtomicRescheduleInTx(
  tx: SlotClaimStoreTx,
  args: {
    bookingId: number;
    empId: number;
    branchId: number;
    newStartAt: Date;
    newEndAt: Date;
  },
): Promise<void> {
  if (!isBookingSlotClaimsEnforced()) return;
  try {
    await txAtomicRescheduleClaims(tx, args);
  } catch (err) {
    if (isSlotClaimConflictError(err)) {
      throw new SlotClaimConflictError('SLOT_CLAIM_RESCHEDULE_FAILED', err.meta);
    }
    throw err;
  }
}

/** Shadow / post-commit best-effort hold claim (does not fail the hold). */
export async function shadowClaimHold(args: {
  empId: number;
  branchId: number;
  startAt: Date;
  endAt: Date;
  holdToken: string;
  ttlMs?: number;
  requestId?: string | null;
  businessDate?: string | null;
}): Promise<void> {
  const mode = resolveBookingSlotClaimsMode();
  if (mode !== 'shadow') return;
  const t0 = Date.now();
  try {
    await getBookingSlotClaimService().claimHoldInterval(args);
    logSlotClaimShadowEvent({
      operation: 'hold',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate ?? null,
      startAtMs: args.startAt.getTime(),
      endAtMs: args.endAt.getTime(),
      holdToken: args.holdToken,
      legacyDecision: 'allow',
      claimDecision: 'allow',
      mismatchCategory: 'exact_agreement',
      latencyMs: Date.now() - t0,
    });
  } catch (err) {
    const code = isSlotClaimConflictError(err) ? err.code : 'SLOT_CLAIM_CONFLICT';
    const crossBranch =
      isSlotClaimConflictError(err) &&
      Number(err.meta?.existingBranchId ?? args.branchId) !== args.branchId;
    logBookingAvailabilityMetric({
      event: 'hold_conflict',
      reasonCode: code,
      empId: args.empId,
      branchId: args.branchId,
      extra: { mode, dualGuard: 'shadow' },
    });
    logSlotClaimShadowEvent({
      operation: 'hold',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate ?? null,
      startAtMs: args.startAt.getTime(),
      endAtMs: args.endAt.getTime(),
      holdToken: args.holdToken,
      legacyDecision: 'allow',
      claimDecision: 'conflict',
      conflictOwner: isSlotClaimConflictError(err)
        ? String(err.meta?.existingClaimId ?? err.meta?.existingType ?? 'unknown')
        : null,
      reasonCode: code,
      mismatchCategory: crossBranch
        ? 'cross_branch_conflict'
        : 'claim_conflict_legacy_allowed',
      latencyMs: Date.now() - t0,
    });
  }
}

export async function shadowClaimOrConvertBooking(args: {
  empId: number;
  branchId: number;
  startAt: Date;
  endAt: Date;
  bookingId: number;
  holdToken?: string | null;
  requestId?: string | null;
  businessDate?: string | null;
}): Promise<void> {
  const mode = resolveBookingSlotClaimsMode();
  if (mode !== 'shadow') return;
  const t0 = Date.now();
  try {
    const svc = getBookingSlotClaimService();
    const holdToken = args.holdToken?.trim() || null;
    if (holdToken) {
      try {
        await svc.convertHoldToBookingClaims({
          holdToken,
          bookingId: args.bookingId,
        });
        notifyBookingOccupancy({
          empId: args.empId,
          branchId: args.branchId,
          startAtMs: args.startAt.getTime(),
          endAtMs: args.endAt.getTime(),
          bookingId: args.bookingId,
        });
        logSlotClaimShadowEvent({
          operation: 'convert',
          requestId: args.requestId ?? null,
          empId: args.empId,
          branchId: args.branchId,
          businessDate: args.businessDate ?? null,
          startAtMs: args.startAt.getTime(),
          endAtMs: args.endAt.getTime(),
          bookingId: args.bookingId,
          holdToken,
          legacyDecision: 'allow',
          claimDecision: 'allow',
          mismatchCategory: 'exact_agreement',
          latencyMs: Date.now() - t0,
        });
        return;
      } catch {
        /* fall through to insert booking claims */
      }
    }
    await svc.claimBookingInterval(args);
    logSlotClaimShadowEvent({
      operation: 'create',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate ?? null,
      startAtMs: args.startAt.getTime(),
      endAtMs: args.endAt.getTime(),
      bookingId: args.bookingId,
      legacyDecision: 'allow',
      claimDecision: 'allow',
      mismatchCategory: 'exact_agreement',
      latencyMs: Date.now() - t0,
    });
  } catch (err) {
    const code = isSlotClaimConflictError(err) ? err.code : 'SLOT_CLAIM_CONFLICT';
    logBookingAvailabilityMetric({
      event: 'booking_conflict',
      reasonCode: code,
      empId: args.empId,
      branchId: args.branchId,
      bookingId: args.bookingId,
      extra: { mode, dualGuard: 'shadow' },
    });
    logSlotClaimShadowEvent({
      operation: 'create',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate ?? null,
      startAtMs: args.startAt.getTime(),
      endAtMs: args.endAt.getTime(),
      bookingId: args.bookingId,
      legacyDecision: 'allow',
      claimDecision: 'conflict',
      conflictOwner: isSlotClaimConflictError(err)
        ? String(err.meta?.existingClaimId ?? 'unknown')
        : null,
      reasonCode: code,
      mismatchCategory: 'claim_conflict_legacy_allowed',
      latencyMs: Date.now() - t0,
    });
  }
}

export async function shadowReleaseBooking(
  bookingId: number,
  meta?: {
    requestId?: string | null;
    empId?: number | null;
    branchId?: number | null;
  },
): Promise<void> {
  if (resolveBookingSlotClaimsMode() !== 'shadow') return;
  const t0 = Date.now();
  try {
    await getBookingSlotClaimService().releaseBookingClaims(bookingId);
    logSlotClaimShadowEvent({
      operation: 'cancel',
      requestId: meta?.requestId ?? null,
      empId: meta?.empId ?? null,
      branchId: meta?.branchId ?? null,
      bookingId,
      legacyDecision: 'allow',
      claimDecision: 'allow',
      mismatchCategory: 'exact_agreement',
      latencyMs: Date.now() - t0,
    });
  } catch {
    logSlotClaimShadowEvent({
      operation: 'cancel',
      requestId: meta?.requestId ?? null,
      bookingId,
      legacyDecision: 'allow',
      claimDecision: 'deny',
      mismatchCategory: 'claim_error',
      latencyMs: Date.now() - t0,
    });
  }
}

export async function shadowAtomicReschedule(args: {
  bookingId: number;
  empId: number;
  branchId: number;
  oldStartAt: Date;
  oldEndAt: Date;
  newStartAt: Date;
  newEndAt: Date;
  requestId?: string | null;
  businessDate?: string | null;
}): Promise<void> {
  if (resolveBookingSlotClaimsMode() !== 'shadow') return;
  const t0 = Date.now();
  try {
    await getBookingSlotClaimService().atomicRescheduleClaims(args);
    logSlotClaimShadowEvent({
      operation: 'reschedule',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate ?? null,
      startAtMs: args.newStartAt.getTime(),
      endAtMs: args.newEndAt.getTime(),
      bookingId: args.bookingId,
      legacyDecision: 'allow',
      claimDecision: 'allow',
      mismatchCategory: 'exact_agreement',
      latencyMs: Date.now() - t0,
    });
  } catch (err) {
    const code = isSlotClaimConflictError(err)
      ? err.code
      : 'SLOT_CLAIM_RESCHEDULE_FAILED';
    logBookingAvailabilityMetric({
      event: 'booking_reschedule_failure',
      reasonCode: code,
      empId: args.empId,
      bookingId: args.bookingId,
      extra: { dualGuard: 'shadow' },
    });
    logSlotClaimShadowEvent({
      operation: 'reschedule',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: args.businessDate ?? null,
      startAtMs: args.newStartAt.getTime(),
      endAtMs: args.newEndAt.getTime(),
      bookingId: args.bookingId,
      legacyDecision: 'allow',
      claimDecision: 'conflict',
      reasonCode: code,
      mismatchCategory: 'claim_conflict_legacy_allowed',
      latencyMs: Date.now() - t0,
    });
  }
}

export async function shadowReleaseHold(holdToken: string): Promise<void> {
  if (!isBookingSlotClaimsEnabled()) return;
  try {
    await getBookingSlotClaimService().releaseHoldClaims(holdToken);
  } catch {
    /* best-effort */
  }
}

export { isSlotClaimConflictError, SlotClaimConflictError };
