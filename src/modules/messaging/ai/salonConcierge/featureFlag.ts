/** Salon Concierge Brain V1 — feature flag */
export function isSalonConciergeBrainEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.SALON_CONCIERGE_BRAIN_V1 ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}
