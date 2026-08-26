/**
 * Canonical public MinNotice eligibility (pure domain, absolute ms).
 *
 *   thresholdMs = nowMs + minNoticeMinutes * 60_000
 *   eligible    <=> startAtMs > nowMs AND startAtMs >= thresholdMs
 *
 * Historical engine reject form (equivalent):
 *   startAtMs <= nowMs           → past
 *   startAtMs < thresholdMs      → MIN_NOTICE_NOT_MET
 *
 * Never truncate seconds/milliseconds before applying MinNotice.
 */
export function minNoticeThresholdMs(
  nowMs: number,
  minNoticeMinutes: number,
): number {
  const notice = Math.max(0, Math.floor(Number(minNoticeMinutes) || 0));
  return nowMs + notice * 60_000;
}

export function isSlotStartEligibleUnderMinNotice(args: {
  startAtMs: number;
  nowMs: number;
  minNoticeMinutes: number;
}): boolean {
  if (!(args.startAtMs > args.nowMs)) return false;
  const notice = Math.max(0, Math.floor(Number(args.minNoticeMinutes) || 0));
  if (notice <= 0) return true;
  return args.startAtMs >= minNoticeThresholdMs(args.nowMs, notice);
}

/** True when start is too soon for public MinNotice (not merely past). */
export function isMinNoticeNotMet(args: {
  startAtMs: number;
  nowMs: number;
  minNoticeMinutes: number;
}): boolean {
  const notice = Math.max(0, Math.floor(Number(args.minNoticeMinutes) || 0));
  if (notice <= 0) return false;
  if (!(args.startAtMs > args.nowMs)) return false; // past handled separately
  return args.startAtMs < minNoticeThresholdMs(args.nowMs, notice);
}

/**
 * Engine form: minNotice already converted to ms.
 * Equivalent to isMinNoticeNotMet when minNoticeMs = minutes * 60_000.
 */
export function isMinNoticeNotMetMs(args: {
  startAtMs: number;
  nowMs: number;
  minNoticeMs: number;
}): boolean {
  const noticeMs = Math.max(0, Number(args.minNoticeMs) || 0);
  if (noticeMs <= 0) return false;
  if (!(args.startAtMs > args.nowMs)) return false;
  return args.startAtMs < args.nowMs + noticeMs;
}
