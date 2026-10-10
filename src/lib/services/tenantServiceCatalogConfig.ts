/**
 * Per-tenant service catalog IDs (TblPro.ProID) that code relies on. ProIDs are catalog rows of
 * one tenant, so they are never shared: CASHER_BOOT (CUT) keeps its audited IDs, every other
 * tenant has none and falls back to name matching / no quick-queue service.
 *
 * Client-safe (no DB access); resolve the config for a request with
 * `resolveTenantServiceCatalog` in `tenantServiceCatalog.server.ts`.
 */
export interface TenantServiceCatalogConfig {
  /** Barber service ProIDs by category (classifyService). */
  barberProIds: {
    hair: readonly number[];
    hairBeard: readonly number[];
    beard: readonly number[];
  };
  /** ProID used by the one-click quick queue; null = tenant has no quick-queue service. */
  quickQueueServiceId: number | null;
}

/** CUT catalog (TblPro audit: SimpleCreateQueueDrawer + barber seed). */
export const CASHER_BOOT_SERVICE_CATALOG: TenantServiceCatalogConfig = Object.freeze({
  barberProIds: Object.freeze({
    hair: Object.freeze([1, 4, 5]), // Hair Cut, Fade Cut, Advanced Cut
    hairBeard: Object.freeze([3]), // Haircut & Beard
    beard: Object.freeze([2]), // Beard Styling & Fade
  }),
  quickQueueServiceId: 9,
});

export const EMPTY_SERVICE_CATALOG: TenantServiceCatalogConfig = Object.freeze({
  barberProIds: Object.freeze({
    hair: Object.freeze([]),
    hairBeard: Object.freeze([]),
    beard: Object.freeze([]),
  }),
  quickQueueServiceId: null,
});

/** Tenants with configured catalogs, keyed by Tenant.Code. */
const SERVICE_CATALOG_BY_TENANT_CODE: Readonly<Record<string, TenantServiceCatalogConfig>> = {
  CASHER_BOOT: CASHER_BOOT_SERVICE_CATALOG,
};

export function serviceCatalogForTenantCode(
  tenantCode: string | null | undefined,
): TenantServiceCatalogConfig {
  return SERVICE_CATALOG_BY_TENANT_CODE[String(tenantCode ?? '').trim().toUpperCase()] ?? EMPTY_SERVICE_CATALOG;
}
