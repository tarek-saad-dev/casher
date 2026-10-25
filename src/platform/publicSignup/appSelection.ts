import { findIndustryPack } from '@/packs';
import { isLegacyOnlyAppCode, getAppInstallDependencies } from '@/platform/apps/appCatalog';
import { resolveTenantComposition } from '@/platform/apps/compositionResolver';
import { TenantAppError } from '@/platform/apps/errors';

/**
 * Self-service signup may only offer apps declared by the selected Industry Pack.
 * Channel-dependent products are not commercially self-service ready in V1.
 * Operator-managed installation remains governed by the generic app policy.
 */
const SELF_SERVICE_UNAVAILABLE = new Set(['messaging', 'ai-receptionist']);

export type SignupAppOption = {
  code: string;
  group: 'required' | 'recommended' | 'optional';
  requires: readonly string[];
};

export class PublicSignupAppSelectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PublicSignupAppSelectionError';
  }
}

export function getPublicSignupAppChoices(industry: string): {
  packCode: string;
  packVersion: number;
  apps: SignupAppOption[];
  defaults: string[];
} {
  const pack = findIndustryPack(industry);
  if (!pack) throw new PublicSignupAppSelectionError('INDUSTRY_INVALID', 'اختر نشاط متاح.');
  const apps: SignupAppOption[] = [];
  for (const group of ['required', 'recommended', 'optional'] as const) {
    for (const code of pack[group]) {
      if (SELF_SERVICE_UNAVAILABLE.has(code) || isLegacyOnlyAppCode(code)) continue;
      apps.push({ code, group, requires: [...getAppInstallDependencies(code as Parameters<typeof getAppInstallDependencies>[0])] });
    }
  }
  return {
    packCode: pack.packCode,
    packVersion: pack.version,
    apps,
    defaults: apps.filter((item) => item.group !== 'optional').map((item) => item.code),
  };
}

/** Validate the exact requested app set before any tenant or signup DB mutation. */
export function resolvePublicSignupAppSelection(industry: string, raw: unknown): {
  apps: string[];
  customizations: { add: string[]; remove: string[] };
} {
  const choices = getPublicSignupAppChoices(industry);
  if (!Array.isArray(raw) || raw.length > choices.apps.length ||
    raw.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new PublicSignupAppSelectionError('APP_SELECTION_INVALID', 'اختيارات التطبيقات غير صحيحة.');
  }
  const requested = raw.map((item: string) => item.trim().toLowerCase());
  if (new Set(requested).size !== requested.length) {
    throw new PublicSignupAppSelectionError('APP_SELECTION_INVALID', 'التطبيق متكرر في الاختيارات.');
  }
  const allowed = new Set(choices.apps.map((item) => item.code));
  if (requested.some((code: string) => !allowed.has(code))) {
    throw new PublicSignupAppSelectionError('APP_NOT_AVAILABLE', 'التطبيق ده مش متاح للتسجيل الذاتي.');
  }
  const selected = new Set<string>(requested);
  if (choices.apps.some((item) => item.group === 'required' && !selected.has(item.code))) {
    throw new PublicSignupAppSelectionError('REQUIRED_BY_PACK', 'مينفعش تشيل التطبيقات الأساسية للنشاط.');
  }
  const defaults = new Set(choices.defaults);
  const customizations: { add: string[]; remove: string[] } = {
    add: requested.filter((code: string) => !defaults.has(code)),
    remove: choices.apps
      .filter((item) => item.group === 'recommended' && !selected.has(item.code))
      .map((item) => item.code),
  };
  const pack = findIndustryPack(industry)!;
  try {
    const resolved = resolveTenantComposition(pack, customizations);
    return { apps: resolved.apps, customizations };
  } catch (err) {
    if (err instanceof TenantAppError) {
      throw new PublicSignupAppSelectionError(err.code, 'التطبيق المختار محتاج تطبيق آخر. راجع اختياراتك.');
    }
    throw err;
  }
}
