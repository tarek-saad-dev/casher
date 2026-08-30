/**
 * Hub: production = SQL (never fixtures). Tests = in-memory fixture via CONCIERGE_TEST_HUB/VITEST.
 */
import { isConciergeTestHub } from './defaults';
import type { ConciergeSnapshot } from './types';

export async function loadConciergeSnapshot(opts?: {
  includeInactive?: boolean;
}): Promise<ConciergeSnapshot> {
  if (isConciergeTestHub()) {
    const { fixtureSnapshot } = await import('./knowledgeStore');
    return fixtureSnapshot();
  }
  const { loadProductionSnapshot } = await import('./sqlRepository');
  return loadProductionSnapshot(opts);
}
