/**
 * Industry Pack contract.
 *
 * A pack is data, not a fork. Core/apps must read these policies instead of
 * scattering `if (packCode === ...)` branches across the product.
 */
export type IndustryCatalogKind = 'services' | 'products';

export type IndustryOnboardingProfile = {
  /** How the shared catalog should be presented during onboarding. */
  catalogKind: IndustryCatalogKind;
  /** Name used for the first location created by self-service signup. */
  defaultBranchName: string;
  /** Jobs offered when creating staff for this industry. Stored as ordinary TblEmp.Job strings. */
  jobOptions: readonly string[];
  /** Jobs that default to "can receive bookings". */
  bookableJobs: readonly string[];
  /** Human-facing labels only; underlying shared entities stay generic. */
  terminology: Readonly<{
    branch: string;
    customer: string;
    catalogItem: string;
    teamMember: string;
    provider: string;
  }>;
};

export type IndustryDemoService = Readonly<{
  name: string;
  arabicName?: string | null;
  categoryName?: string | null;
  price: number;
  durationMinutes: number;
}>;

export type IndustryDemoEmployee = Readonly<{
  name: string;
  job: string;
  acceptsBookings?: boolean;
}>;

export type IndustryPublicSignupProfile = {
  enabled: boolean;
  titleAr: string;
  descriptionAr: string;
  /** UI key — presentation layer maps it to an icon, never business logic. */
  iconKey: string;
  /** Generic need codes from the public signup funnel. */
  defaultNeeds: readonly string[];
  /** Optional light demo; no financial/medical records are fabricated here. */
  demoPreset?: Readonly<{
    services?: readonly IndustryDemoService[];
    employees?: readonly IndustryDemoEmployee[];
  }>;
};

export interface IndustryPackDefinition {
  packCode: string;
  version: number;
  displayName: string;
  /** Installed by default and cannot be removed while this pack is applied. */
  required: readonly string[];
  /** Installed by default; the tenant may remove them. */
  recommended: readonly string[];
  /** Not installed by default; suggested additions. */
  optional: readonly string[];
  /** Pack configuration defaults recorded in TenantIndustryPack.ConfigJson. */
  configDefaults: Readonly<Record<string, unknown>>;
  /** Data-driven onboarding/runtime semantics. */
  onboarding: IndustryOnboardingProfile;
  /** Safe public marketing/signup metadata. */
  publicSignup: IndustryPublicSignupProfile;
}

export interface AppCustomizations {
  add?: readonly string[];
  remove?: readonly string[];
}

export function packUsesServiceCatalog(
  pack: Pick<IndustryPackDefinition, 'onboarding'> | null | undefined,
): boolean {
  return pack?.onboarding.catalogKind === 'services';
}

export function packJobOptions(
  pack: Pick<IndustryPackDefinition, 'onboarding'> | null | undefined,
): readonly string[] {
  return pack?.onboarding.jobOptions ?? [];
}

export function packJobReceivesBookingsByDefault(
  pack: Pick<IndustryPackDefinition, 'onboarding'> | null | undefined,
  job: string | null | undefined,
): boolean {
  const normalized = String(job ?? '').trim().toLowerCase();
  return Boolean(
    normalized &&
      pack?.onboarding.bookableJobs.some((x) => String(x).trim().toLowerCase() === normalized),
  );
}
