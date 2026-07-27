/**
 * Booking Phase 7B — shared public cancellation eligibility + cutoff.
 * Used by Phase 7A canCancel and Phase 7B cancelPublicBooking.
 */
import 'server-only';
import { mapPublicBookingStatus } from '@/lib/booking/publicBookingStatus';

/** Hardcoded public customer cutoff (minutes before AbsoluteStartUtc). */
export const PUBLIC_CANCELLATION_CUTOFF_MINUTES = 30;

export const APPROVED_CANCEL_REASON_CODES = [
  'customer_changed_plans',
  'customer_sick',
  'scheduling_conflict',
  'other',
] as const;

export type ApprovedCancelReasonCode = (typeof APPROVED_CANCEL_REASON_CODES)[number];

export type CancellationCutoffResult = {
  cutoffMinutes: number;
  startMs: number | null;
  nowMs: number;
  windowOpen: boolean;
  reason:
    | 'ok'
    | 'status_not_cancellable'
    | 'already_cancelled'
    | 'in_service'
    | 'completed'
    | 'no_show'
    | 'unknown_status'
    | 'ambiguous_start'
    | 'window_closed';
};

/**
 * Shared cutoff resolver — Cairo wall-clock via AbsoluteStartUtc (UTC ms).
 * Do not use server local timezone.
 */
export function resolvePublicCancellationCutoff(args: {
  statusRaw: unknown;
  absoluteStartUtc: Date | string | null | undefined;
  dateSource?: 'canonical' | 'legacy_derived' | 'ambiguous' | string | null;
  nowMs?: number;
}): CancellationCutoffResult {
  const nowMs = args.nowMs ?? Date.now();
  const mapped = mapPublicBookingStatus(args.statusRaw);
  const cutoffMinutes = PUBLIC_CANCELLATION_CUTOFF_MINUTES;

  if (mapped.status === 'cancelled') {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: 'already_cancelled',
    };
  }
  if (mapped.status === 'in_service') {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: 'in_service',
    };
  }
  if (mapped.status === 'completed') {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: 'completed',
    };
  }
  if (mapped.status === 'no_show') {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: 'no_show',
    };
  }
  if (mapped.status === 'unknown' || !mapped.canCancel) {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: mapped.status === 'unknown' ? 'unknown_status' : 'status_not_cancellable',
    };
  }

  if (args.dateSource === 'ambiguous' || args.absoluteStartUtc == null) {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: 'ambiguous_start',
    };
  }

  const startMs = new Date(args.absoluteStartUtc).getTime();
  if (!Number.isFinite(startMs)) {
    return {
      cutoffMinutes,
      startMs: null,
      nowMs,
      windowOpen: false,
      reason: 'ambiguous_start',
    };
  }

  const windowOpen = startMs - nowMs > cutoffMinutes * 60_000;
  return {
    cutoffMinutes,
    startMs,
    nowMs,
    windowOpen,
    reason: windowOpen ? 'ok' : 'window_closed',
  };
}

export function isApprovedReasonCode(code: unknown): code is ApprovedCancelReasonCode {
  return (
    typeof code === 'string' &&
    (APPROVED_CANCEL_REASON_CODES as readonly string[]).includes(code)
  );
}
