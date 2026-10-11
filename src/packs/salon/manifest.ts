import {
  APP_REGISTRY_CODES,
  OPERATIONS_SURFACE_CODE,
} from '@/platform/registry/constants';
import type { IndustryPackDefinition } from '@/platform/packs/types';

/**
 * Salon Pack — recipe, not a fork.
 * operations is a composition surface and is never an installed app.
 */
export const SALON_PACK_CODE = 'salon' as const;
export const SALON_PACK_SURFACES = [OPERATIONS_SURFACE_CODE] as const;

export const SALON_PACK: IndustryPackDefinition = {
  packCode: SALON_PACK_CODE,
  version: 2,
  displayName: 'Salon',
  required: ['booking'],
  recommended: ['queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports'],
  optional: ['inventory', 'purchasing', 'messaging', 'ai-receptionist'],
  configDefaults: {
    compositionSurfaces: [...SALON_PACK_SURFACES],
    bookingMode: 'appointments_and_walk_in',
  },
  onboarding: {
    catalogKind: 'services',
    defaultBranchName: 'الفرع الرئيسي',
    jobOptions: [
      'حلاق',
      'تنظيف بشرة',
      'مساعد',
      'اداري',
      'مدير',
      'موظف استقبال',
      'مجمّل',
      'معالج تدليك',
      'أخصائي أظافر',
      'مصفف مكياج',
      'مصفف شعر',
      'أخصائي تجميل',
      'أخرى',
    ],
    // Preserve existing salon public-booking policy exactly.
    bookableJobs: ['حلاق', 'مساعد', 'Barber', 'barber'],
    terminology: {
      branch: 'فرع',
      customer: 'عميل',
      catalogItem: 'خدمة',
      teamMember: 'موظف',
      provider: 'مقدم خدمة',
    },
  },
  publicSignup: {
    enabled: true,
    titleAr: 'صالون / Barbershop',
    descriptionAr: 'حجوزات + كاشير + فريق + رواتب',
    iconKey: 'scissors',
    defaultNeeds: ['booking', 'pos', 'workforce', 'reports'],
    demoPreset: {
      services: [
        { name: 'Hair Cut', arabicName: 'قص شعر', categoryName: 'خدمات', price: 200, durationMinutes: 30 },
        { name: 'Beard Styling', arabicName: 'تهذيب دقن', categoryName: 'خدمات', price: 100, durationMinutes: 20 },
        { name: 'Hair & Beard', arabicName: 'شعر ودقن', categoryName: 'خدمات', price: 280, durationMinutes: 45 },
        { name: 'Classic Skin Care', arabicName: 'تنظيف بشرة كلاسيك', categoryName: 'خدمات', price: 300, durationMinutes: 45 },
      ],
      employees: [
        { name: 'أحمد Demo', job: 'حلاق', acceptsBookings: true },
        { name: 'كريم Demo', job: 'حلاق', acceptsBookings: true },
      ],
    },
  },
};

/** Bootstrap compatibility manifest — CASHER_BOOT keeps every registered app. */
export function getBootstrapSalonManifest() {
  return {
    packCode: SALON_PACK_CODE,
    enabledApps: [...APP_REGISTRY_CODES],
    compositionSurfaces: [...SALON_PACK_SURFACES],
    extensions: ['cut-club'],
  };
}
