/**
 * Pure queue-ahead helpers — safe for client and server bundles.
 * Do not import database modules here.
 */

/** Active queue tickets that finish at or before the new ticket's start time. */
export function countQueueCustomersAhead(
  queueIntervals: Array<{ end: Date }>,
  slotStart: Date,
): number {
  const slotMs = slotStart.getTime();
  return queueIntervals.filter((q) => q.end.getTime() <= slotMs).length;
}

/** Preserve zero; never treat 0 as missing. */
export function normalizeCustomersAhead(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
