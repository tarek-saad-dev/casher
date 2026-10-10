import type { IndustryPackDefinition } from '@/platform/packs/types';
import { SALON_PACK } from './salon/public';
import { SUPERMARKET_PACK } from './supermarket/public';

/** Source-controlled Industry Pack registry (V1). Injected into platform services by routes. */
export const INDUSTRY_PACKS: readonly IndustryPackDefinition[] = [SALON_PACK, SUPERMARKET_PACK];

export const DEFAULT_INDUSTRY_PACK_CODE = SALON_PACK.packCode;

export function findIndustryPack(packCode: string): IndustryPackDefinition | null {
  const code = String(packCode ?? '').trim().toLowerCase();
  return INDUSTRY_PACKS.find((p) => p.packCode === code) ?? null;
}
