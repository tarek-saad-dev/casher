/**
 * Strict opt-in rollout flags for DRVO strangler paths.
 * Only the literal string "true" enables extracted behavior.
 */
export function isStrictOptInEnvFlag(value: string | undefined): boolean {
  return value === 'true';
}
