import type { IndustryPackDefinition } from '@/platform/packs/types';

/** Supermarket Pack — selects and configures the same apps; not a fork. */
export const SUPERMARKET_PACK_CODE = 'supermarket' as const;

export const SUPERMARKET_PACK: IndustryPackDefinition = {
  packCode: SUPERMARKET_PACK_CODE,
  version: 1,
  displayName: 'Supermarket',
  required: ['pos'],
  recommended: ['inventory', 'purchasing', 'treasury', 'reports'],
  optional: ['attendance', 'payroll', 'messaging'],
  configDefaults: {
    compositionSurfaces: [],
  },
};
