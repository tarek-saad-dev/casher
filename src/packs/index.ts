import type { IndustryPackDefinition } from '@/platform/packs/types';
import { SALON_PACK } from './salon/public';
import { SUPERMARKET_PACK } from './supermarket/public';
import { CLINIC_PACK } from './clinic/public';

/** Source-controlled Industry Pack registry (V1). Injected into platform services by routes. */
export const INDUSTRY_PACKS: readonly IndustryPackDefinition[] = [SALON_PACK, CLINIC_PACK, SUPERMARKET_PACK];

export const DEFAULT_INDUSTRY_PACK_CODE = SALON_PACK.packCode;

export function findIndustryPack(packCode: string): IndustryPackDefinition | null {
  const code = String(packCode ?? '').trim().toLowerCase();
  return INDUSTRY_PACKS.find((p) => p.packCode === code) ?? null;
}


/** Safe public projection. Adding a new public industry means adding one pack manifest, not editing the signup UI. */
export function listPublicIndustryPacks() {
  return INDUSTRY_PACKS
    .filter((p) => p.publicSignup.enabled)
    .map((p) => ({
      code: p.packCode,
      titleAr: p.publicSignup.titleAr,
      descriptionAr: p.publicSignup.descriptionAr,
      iconKey: p.publicSignup.iconKey,
      defaultNeeds: [...p.publicSignup.defaultNeeds],
      supportsDemo: Boolean(p.publicSignup.demoPreset),
      catalogKind: p.onboarding.catalogKind,
      terminology: p.onboarding.terminology,
    }));
}
