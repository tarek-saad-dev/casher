import { isDrvoModuleExtractedPathEnabled } from '@/platform/drvo/featureFlags';

/**
 * DRVO-008 POS path gate.
 *
 * Normal authority: source-controlled `rollout` in moduleManifest.ts (currently legacy).
 * Env POS_SCHEDULING_PORT is break-glass / compat only — see featureFlags.ts precedence.
 * DRVO_FORCE_POS_PATH=legacy|extracted is the emergency override.
 */
export function isPosPortEnabled(): boolean {
  return isDrvoModuleExtractedPathEnabled('pos');
}
