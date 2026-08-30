/** Booking Management V1 — production-safe, default OFF. */
export function isBookingManagementV1Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.BOOKING_MANAGEMENT_V1 ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function normalizeCanaryPhone(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '');
}

function phonesMatch(a: string, b: string): boolean {
  const x = normalizeCanaryPhone(a);
  const y = normalizeCanaryPhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.length < 8) return false;
  return longer.endsWith(shorter);
}

export function getBookingManagementCanaryPhones(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = String(env.BOOKING_MANAGEMENT_CANARY_PHONES ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizeCanaryPhone(p))
    .filter((p) => p.length >= 8);
}

/**
 * - Flag OFF → false
 * - Flag ON + empty canary → true (global)
 * - Flag ON + non-empty canary → matching phones only
 */
export function isBookingManagementActiveForPhone(
  phone: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isBookingManagementV1Enabled(env)) return false;
  const canary = getBookingManagementCanaryPhones(env);
  if (canary.length === 0) return true;
  if (phone == null || String(phone).trim() === '') return false;
  return canary.some((c) => phonesMatch(c, String(phone)));
}
