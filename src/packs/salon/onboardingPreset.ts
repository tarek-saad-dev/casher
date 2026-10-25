/**
 * Salon-owned initial booking and demo-data recipe for a new tenant.
 *
 * This is only a template: no CUT employees, service IDs, branch IDs, or
 * existing tenant records are read or copied. The onboarding coordinator
 * persists the returned records under the freshly provisioned tenant.
 */
import type {
  OnboardingBookingInput,
  OnboardingEmployeeInput,
  OnboardingServiceInput,
} from '@/platform/onboarding/wizard/types';

export type SalonOnboardingPreset = {
  booking: OnboardingBookingInput[];
  services: OnboardingServiceInput[];
  employees: OnboardingEmployeeInput[];
};

const DEMO_SERVICES: readonly OnboardingServiceInput[] = [
  { name: 'Hair Cut', arabicName: 'قص شعر', categoryName: 'خدمات', price: 200, durationMinutes: 30, active: true },
  { name: 'Beard Styling', arabicName: 'تهذيب دقن', categoryName: 'خدمات', price: 100, durationMinutes: 20, active: true },
  { name: 'Hair & Beard', arabicName: 'شعر ودقن', categoryName: 'خدمات', price: 280, durationMinutes: 45, active: true },
  { name: 'Classic Skin Care', arabicName: 'تنظيف بشرة كلاسيك', categoryName: 'خدمات', price: 300, durationMinutes: 45, active: true },
];

const DEMO_TEAM: readonly Pick<OnboardingEmployeeInput, 'name' | 'job' | 'active' | 'acceptsBookings'>[] = [
  { name: 'أحمد Demo', job: 'حلاق', active: true, acceptsBookings: true },
  { name: 'كريم Demo', job: 'حلاق', active: true, acceptsBookings: true },
];

/**
 * Returns fresh records for each signup. The only branch reference comes from
 * the new tenant's generated branch code; never use a CUT branch as a template.
 * Public booking activation remains OFF in the onboarding coordinator.
 */
export function buildSalonOnboardingPreset(input: {
  branchCode: string;
  startMode: 'real' | 'demo';
}): SalonOnboardingPreset {
  const branchCode = String(input.branchCode ?? '').trim();
  if (!branchCode) throw new Error('Salon onboarding requires the new tenant branch code');

  return {
    booking: [{
      branchCode,
      defaultMode: 'nearest',
      slotIntervalMinutes: 15,
      minNoticeMinutes: 30,
      maxBookingDaysAhead: 14,
      defaultServiceDurationMinutes: 30,
      allowSpecificBarber: true,
      allowNearestBarber: true,
    }],
    services: input.startMode === 'demo' ? DEMO_SERVICES.map((service) => ({ ...service })) : [],
    employees: input.startMode === 'demo'
      ? DEMO_TEAM.map((employee) => ({ ...employee, primaryBranchCode: branchCode }))
      : [],
  };
}
