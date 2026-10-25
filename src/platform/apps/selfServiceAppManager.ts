import type { IndustryPackDefinition } from '@/platform/packs/types';
import {
  findInstalledDependents,
  getAppInstallDependencies,
  isInstallableAppCode,
  isSelfServiceAvailableAppCode,
} from './appCatalog';
import { assertCanInstall, assertCanUninstall } from './compositionResolver';
import { TenantAppError } from './errors';
import type { TenantAppState } from './tenantApps';

export type SelfServiceAction = 'install' | 'disable';
export type AppManagerGroup = 'required' | 'recommended' | 'optional' | 'managed';
export type AppManagerItem = {
  code: string;
  name: string;
  description: string;
  group: AppManagerGroup;
  status: 'installed' | 'disabled' | 'available';
  source: TenantAppState['source'] | null;
  requires: string[];
  missingDependencies: string[];
  dependents: string[];
  canInstall: boolean;
  canDisable: boolean;
  lockedReason: string | null;
};

const PRESENTATION: Record<string, { name: string; description: string }> = {
  booking: { name: 'الحجوزات', description: 'مواعيد العملاء وإدارة الحجوزات' },
  queue: { name: 'الدور والانتظار', description: 'تنظيم أدوار العملاء' },
  pos: { name: 'نقطة البيع', description: 'الفواتير والمدفوعات والمبيعات' },
  inventory: { name: 'المخزون', description: 'الأصناف والكميات والحركات' },
  purchasing: { name: 'المشتريات', description: 'طلبات الشراء والتوريد' },
  attendance: { name: 'الحضور', description: 'حضور الموظفين وانصرافهم' },
  payroll: { name: 'الرواتب', description: 'مستحقات ورواتب الفريق' },
  treasury: { name: 'الخزنة', description: 'الحركات النقدية والتسويات' },
  reports: { name: 'التقارير', description: 'متابعة أداء المنشأة' },
  loyalty: { name: 'الولاء', description: 'برنامج ولاء العملاء' },
  messaging: { name: 'المراسلات', description: 'رسائل العملاء' },
  'ai-receptionist': { name: 'المساعد الذكي', description: 'ردود العملاء الآلية' },
};

export function appManagerLabel(code: string): string {
  return PRESENTATION[code]?.name ?? code;
}

/** Read-only projection. Missing/disabled rows are not mistaken for installed entitlements. */
export function buildAppManagerCatalog(
  pack: IndustryPackDefinition | null,
  states: readonly TenantAppState[],
  opts: { protectedTenant?: boolean } = {},
): AppManagerItem[] {
  const installed = new Set(states.filter((s) => s.status === 'installed').map((s) => s.appCode));
  const rows = new Map(states.map((s) => [s.appCode, s]));
  const groups = new Map<string, AppManagerGroup>();
  if (pack) {
    for (const group of ['required', 'recommended', 'optional'] as const) {
      for (const code of pack[group]) {
        if (isSelfServiceAvailableAppCode(code)) groups.set(code, group);
      }
    }
  }
  // Pre-existing operator-managed apps remain visible, not silently self-service manageable.
  for (const code of installed) if (isInstallableAppCode(code) && !groups.has(code)) groups.set(code, 'managed');

  return [...groups].map(([code, group]): AppManagerItem => {
    const state = rows.get(code);
    const present = installed.has(code);
    const requires = isInstallableAppCode(code) ? [...getAppInstallDependencies(code)] : [];
    const missingDependencies = requires.filter((dep) => !installed.has(dep));
    const dependents = isInstallableAppCode(code) ? findInstalledDependents(installed, code) : [];
    const managed = state?.source === 'platform_admin' || state?.source === 'bootstrap' || group === 'managed';
    const protectedTenant = opts.protectedTenant === true;
    const canInstall = !protectedTenant && !managed && !present;
    const canDisable = !protectedTenant && !managed && present && group !== 'required' && dependents.length === 0;
    const lockedReason = protectedTenant ? 'تطبيقات المنشأة الحالية تحت إدارة المنصة'
      : managed ? 'هذا التطبيق تحت إدارة المنصة'
      : group === 'required' && present ? 'تطبيق أساسي لنشاطك'
      : dependents.length > 0 && present ? 'يحتاجه: ' + dependents.map(appManagerLabel).join('، ')
      : null;
    return {
      code, name: appManagerLabel(code), description: PRESENTATION[code]?.description ?? '',
      group,
      status: present ? 'installed' : state?.status === 'disabled' ? 'disabled' : 'available',
      source: state?.source ?? null, requires, missingDependencies, dependents,
      canInstall, canDisable, lockedReason,
    };
  });
}

/**
 * Fail-closed plan checked again inside the tenant commercial applock before any write.
 * Dependencies are added atomically only with explicit confirmation.
 */
export function planSelfServiceChange(
  pack: IndustryPackDefinition | null,
  states: readonly TenantAppState[],
  args: { action: SelfServiceAction; appCode: string; confirmDependencies?: boolean },
): { action: SelfServiceAction; appCodes: string[]; autoAddedDependencies: string[] } {
  if (!pack) throw new TenantAppError('PACK_NOT_FOUND', 'لا توجد باقة نشاط مهيأة لهذه المنشأة', 409);
  const code = args.appCode.trim().toLowerCase();
  if (!isSelfServiceAvailableAppCode(code) ||
      ![...pack.required, ...pack.recommended, ...pack.optional].includes(code)) {
    throw new TenantAppError('APP_NOT_AVAILABLE', 'هذا التطبيق غير متاح للإدارة الذاتية', 403);
  }
  const installed = new Set(states.filter((s) => s.status === 'installed').map((s) => s.appCode));
  const byCode = new Map(states.map((s) => [s.appCode, s]));
  const restricted = (candidate: string) => {
    const source = byCode.get(candidate)?.source;
    if (source === 'bootstrap' || source === 'platform_admin') {
      throw new TenantAppError('APP_NOT_AVAILABLE', 'هذا التطبيق تديره المنصة', 403);
    }
    if (!isSelfServiceAvailableAppCode(candidate) ||
        ![...pack.required, ...pack.recommended, ...pack.optional].includes(candidate)) {
      throw new TenantAppError('APP_NOT_AVAILABLE', 'التطبيق المطلوب ليس متاحًا لنشاطك', 403);
    }
  };
  restricted(code);

  if (args.action === 'disable') {
    assertCanUninstall(installed, code, pack);
    return { action: 'disable', appCodes: [code], autoAddedDependencies: [] };
  }
  if (args.action !== 'install') throw new TenantAppError('APP_NOT_AVAILABLE', 'عملية غير مدعومة', 400);
  if (installed.has(code)) throw new TenantAppError('APP_ALREADY_INSTALLED', 'التطبيق مفعّل بالفعل', 409);

  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (candidate: string): void => {
    if (installed.has(candidate) || visited.has(candidate)) return;
    restricted(candidate);
    if (visiting.has(candidate)) throw new TenantAppError('MISSING_DEPENDENCIES', 'حلقة اعتماد بين التطبيقات', 400);
    visiting.add(candidate);
    if (!isInstallableAppCode(candidate)) throw new TenantAppError('UNKNOWN_APP', 'تطبيق غير معروف', 400);
    for (const dep of getAppInstallDependencies(candidate)) visit(dep);
    visiting.delete(candidate);
    visited.add(candidate);
    order.push(candidate);
  };
  visit(code);
  const autoAddedDependencies = order.filter((candidate) => candidate !== code);
  if (autoAddedDependencies.length && args.confirmDependencies !== true) {
    throw new TenantAppError('MISSING_DEPENDENCIES', 'تفعيل التطبيق يحتاج تطبيقات أخرى', 409, {
      dependencies: autoAddedDependencies,
    });
  }
  const simulated = new Set(installed);
  for (const candidate of order) {
    assertCanInstall(simulated, candidate);
    simulated.add(candidate);
  }
  return { action: 'install', appCodes: order, autoAddedDependencies };
}
