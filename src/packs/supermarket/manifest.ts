import type { IndustryPackDefinition } from '@/platform/packs/types';

/** Supermarket Pack — selects and configures the same shared apps; not a fork. */
export const SUPERMARKET_PACK_CODE = 'supermarket' as const;

export const SUPERMARKET_PACK: IndustryPackDefinition = {
  packCode: SUPERMARKET_PACK_CODE,
  version: 2,
  displayName: 'Supermarket',
  required: ['pos'],
  recommended: ['inventory', 'purchasing', 'treasury', 'reports'],
  optional: ['attendance', 'payroll', 'messaging'],
  configDefaults: {
    compositionSurfaces: [],
  },
  onboarding: {
    catalogKind: 'products',
    jobOptions: ['كاشير', 'عامل مخزن', 'مشرف', 'مدير', 'اداري', 'موظف استقبال', 'أخرى'],
    bookableJobs: [],
    terminology: {
      branch: 'فرع',
      customer: 'عميل',
      catalogItem: 'منتج',
      teamMember: 'موظف',
      provider: 'موظف',
    },
  },
  publicSignup: {
    enabled: true,
    titleAr: 'متجر / Supermarket',
    descriptionAr: 'مبيعات + مخزون + مشتريات + تقارير',
    iconKey: 'store',
    defaultNeeds: ['pos', 'inventory', 'reports'],
  },
};
