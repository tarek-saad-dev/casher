import { OPERATIONS_SURFACE_CODE } from '@/platform/registry/constants';
import type { IndustryPackDefinition } from '@/platform/packs/types';

/**
 * Clinic Pack V1 — general outpatient clinic operations.
 *
 * Reuses Shared Domains + Apps:
 * patients -> Customers, consultations -> Catalog, doctors/staff -> Workforce,
 * appointments -> Booking, billing -> POS/Treasury.
 *
 * Clinical notes, diagnoses and prescriptions are intentionally NOT stored in shared
 * customer/booking tables. They belong to a future isolated clinical-records app.
 */
export const CLINIC_PACK_CODE = 'clinic' as const;
export const CLINIC_PACK_SURFACES = [OPERATIONS_SURFACE_CODE] as const;

export const CLINIC_PACK: IndustryPackDefinition = {
  packCode: CLINIC_PACK_CODE,
  version: 1,
  displayName: 'Clinic',
  required: ['booking'],
  recommended: ['queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports'],
  optional: ['inventory', 'purchasing', 'messaging', 'ai-receptionist'],
  configDefaults: {
    compositionSurfaces: [...CLINIC_PACK_SURFACES],
    bookingMode: 'appointments_and_walk_in',
    futureExtensions: ['clinical-records'],
  },
  onboarding: {
    catalogKind: 'services',
    jobOptions: [
      'طبيب',
      'طبيب أسنان',
      'ممرض',
      'مساعد طبي',
      'موظف استقبال',
      'فني',
      'اداري',
      'مدير',
      'أخرى',
    ],
    bookableJobs: ['طبيب', 'طبيب أسنان'],
    terminology: {
      branch: 'عيادة / فرع',
      customer: 'مريض',
      catalogItem: 'خدمة / كشف',
      teamMember: 'عضو فريق',
      provider: 'طبيب',
    },
  },
  publicSignup: {
    enabled: true,
    titleAr: 'عيادة / Clinic',
    descriptionAr: 'مواعيد + مرضى + تحصيل + فريق + تقارير',
    iconKey: 'clinic',
    defaultNeeds: ['booking', 'pos', 'workforce', 'reports'],
    demoPreset: {
      services: [
        { name: 'General Consultation', arabicName: 'كشف طبي', categoryName: 'خدمات', price: 350, durationMinutes: 30 },
        { name: 'Follow-up', arabicName: 'متابعة', categoryName: 'خدمات', price: 200, durationMinutes: 20 },
        { name: 'Medical Consultation', arabicName: 'استشارة', categoryName: 'خدمات', price: 300, durationMinutes: 30 },
      ],
      employees: [
        { name: 'د. أحمد Demo', job: 'طبيب', acceptsBookings: true },
        { name: 'د. منى Demo', job: 'طبيب', acceptsBookings: true },
      ],
    },
  },
};
