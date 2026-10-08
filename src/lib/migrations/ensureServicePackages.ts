import type { ConnectionPool } from 'mssql';

let tablesReady: boolean | null = null;

/**
 * Package tables (with TenantId) are created by DRVO migration 10 (master-data-tenancy).
 * Runtime never creates them: an untenanted package table would be shared by every tenant.
 * Returns whether the tenant-owned tables are usable.
 */
export async function ensureServicePackagesTables(db: ConnectionPool): Promise<boolean> {
  if (tablesReady === true) return true;

  try {
    const result = await db.request().query(`
      SELECT
        CASE WHEN COL_LENGTH(N'dbo.TblServicePackage', N'TenantId') IS NOT NULL THEN 1 ELSE 0 END AS hasPackage,
        CASE WHEN COL_LENGTH(N'dbo.TblServicePackageItem', N'TenantId') IS NOT NULL THEN 1 ELSE 0 END AS hasItem
    `);
    const row = result.recordset[0];
    const ready = Number(row?.hasPackage) === 1 && Number(row?.hasItem) === 1;
    if (!ready) {
      console.warn('[ensureServicePackagesTables] tenant-owned package tables missing (DRVO migration 10 not applied)');
    }
    tablesReady = ready ? true : null;
    return ready;
  } catch (err) {
    console.warn('[ensureServicePackagesTables] existence check failed:', err);
    return false;
  }
}

export type PackageKind = 'regular' | 'groom';

export function isPackageKind(value: unknown): value is PackageKind {
  return value === 'regular' || value === 'groom';
}
