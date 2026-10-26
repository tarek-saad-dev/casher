import { APP_REGISTRY_CODES, type AppRegistryCode } from '@/platform/registry/constants';
import { getAppInstallDependencies, isSelfServiceAvailableAppCode } from '@/platform/apps/appCatalog';

const VALID_CODES = new Set<string>(APP_REGISTRY_CODES);
export type ModularDraftInput = {
  tenantId: string;
  catalogStatus: 'draft' | 'approved' | 'retired';
  catalogIndustry: string;
  tenantIndustry: string;
  selectedApps: readonly string[];
  requiredApps: readonly string[];
  installedApps: readonly string[];
  subscriptionStatus: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled' | null;
};

export type ModularDraftShadow = {
  mode: 'shadow_only';
  source: 'modular_draft';
  canCharge: false;
  canActivate: false;
  grantsEntitlements: false;
  changesLegacySubscription: false;
  selectedApps: string[];
  missingInstalledApps: string[];
  installedOutsideDraft: string[];
  readiness: 'valid_draft' | 'invalid_selection' | 'catalog_not_approved';
  issues: string[];
};

/**
 * Shadow-only projection for the future modular commercial model.
 * This is NOT an authorization gate. Existing tenant access must continue to
 * use existing subscription, installed-app and role checks until a separately
 * approved payment/reconciliation cutover.
 */
export function evaluateModularDraftShadow(input: ModularDraftInput): ModularDraftShadow {
  const issues: string[] = [];
  if (!input.tenantId || typeof input.tenantId !== 'string') issues.push('TENANT_REQUIRED');
  if (input.tenantIndustry !== input.catalogIndustry) issues.push('INDUSTRY_MISMATCH');
  const selected = Array.isArray(input.selectedApps) ? input.selectedApps : [];
  const seen = new Set<string>();
  for (const app of selected) {
    if (seen.has(app)) issues.push('DUPLICATE_APP:' + app);
    seen.add(app);
    if (!VALID_CODES.has(app) || !isSelfServiceAvailableAppCode(app)) {
      issues.push('APP_NOT_ELIGIBLE:' + app);
      continue;
    }
    for (const dep of getAppInstallDependencies(app as AppRegistryCode)) {
      if (!seen.has(dep) && !selected.includes(dep)) issues.push('DEPENDENCY_MISSING:' + app + ':' + dep);
    }
  }
  for (const required of input.requiredApps) {
    if (!seen.has(required)) issues.push('REQUIRED_APP_MISSING:' + required);
  }
  const installed = new Set(input.installedApps);
  const missingInstalledApps = [...seen].filter((x) => !installed.has(x)).sort();
  const installedOutsideDraft = [...installed].filter((x) => !seen.has(x)).sort();
  if (missingInstalledApps.length) issues.push('NOT_INSTALLED');
  return {
    mode: 'shadow_only', source: 'modular_draft',
    canCharge: false, canActivate: false, grantsEntitlements: false,
    changesLegacySubscription: false,
    selectedApps: [...seen].sort(), missingInstalledApps, installedOutsideDraft,
    readiness: issues.length ? 'invalid_selection' : input.catalogStatus !== 'approved'
      ? 'catalog_not_approved' : 'valid_draft',
    issues,
  };
}
