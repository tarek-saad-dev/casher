import type { IndustryPackDefinition } from '@/platform/packs/types';
import { getAppInstallDependencies, isInstallableAppCode, isSelfServiceAvailableAppCode } from '@/platform/apps/appCatalog';

/** Only these planning options are exposed until readiness and pricing are approved. */
export const MODULAR_SELECTION_HOLD = new Set([
  'inventory', 'purchasing', 'messaging', 'ai-receptionist', 'loyalty',
]);
export type DraftCycle = 'monthly' | 'annual';
export class ModularDraftError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'ModularDraftError';
  }
}
export function catalogCodeForPack(pack: IndustryPackDefinition): string {
  if (pack.packCode !== 'salon' && pack.packCode !== 'supermarket') {
    throw new ModularDraftError('INDUSTRY_UNSUPPORTED', 'النشاط غير متاح لتجهيز المسودة حاليًا', 409);
  }
  return pack.packCode + '-selection-draft';
}

export function selectableDraftApps(pack: IndustryPackDefinition): Array<{
  code: string; group: 'required' | 'recommended' | 'optional'; selectable: boolean;
}> {
  const seen = new Set<string>();
  const result: Array<{code:string;group:'required'|'recommended'|'optional';selectable:boolean}> = [];
  for (const group of ['required','recommended','optional'] as const) {
    for (const code of pack[group]) {
      if (seen.has(code) || !isInstallableAppCode(code)) continue;
      seen.add(code);
      result.push({ code, group, selectable: isSelfServiceAvailableAppCode(code) && !MODULAR_SELECTION_HOLD.has(code) });
    }
  }
  return result;
}

/**
 * Validate tenant-selected planning data. Installed state and billing are intentionally
 * NOT involved; a saved wish-list is neither app installation nor commercial entitlement.
 */
export function validateModularDraftSelection(
  pack: IndustryPackDefinition,
  input: { apps: readonly string[]; branches: number; billingCycle: DraftCycle; expectedRevision: number | null },
): { apps: string[]; branches: number; billingCycle: DraftCycle; expectedRevision: number | null } {
  catalogCodeForPack(pack);
  if (!Number.isSafeInteger(input.branches) || input.branches < 1 || input.branches > 20) {
    throw new ModularDraftError('INVALID_BRANCH_COUNT', 'اختار عدد فروع من 1 إلى 20 للمسودة');
  }
  if (input.billingCycle !== 'monthly' && input.billingCycle !== 'annual') {
    throw new ModularDraftError('INVALID_CYCLE', 'اختار دفع شهري أو سنوي');
  }
  if (input.expectedRevision !== null &&
      (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
    throw new ModularDraftError('INVALID_REVISION', 'حدث الصفحة قبل الحفظ');
  }
  if (!Array.isArray(input.apps) || input.apps.length > 12 ||
      input.apps.some((x) => typeof x !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(x))) {
    throw new ModularDraftError('INVALID_APPS', 'اختيارات التطبيقات غير صحيحة');
  }
  const selected = new Set(input.apps);
  if (selected.size !== input.apps.length) {
    throw new ModularDraftError('DUPLICATE_APPS', 'مينفعش تختار التطبيق مرتين');
  }
  const available = new Map(selectableDraftApps(pack).map((x) => [x.code, x]));
  for (const app of selected) {
    if (!available.get(app)?.selectable) {
      throw new ModularDraftError('APP_UNAVAILABLE', 'التطبيق غير متاح للمسودة حاليًا: ' + app, 409);
    }
    if (!isInstallableAppCode(app)) {
      throw new ModularDraftError('APP_UNAVAILABLE', 'التطبيق غير معروف', 409);
    }
    for (const dep of getAppInstallDependencies(app)) {
      if (!selected.has(dep)) throw new ModularDraftError('DEPENDENCY_MISSING', 'التطبيق ' + app + ' يحتاج ' + dep, 409);
    }
  }
  for (const required of pack.required) {
    if (!selected.has(required)) {
      throw new ModularDraftError('REQUIRED_APP_MISSING', 'التطبيق الأساسي مطلوب: ' + required, 409);
    }
  }
  return { apps:[...selected].sort(), branches:input.branches,
    billingCycle:input.billingCycle, expectedRevision:input.expectedRevision };
}
