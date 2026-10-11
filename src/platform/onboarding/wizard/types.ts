import type { ProvisionTenantResult, TenantReadinessReport } from '../types';

/** Customer onboarding wizard (V1). Client-safe types: no server imports. */

export const WIZARD_STEPS = [
  'business',
  'branches',
  'services',
  'team',
  'users',
  'apps',
  'plan',
  'booking',
  'ai',
  'review',
] as const;
export type WizardStepKey = (typeof WIZARD_STEPS)[number];

export type OnboardingBusinessInput = {
  businessName: string;
  tenantCode: string;
  industryPackCode: string;
  timezone: string;
  currency: string;
  businessPhone?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  receiptFooter?: string | null;
};

export type OnboardingBranchInput = {
  branchName: string;
  branchCode: string;
  shortName?: string | null;
  address?: string | null;
  phone?: string | null;
  /** Defaults to the business timezone. */
  timezone?: string | null;
  defaultOpenTime?: string | null;
  defaultCloseTime?: string | null;
};

export type OnboardingServiceInput = {
  name: string;
  arabicName?: string | null;
  /** Category name inside the new tenant; defaults to the seeded "خدمات" category. */
  categoryName?: string | null;
  price: number;
  durationMinutes: number;
  active: boolean;
};

export type OnboardingEmployeeInput = {
  name: string;
  /** Canonical JobType value. */
  job: string;
  primaryBranchCode: string;
  active: boolean;
  /** Only meaningful when the booking app is installed. */
  acceptsBookings?: boolean;
  /** Payroll fields (HR model); only used when attendance/payroll apps are installed. */
  employmentType?: string | null;
  payrollMethod?: string | null;
  payRate?: number | null;
};

export type OnboardingOwnerInput = {
  displayName: string;
  loginName: string;
  password: string;
};

export type OnboardingUserInput = {
  displayName: string;
  loginName: string;
  password: string;
  roleKey: string;
  defaultBranchCode: string;
};

export type OnboardingAppsInput = {
  /** Optional pack apps switched on. */
  add: string[];
  /** Recommended pack apps switched off. */
  remove: string[];
};

export type OnboardingSubscriptionInput = {
  planCode: string;
  status: 'trial' | 'active';
};

export type OnboardingBookingInput = {
  branchCode: string;
  defaultMode: string;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxBookingDaysAhead: number;
  defaultServiceDurationMinutes: number;
  allowSpecificBarber: boolean;
  allowNearestBarber: boolean;
};

export type OnboardingAiInput = {
  businessName: string;
  locale: string;
  assistantPersona?: string | null;
  websiteUrl?: string | null;
  bookingUrl?: string | null;
  policies: string[];
  /** Opt into salon-concierge-v1 (salon only). */
  useSalonConciergePack: boolean;
};

/** Everything the operator entered. The first branch is created by the core provisioning. */
export type OnboardingRequest = {
  business: OnboardingBusinessInput;
  branches: OnboardingBranchInput[];
  services: OnboardingServiceInput[];
  employees: OnboardingEmployeeInput[];
  owner: OnboardingOwnerInput;
  users: OnboardingUserInput[];
  apps: OnboardingAppsInput;
  subscription: OnboardingSubscriptionInput;
  booking: OnboardingBookingInput[];
  ai: OnboardingAiInput | null;
};

export type OnboardingIssueSeverity = 'error' | 'attention';

export type OnboardingIssue = {
  step: WizardStepKey;
  severity: OnboardingIssueSeverity;
  field?: string;
  message: string;
};

export const ONBOARDING_STAGES = ['branches', 'services', 'team', 'users', 'booking', 'ai'] as const;
export type OnboardingStageKey = (typeof ONBOARDING_STAGES)[number];

export type OnboardingStageStatus = 'done' | 'skipped' | 'failed' | 'blocked';

export type OnboardingStageResult = {
  stage: OnboardingStageKey;
  status: OnboardingStageStatus;
  /** Rows created by this run. */
  created: number;
  /** Rows that already existed (safe retry). */
  existing: number;
  message?: string;
  errorCode?: string;
};

export type OnboardingCoreSummary = Pick<
  ProvisionTenantResult,
  | 'tenantId'
  | 'tenantCode'
  | 'branchCode'
  | 'ownerLoginName'
  | 'industryPackCode'
  | 'apps'
  | 'planCode'
  | 'subscriptionStatus'
  | 'trialEndsAt'
>;

export type OnboardingResult = {
  core: OnboardingCoreSummary;
  stages: OnboardingStageResult[];
  /** True when every applicable stage is done or skipped. */
  complete: boolean;
  readiness: TenantReadinessReport | null;
};
