/**
 * The active branch's queue policy is authoritative. Never borrow a legacy
 * global (CUT) duration when provisioning an independent salon's queue.
 */
export const QUEUE_DEFAULT_DURATION_MINUTES = 30;
export const QUEUE_DURATION_MIN = 5;
export const QUEUE_DURATION_MAX = 240;

export function normalizeBranchQueueDuration(raw: unknown): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= QUEUE_DURATION_MIN && value <= QUEUE_DURATION_MAX
    ? value
    : QUEUE_DEFAULT_DURATION_MINUTES;
}
