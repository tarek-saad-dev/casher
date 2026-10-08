/**
 * DRVO-015 — legacy master-data tables that carry an authoritative TenantId (migration 10).
 * TblEmp is listed for the column/backfill only; HR behavior is owned elsewhere.
 */
export const MASTER_DATA_TENANT_TABLES = [
  'TblClient',
  'TblPro',
  'TblCat',
  'TblServicePackage',
  'TblServicePackageItem',
  'TblPaymentMethods',
  'TblExpINCat',
  'TblEmp',
] as const;

export type MasterDataTenantTable = (typeof MASTER_DATA_TENANT_TABLES)[number];
