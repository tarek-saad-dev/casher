import { getPool, sql } from '@/lib/db';
import { TenantContextError, type TenantSqlExecutor } from '@/platform/tenant/tenantContext';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every master-data read/write is bound to the authoritative tenant. A missing or malformed
 * tenant fails closed; there is no default tenant.
 */
export function requireMasterDataTenantId(tenantId: string | null | undefined, where: string): string {
  const id = String(tenantId ?? '').trim();
  if (!GUID.test(id)) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `${where}: no authoritative tenant for master data`);
  }
  return id.toLowerCase();
}

/**
 * Tenant that owns a legacy branch (exactly one active Location of an active Tenant).
 * For services that only receive a branch id; unmapped or ambiguous branches fail closed.
 */
export async function resolveLegacyBranchTenantId(
  legacyBranchId: number,
  executor?: TenantSqlExecutor,
): Promise<string> {
  if (!Number.isInteger(legacyBranchId) || legacyBranchId <= 0) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `Invalid branch ${legacyBranchId}`);
  }
  const ex = executor ?? (await getPool());
  const result = await ex
    .request()
    .input('branchId', sql.Int, legacyBranchId)
    .query(`
      SELECT DISTINCT l.TenantId
      FROM dbo.Location l
      INNER JOIN dbo.Tenant t ON t.TenantId = l.TenantId
      WHERE l.LegacyBranchId = @branchId AND l.Status = N'active' AND t.Status = N'active';
    `);
  const rows = result.recordset as Array<{ TenantId: string }>;
  if (rows.length !== 1) {
    throw new TenantContextError(
      rows.length ? 'TENANT_AMBIGUOUS' : 'TENANT_CONTEXT_UNRESOLVED',
      `Branch ${legacyBranchId} maps to ${rows.length} tenants`,
    );
  }
  return String(rows[0].TenantId).toLowerCase();
}

/** Tenant of a resolved branch context (DRVO-013 stamp when present, else derived from the branch). */
export async function tenantIdForBranchContext(
  branch: { branchId: number; tenantId?: string | null },
  executor?: TenantSqlExecutor,
): Promise<string> {
  if (branch.tenantId) return requireMasterDataTenantId(branch.tenantId, 'branch context');
  return resolveLegacyBranchTenantId(branch.branchId, executor);
}
