/**
 * @deprecated Use scripts/drvo/platformBootstrap.ts via central DRVO migration runner.
 * Re-exports preserved for transitional imports.
 */
export { PRODUCTION_DB } from './drvo/types';
export {
  BOOTSTRAP_TENANT_CODE,
  BOOTSTRAP_TENANT_NAME,
  allPlatformCoreTablesExist,
  ensurePlatformBootstrapData as ensureDrvo003BootstrapData,
  tableExists,
  verifyPlatformBootstrap,
} from './drvo/platformBootstrap';

export type PlatformBootstrapVerifyReport = import('./drvo/platformBootstrap').PlatformBootstrapVerifyReport;

/** @deprecated Use verifyPlatformBootstrap */
export async function verifyDrvo003Prerequisites(
  pool: import('mssql').ConnectionPool,
): Promise<PlatformBootstrapVerifyReport & { database: string }> {
  const { verifyPlatformBootstrap } = await import('./drvo/platformBootstrap');
  const report = await verifyPlatformBootstrap(pool);
  const dbResult = await pool.request().query(`SELECT DB_NAME() AS db;`);
  return {
    ...report,
    database: String(dbResult.recordset[0]?.db ?? ''),
    schema: {
      Tenant: report.ok || report.failures.every((f) => !f.includes('Tenant')),
      Location: true,
      TenantMembership: true,
      LegacyIdMap: true,
      PlatformOutbox: true,
      AppRegistry: true,
      TenantAppEntitlement: true,
      SalonPackConfig: true,
    },
    tenant: {
      count: report.tenantCount,
      bootstrapPresent: report.ok,
      tenantId: report.tenantId,
      code: report.ok ? 'CASHER_BOOT' : null,
      status: report.ok ? 'active' : null,
    },
    locations: {
      branchCount: report.branchCount,
      locationCount: report.locationCount,
      missingBranchIds: [],
      mappedBranchCodes: report.branchCodes,
    },
    memberships: {
      activeUserCount: 0,
      membershipCount: 0,
      missingUserIds: [],
    },
  };
}

export async function assertProductionDatabase(
  pool: import('mssql').ConnectionPool,
  opts: { allowProduction: boolean },
): Promise<string> {
  const { assertDatabaseAllowed } = await import('./drvo/runner');
  return assertDatabaseAllowed(pool, { allowProduction: opts.allowProduction });
}

export async function applyDrvo003Schema(pool: import('mssql').ConnectionPool): Promise<void> {
  const { platformCoreMigration } = await import('./drvo/migrations/001-platform-core');
  await platformCoreMigration.apply({ pool, database: '', appCommitSha: null });
}
