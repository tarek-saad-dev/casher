/**
 * Booking Phase 7A — central public booking status mapper.
 */
import 'server-only';

export type PublicBookingStatus =
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'in_service'
  | 'no_show'
  | 'expired'
  | 'pending'
  | 'unknown';

const LABELS_AR: Record<PublicBookingStatus, string> = {
  confirmed: 'مؤكد',
  cancelled: 'ملغي',
  completed: 'مكتمل',
  in_service: 'قيد التنفيذ',
  no_show: 'لم يحضر',
  expired: 'منتهي',
  pending: 'قيد الانتظار',
  unknown: 'غير معروف',
};

/** Internal statuses observed in ops / create / cancel paths (lowercase). */
const FUTURE_ACTIVE = new Set([
  'confirmed',
  'pending',
  'arrived',
  'queued',
  'in_service',
  'in_progress',
  'rescheduled',
]);

const CANCELLED = new Set(['cancelled', 'canceled']);
const COMPLETED = new Set(['completed', 'done']);
const NO_SHOW = new Set(['no_show', 'noshow']);
const IN_SERVICE = new Set(['in_service', 'in_progress', 'arrived', 'queued']);

export function normalizeInternalBookingStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * Map persisted Status → stable public contract.
 * Unknown/legacy values become `unknown` (never invent silent confirmed).
 */
export function mapPublicBookingStatus(raw: unknown): {
  status: PublicBookingStatus;
  statusLabel: string;
  statusLabelAr: string;
  canCancel: boolean;
  isFutureActive: boolean;
} {
  const s = normalizeInternalBookingStatus(raw);

  let status: PublicBookingStatus = 'unknown';
  if (CANCELLED.has(s)) status = 'cancelled';
  else if (COMPLETED.has(s)) status = 'completed';
  else if (NO_SHOW.has(s)) status = 'no_show';
  else if (IN_SERVICE.has(s)) status = 'in_service';
  else if (s === 'pending') status = 'pending';
  else if (s === 'confirmed' || s === 'rescheduled') status = 'confirmed';
  else if (s === 'expired') status = 'expired';

  const isFutureActive = FUTURE_ACTIVE.has(s);
  const canCancel = status === 'confirmed' || status === 'pending';

  return {
    status,
    statusLabel: LABELS_AR[status],
    statusLabelAr: LABELS_AR[status],
    canCancel,
    isFutureActive,
  };
}

/** Upcoming list: future-active public statuses only. */
export function isUpcomingEligibleStatus(raw: unknown): boolean {
  return mapPublicBookingStatus(raw).isFutureActive;
}
