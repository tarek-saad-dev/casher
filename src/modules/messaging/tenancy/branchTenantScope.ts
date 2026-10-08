import { getPool, sql } from '@/lib/db';
import { TenantContextError } from '@/platform/tenant/tenantContext';
import { currentMessagingTenantScope, runWithMessagingTenant } from './messagingTenantScope';

const branchTenantMemo = new Map<number, { tenantId: string | null; expiresAt: number }>();
const BRANCH_TTL_MS = 60_000;

async function loadTenantIdForLegacyBranch(branchId: number): Promise<string | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 2 l.TenantId
      FROM dbo.Location l
      INNER JOIN dbo.Tenant t ON t.TenantId = l.TenantId
      WHERE l.LegacyBranchId = @branchId AND l.Status = N'active' AND t.Status = N'active';
    `);
  const rows = result.recordset as Array<{ TenantId: string }>;
  return rows.length === 1 ? String(rows[0].TenantId).toLowerCase() : null;
}

let branchTenantLoader: (branchId: number) => Promise<string | null> = loadTenantIdForLegacyBranch;

/** Test seam (pass null to restore SQL). */
export function setBranchTenantResolverForTests(
  next: ((branchId: number) => Promise<string | null>) | null,
): void {
  branchTenantLoader = next ?? loadTenantIdForLegacyBranch;
  branchTenantMemo.clear();
}

/**
 * Tenant owning a legacy branch: exactly one active Location of an active tenant. Unknown or
 * ambiguous branches resolve to null (callers fail closed).
 */
export async function resolveTenantIdForLegacyBranch(branchId: number): Promise<string | null> {
  if (!Number.isInteger(branchId) || branchId <= 0) return null;
  const now = Date.now();
  const hit = branchTenantMemo.get(branchId);
  if (hit && hit.expiresAt > now) return hit.tenantId;
  const tenantId = await branchTenantLoader(branchId);
  branchTenantMemo.set(branchId, { tenantId, expiresAt: now + BRANCH_TTL_MS });
  return tenantId;
}

/**
 * The single tenant owning every given branch (cross-branch jobs such as the nightly HR digest).
 * Empty input, an unmapped branch, or branches of different tenants → null (fail closed).
 */
export async function resolveSingleTenantForLegacyBranches(
  branchIds: readonly number[],
): Promise<string | null> {
  if (branchIds.length === 0) return null;
  const tenants = new Set<string | null>();
  for (const id of branchIds) tenants.add(await resolveTenantIdForLegacyBranch(id));
  if (tenants.size !== 1) return null;
  const [only] = [...tenants];
  return only ?? null;
}

export function resetBranchTenantMemo(): void {
  branchTenantMemo.clear();
}

/**
 * Runs `fn` in the messaging tenant for a feature event that belongs to `branchId`.
 * - Inside an existing scope: the branch (when given) must belong to that tenant.
 * - Outside a scope: the tenant is derived from the branch's Location.
 * - No scope and no resolvable branch: throws TENANT_CONTEXT_UNRESOLVED (never a default tenant).
 */
export async function runWithMessagingTenantForBranch<T>(
  branchId: number | null | undefined,
  detail: string,
  fn: () => Promise<T>,
): Promise<T> {
  const scope = currentMessagingTenantScope();
  const hasBranch = typeof branchId === 'number' && Number.isInteger(branchId) && branchId > 0;
  if (scope) {
    if (hasBranch && (await resolveTenantIdForLegacyBranch(branchId)) !== scope.tenantId.toLowerCase()) {
      throw new TenantContextError(
        'TENANT_CONTEXT_UNRESOLVED',
        `${detail}: branch ${branchId} does not belong to the current tenant`,
      );
    }
    return fn();
  }
  if (!hasBranch) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `${detail}: no tenant scope and no branch`);
  }
  const tenantId = await resolveTenantIdForLegacyBranch(branchId);
  if (!tenantId) {
    throw new TenantContextError(
      'TENANT_CONTEXT_UNRESOLVED',
      `${detail}: branch ${branchId} is not an active location of exactly one tenant`,
    );
  }
  return runWithMessagingTenant({ tenantId, source: 'branch', detail: `${detail}:branch:${branchId}` }, fn);
}
