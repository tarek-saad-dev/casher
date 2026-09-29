import { isStrictOptInEnvFlag } from '@/platform/drvo/featureFlags';

/**
 * DRVO-005 rollout gate (strict opt-in).
 * Extracted path runs only when QUEUE_SCHEDULING_PORT=true (exact literal).
 */
export function isQueueSchedulingPortEnabled(): boolean {
  return isStrictOptInEnvFlag(process.env.QUEUE_SCHEDULING_PORT);
}
