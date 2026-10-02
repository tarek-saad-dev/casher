import { isDrvoModuleExtractedPathEnabled } from '@/platform/drvo/featureFlags';

/**
 * DRVO-010 POS sale Treasury update/delete mutation gate.
 *
 * Normal authority: source-controlled `rollout` in moduleManifest for `pos-sale-treasury-mutation`.
 * Env POS_SALE_TREASURY_MUTATION_PORT is break-glass / compat only.
 * DRVO_FORCE_POS_SALE_TREASURY_MUTATION_PATH=legacy|extracted is the emergency override.
 *
 * Default rollout is extracted after DRVO-010 Stage 2 activation. Emergency rollback remains force-path legacy.
 */
export function isPosSaleTreasuryMutationEnabled(): boolean {
  return isDrvoModuleExtractedPathEnabled('pos-sale-treasury-mutation');
}
