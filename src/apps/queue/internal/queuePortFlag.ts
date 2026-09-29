import { isDrvoModuleExtractedPathEnabled } from '@/platform/drvo/featureFlags';

/**
 * DRVO-005 queue path gate.
 *
 * Normal authority: source-controlled `rollout` in moduleManifest.ts (currently legacy).
 * Env QUEUE_SCHEDULING_PORT is break-glass / compat only — see featureFlags.ts precedence.
 * DRVO_FORCE_QUEUE_PATH=legacy|extracted is the emergency override.
 */
export function isQueueSchedulingPortEnabled(): boolean {
  return isDrvoModuleExtractedPathEnabled('queue');
}
