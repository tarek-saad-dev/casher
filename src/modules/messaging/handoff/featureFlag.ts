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
