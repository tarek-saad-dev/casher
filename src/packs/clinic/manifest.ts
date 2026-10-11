import type { IndustryPackDefinition } from '@/platform/packs/types';

export const CLINIC_PACK_CODE = 'clinic' as const;

/**
 * Clinic Pack — private clinic / outpatient center recipe.
 *
 * Patient identity reuses the shared customer master (TblClient). Booking remains
 * the scheduling source of truth and POS/Treasury remain the financial source of truth.
 * medical-records only owns protected clinical data and clinical workflow state.
 */
export const CLINIC_PACK: IndustryPackDefinition = {
  packCode: CLINIC_PACK_CODE,
  version: 1,
  displayName: 'Clinic',
  required: ['booking', 'medical-records'],
  recommended: ['pos', 'treasury', 'reports', 'messaging'],
  optional: ['attendance', 'payroll', 'inventory', 'purchasing', 'ai-receptionist'],
  configDefaults: {
    bookingMode: 'appointments_only',
    patientIdentity: 'shared-customer',
    medicalRecordsMode: 'outpatient',
    clinicalAiPolicy: 'administrative_only',
    currency: 'EGP',
  },
};
