import { APP_REGISTRY_CODES, type AppRegistryCode } from '@/platform/registry/constants';

/**
 * Installable tenant apps (DRVO-012).
 *
 * Only AppRegistry app codes are installable. The `operations` composition
 * surface, Platform Core capabilities and Shared Domains (Customers, Catalog,
 * Workforce, Operational Calendar) are not part of this catalog.
 */
export interface InstallableAppDefinition {
  appCode: AppRegistryCode;
  /** Apps that must be installed before this app can be installed. */
  requires: readonly AppRegistryCode[];
}

/**
 * Install-time dependencies proven by code contracts only.
 * Decisions and evidence: docs/drvo/DRVO-012-IMPLEMENTATION-NOTE.md §App dependencies.
 *
 * - purchasing -> inventory: posting a purchase receives stock through the
 *   inventory mutation ledger (src/lib/inventory/purchaseInventory.service.ts).
 *
 * Deliberately NOT install-time dependencies:
 * - pos -> treasury: sale cash posting is accounting infrastructure and must
 *   keep running when the Treasury app is disabled.
 * - payroll -> attendance: implementation relationship, unproven as a hard requirement.
 * - ai-receptionist -> booking/messaging: app is a skeleton; nothing to prove.
 */
const INSTALL_DEPENDENCIES: Partial<Record<AppRegistryCode, readonly AppRegistryCode[]>> = {
  purchasing: ['inventory'],
};

const INSTALLABLE = new Set<string>(APP_REGISTRY_CODES);

/**
 * DRVO-013 V1: apps whose data is still global legacy CASHER_BOOT data (no TenantId) and must not
 * be installed for any other tenant. CASHER_BOOT keeps them through its grandfathered state.
 * Loyalty: TblLoyalty* / TblClientInventory are global until Loyalty is made multi-tenant.
 */
const LEGACY_ONLY_APPS = new Set<string>(['loyalty']);

export function isInstallableAppCode(code: string): code is AppRegistryCode {
  return INSTALLABLE.has(code);
}

export function isLegacyOnlyAppCode(code: string): boolean {
  return LEGACY_ONLY_APPS.has(code);
}

export function getAppInstallDependencies(code: AppRegistryCode): readonly AppRegistryCode[] {
  return INSTALL_DEPENDENCIES[code] ?? [];
}

export function getInstallableAppCatalog(): InstallableAppDefinition[] {
  return APP_REGISTRY_CODES.map((appCode) => ({
    appCode,
    requires: getAppInstallDependencies(appCode),
  }));
}

/** Installed apps that directly require `code`. */
export function findInstalledDependents(
  installed: Iterable<string>,
  code: AppRegistryCode,
): AppRegistryCode[] {
  const out: AppRegistryCode[] = [];
  for (const app of installed) {
    if (!isInstallableAppCode(app) || app === code) continue;
    if (getAppInstallDependencies(app).includes(code)) out.push(app);
  }
  return out.sort();
}

/** Missing dependencies for every app in `apps`, keyed by app. */
export function findMissingDependencies(
  apps: Iterable<string>,
): Array<{ appCode: AppRegistryCode; missing: AppRegistryCode[] }> {
  const set = new Set(apps);
  const out: Array<{ appCode: AppRegistryCode; missing: AppRegistryCode[] }> = [];
  for (const app of [...set].sort()) {
    if (!isInstallableAppCode(app)) continue;
    const missing = getAppInstallDependencies(app).filter((dep) => !set.has(dep));
    if (missing.length) out.push({ appCode: app, missing: [...missing] });
  }
  return out;
}
