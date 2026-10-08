import 'server-only';
import { getPool, sql } from '@/lib/db';
import { requireHrTenantId } from '@/lib/hr/hrTenantScope';
import {
  serviceCatalogForTenantCode,
  type TenantServiceCatalogConfig,
} from '@/lib/services/tenantServiceCatalogConfig';

/** Service catalog config of `tenantId` (by tenant code; unknown tenant → empty config). */
export async function resolveTenantServiceCatalog(
  tenantId: string,
): Promise<TenantServiceCatalogConfig> {
  const tid = requireHrTenantId(tenantId, 'resolveTenantServiceCatalog');
  const db = await getPool();
  const result = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tid)
    .query(`SELECT Code FROM dbo.Tenant WHERE TenantId = @tenantId;`);
  const code = (result.recordset[0] as { Code?: string } | undefined)?.Code ?? null;
  return serviceCatalogForTenantCode(code);
}
