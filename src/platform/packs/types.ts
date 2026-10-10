/**
 * Industry Pack contract (DRVO-012). A pack is a recommended business recipe:
 * it never forks DRVOERP and never decides commercial limits.
 * Concrete packs live in src/packs/* and are injected into platform services.
 */
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
}

export interface AppCustomizations {
  add?: readonly string[];
  remove?: readonly string[];
}
