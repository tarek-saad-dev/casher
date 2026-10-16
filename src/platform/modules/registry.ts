/**
 * DRVO ERP module catalog.
 * This is a static definition of available modules, NOT a tenant subscription
 * or entitlement. Never use presence in this registry to authorize access.
 */
export const DRVO_MODULES = {
  pos: { key: 'pos', title: 'المبيعات ونقاط البيع', description: 'الفواتير والتحصيل وإدارة نقاط البيع', category: 'operations' },
  booking: { key: 'booking', title: 'الحجوزات والمواعيد', description: 'إدارة المواعيد والتقويم والحجوزات', category: 'operations' },
  hr: { key: 'hr', title: 'الفريق والموارد البشرية', description: 'الحضور والرواتب وإدارة الفريق', category: 'operations' },
  inventory: { key: 'inventory', title: 'المخزون', description: 'المنتجات وحركات المخزون', category: 'operations' },
  treasury: { key: 'treasury', title: 'الخزينة', description: 'حركة النقدية والمصروفات', category: 'finance' },
  reports: { key: 'reports', title: 'التقارير والتحليلات', description: 'تقارير الأداء والتشغيل', category: 'insights' },
  onlineBooking: { key: 'online_booking', title: 'الحجز الإلكتروني', description: 'واجهة حجز للعملاء', category: 'channels' },
} as const;

export type DrvoModuleKey = keyof typeof DRVO_MODULES;
export type DrvoModuleStatus = 'enabled' | 'disabled' | 'suspended';

export interface DrvoModuleEntitlement {
  tenantId: string;
  moduleKey: string;
  status: DrvoModuleStatus;
  /** Optional date for a paid entitlement; expired entitlements must not grant access. */
  validUntilUtc?: string | null;
}

export function isDrvoModuleKey(key: string): key is DrvoModuleKey {
  return Object.prototype.hasOwnProperty.call(DRVO_MODULES, key);
}

/**
 * Fail-closed module gate: valid module + same tenant + enabled entitlement.
 * Caller must load entitlement from authoritative tenant-scoped storage.
 * No default modules and no legacy feature-flag fallback.
 */
export function canUseDrvoModule(
  tenantId: string,
  moduleKey: string,
  entitlement: DrvoModuleEntitlement | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!isDrvoModuleKey(moduleKey) || !entitlement || entitlement.moduleKey !== moduleKey) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return false;
  if (tenantId.toLowerCase() !== entitlement.tenantId.toLowerCase()) return false;
  if (entitlement.status !== 'enabled') return false;
  if (entitlement.validUntilUtc != null) {
    const expiry = Date.parse(entitlement.validUntilUtc);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) return false;
  }
  return true;
}
