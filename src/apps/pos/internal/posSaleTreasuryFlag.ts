import { isDrvoModuleExtractedPathEnabled } from '@/platform/drvo/featureFlags';

/**
 * DRVO-009 POS sale Treasury posting gate.
 *
 * Normal authority: source-controlled `rollout` in moduleManifest for `pos-sale-treasury`.
 * Env POS_SALE_TREASURY_PORT is break-glass / compat only.
 * DRVO_FORCE_POS_SALE_TREASURY_PATH=legacy|extracted is the emergency override.
 *
 * Default rollout is legacy — trigger-only sale CashMove until migration + activation PR.
 */
export function isPosSaleTreasuryPostingEnabled(): boolean {
  return isDrvoModuleExtractedPathEnabled('pos-sale-treasury');
}
