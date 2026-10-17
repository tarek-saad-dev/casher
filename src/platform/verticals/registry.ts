/**
 * DRVO vertical capability catalog.
 *
 * Product configuration, NOT tenant authorization. A vertical never grants
 * a module entitlement, role permission, or access to operational records.
 * Every backend operation must independently verify tenant membership,
 * module entitlement, permission, and tenant/location ownership.
 */
import { DRVO_MODULES, type DrvoModuleKey } from '@/platform/modules/registry';

export const DRVO_CORE_CAPABILITIES = {
  identity: { title: 'الشركات والفروع', description: 'عضويات وعزل بيانات الشركات والفروع' },
  access: { title: 'الأدوار والصلاحيات', description: 'صلاحيات منفصلة لكل عملية داخل الشركة' },
  commerce: { title: 'محرك المعاملات', description: 'كتالوج، سلة، تسعير، دفع، فواتير، مرتجعات' },
  customers: { title: 'العملاء', description: 'ملف عميل مشترك مع امتدادات متخصصة' },
  audit: { title: 'سجل العمليات', description: 'تتبع العمليات المالية والإدارية' },
} as const;

export const DRVO_VERTICALS = {
  barbershop: {
    key: 'barbershop',
    title: 'صالونات الحلاقة',
    description: 'خدمات الحلاقة والموظفين والمواعيد والعمولات والباكدجات',
    recommendedModules: ['pos', 'booking', 'hr', 'inventory', 'treasury', 'reports', 'online_booking'],
    extensions: [
      { key: 'barber.chairs', title: 'الكراسي والحلاقون', core: 'booking' },
      { key: 'barber.service_packages', title: 'باقات الخدمات', core: 'pos' },
      { key: 'barber.commissions', title: 'عمولات الحلاقين', core: 'hr' },
      { key: 'barber.walkin_queue', title: 'الدور والحضور المباشر', core: 'booking' },
    ],
  },
  clinic: {
    key: 'clinic',
    title: 'العيادات الطبية',
    description: 'الأطباء والمواعيد والزيارات والملفات الطبية والفواتير',
    recommendedModules: ['pos', 'booking', 'hr', 'inventory', 'treasury', 'reports'],
    extensions: [
      { key: 'clinic.practitioners', title: 'الأطباء والتخصصات', core: 'hr' },
      { key: 'clinic.encounters', title: 'الزيارات والكشوفات', core: 'booking' },
      { key: 'clinic.records', title: 'الملفات الطبية والصلاحيات الحساسة', core: 'reports' },
      { key: 'clinic.procedures', title: 'الإجراءات الطبية والفوترة', core: 'pos' },
    ],
  },
  retail: {
    key: 'retail',
    title: 'السوبر ماركت والتجزئة',
    description: 'باركود ومبيعات ومخزون وموردون ومرتجعات',
    recommendedModules: ['pos', 'inventory', 'treasury', 'reports', 'hr'],
    extensions: [
      { key: 'retail.barcodes', title: 'الباركود والماسح', core: 'pos' },
      { key: 'retail.stock', title: 'الأصناف وحركة المخزون', core: 'inventory' },
      { key: 'retail.purchasing', title: 'الموردون والمشتريات', core: 'inventory' },
      { key: 'retail.returns', title: 'المرتجعات والاستبدال', core: 'pos' },
    ],
  },
} as const satisfies Record<string, {
  key: string;
  title: string;
  description: string;
  recommendedModules: readonly DrvoModuleKey[];
  extensions: readonly { key: string; title: string; core: DrvoModuleKey }[];
}>;

export type DrvoVerticalKey = keyof typeof DRVO_VERTICALS;

export function isDrvoVerticalKey(value: string): value is DrvoVerticalKey {
  return Object.prototype.hasOwnProperty.call(DRVO_VERTICALS, value);
}

export function getDrvoVerticalBlueprint(key: DrvoVerticalKey) {
  const vertical = DRVO_VERTICALS[key];
  return {
    ...vertical,
    recommendedModules: vertical.recommendedModules.map(moduleKey => ({
      key: moduleKey,
      title: DRVO_MODULES[moduleKey].title,
    })),
  };
}

/**
 * A UI recommendation only. Does NOT activate subscriptions or capabilities.
 */
export function recommendedModulesForVertical(key: DrvoVerticalKey): readonly DrvoModuleKey[] {
  return DRVO_VERTICALS[key].recommendedModules;
}
