/** Human Handoff V1 — production-safe, default OFF. */
export function isHumanHandoffV1Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.HUMAN_HANDOFF_V1 ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

export function getHumanHandoffLeaseMinutes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.HUMAN_HANDOFF_LEASE_MINUTES);
  if (Number.isFinite(n) && n >= 1 && n <= 24 * 60) return Math.floor(n);
  return 15;
}

export function getHumanHandoffCorrelationWindowMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.HUMAN_HANDOFF_CORRELATION_WINDOW_MS);
  if (Number.isFinite(n) && n >= 1000 && n <= 120_000) return Math.floor(n);
  return 30_000;
}

/** Digits-only phone for canary matching (no full-list logging). */
export function normalizeHandoffCanaryPhone(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '');
}

/**
 * Match local vs E.164 forms (e.g. 0155… vs 20155…).
 * Requires at least 8 overlapping trailing digits.
 */
export function phonesMatchHandoffCanary(a: string, b: string): boolean {
  const x = normalizeHandoffCanaryPhone(a);
  const y = normalizeHandoffCanaryPhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  if (shorter.length < 8) return false;
  return longer.endsWith(shorter);
}

/**
 * Optional canary allowlist. Empty ⇒ global when HUMAN_HANDOFF_V1 is on.
 * Separators: comma, semicolon, whitespace.
 */
export function getHumanHandoffCanaryPhones(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = String(env.HUMAN_HANDOFF_CANARY_PHONES ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizeHandoffCanaryPhone(p))
    .filter((p) => p.length >= 8);
}

/**
 * Effective handoff for a conversation phone.
 * - Flag OFF → false for everyone
 * - Flag ON + empty canary → true (global)
 * - Flag ON + non-empty canary → true only for matching phones
 */
export function isHumanHandoffActiveForPhone(
  phone: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isHumanHandoffV1Enabled(env)) return false;
  const canary = getHumanHandoffCanaryPhones(env);
  if (canary.length === 0) return true;
  if (phone == null || String(phone).trim() === '') return false;
  return canary.some((c) => phonesMatchHandoffCanary(c, String(phone)));
}
