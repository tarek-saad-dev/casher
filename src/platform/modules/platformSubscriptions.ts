import 'server-only';
import { getPool, sql } from '@/lib/db';
import { loadPlatformPrincipal } from './platformAuthorityRepository';

export type PlatformSubscriptionRow = {
  tenantId: string; tenantCode: string; tenantName: string; tenantStatus: string;
  moduleKey: string | null; status: string | null; validUntilUtc: string | null;
};

export async function listPlatformSubscriptions(authenticatedUserId: number): Promise<PlatformSubscriptionRow[]> {
  if (process.env.DRVO_STAGING_MODE !== 'true' ||
      process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
      process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
      process.env.DB_NAME !== 'last132_agent' ||
      process.env.DB_DATABASE !== 'last132_agent' ||
      process.env.DB_USER !== 'drvo_agent') {
    throw new Error('PLATFORM_SUBSCRIPTIONS_STAGING_ONLY');
  }
  const pool = await getPool();
  const identity = await pool.request().query<{ DatabaseName: string }>('SELECT DB_NAME() AS DatabaseName');
  if (identity.recordset[0]?.DatabaseName !== 'last132_agent') throw new Error('STAGING_DATABASE_MISMATCH');
  const principal = await loadPlatformPrincipal(authenticatedUserId, { executor: pool });
  if (!principal.active || !principal.grants.includes('platform.entitlements.read')) {
    throw new Error('PLATFORM_ENTITLEMENT_READ_DENIED');
  }
  const result = await pool.request().query<{
    TenantId: string; Code: string; Name: string; TenantStatus: string;
    ModuleKey: string | null; EntitlementStatus: string | null; ValidUntilUtc: Date | null;
  }>(`
    SELECT t.TenantId, t.Code, t.Name, t.Status AS TenantStatus,
           e.ModuleKey, e.Status AS EntitlementStatus, e.ValidUntilUtc
    FROM dbo.Tenant AS t
    LEFT JOIN dbo.DrvoTenantModuleEntitlement AS e ON e.TenantId = t.TenantId
    ORDER BY t.Code, e.ModuleKey
  `);
  return result.recordset.map((row: { TenantId: string; Code: string; Name: string; TenantStatus: string; ModuleKey: string | null; EntitlementStatus: string | null; ValidUntilUtc: Date | null }) => ({
    tenantId: String(row.TenantId), tenantCode: row.Code, tenantName: row.Name,
    tenantStatus: row.TenantStatus, moduleKey: row.ModuleKey,
    status: row.EntitlementStatus,
    validUntilUtc: row.ValidUntilUtc ? new Date(row.ValidUntilUtc).toISOString() : null,
  }));
}
