import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BOOTSTRAP_TENANT_CODE } from '@/platform/tenant/types';
import type { SessionUser } from '@/lib/session-types';

export interface StaffTenantContext {
  tenantId: string;
  membershipId: string;
  tenantCode: string;
}

let cachedBootstrap: StaffTenantContext | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Resolves bootstrap tenant + staff membership for the current user.
 * Legacy super_admin maps to tenant owner role via existing RBAC — not platform admin.
 */
export async function resolveStaffTenantContext(
  user: Pick<SessionUser, 'UserID'>,
): Promise<StaffTenantContext | null> {
  const bootstrap = await getBootstrapTenantContext();
  if (!bootstrap) return null;

  const membership = await lookupMembership(bootstrap.tenantId, user.UserID);
  if (!membership) return null;

  return {
    tenantId: bootstrap.tenantId,
    membershipId: membership,
    tenantCode: bootstrap.tenantCode,
  };
}

async function getBootstrapTenantContext(): Promise<{
  tenantId: string;
  tenantCode: string;
} | null> {
  const now = Date.now();
  if (cachedBootstrap && now < cacheExpiresAt) {
    return {
      tenantId: cachedBootstrap.tenantId,
      tenantCode: cachedBootstrap.tenantCode,
    };
  }

  try {
    const db = await getPool();
    const result = await db
      .request()
      .input('code', sql.NVarChar(64), BOOTSTRAP_TENANT_CODE)
      .query(`
        SELECT TOP 1 TenantId, Code
        FROM dbo.Tenant WITH (NOLOCK)
        WHERE Code = @code AND Status = N'active';
      `);

    if (!result.recordset.length) return null;

    const row = result.recordset[0] as { TenantId: string; Code: string };
    cachedBootstrap = {
      tenantId: String(row.TenantId),
      membershipId: '',
      tenantCode: String(row.Code),
    };
    cacheExpiresAt = now + CACHE_TTL_MS;
    return { tenantId: cachedBootstrap.tenantId, tenantCode: cachedBootstrap.tenantCode };
  } catch {
    return null;
  }
}

async function lookupMembership(
  tenantId: string,
  legacyUserId: number,
): Promise<string | null> {
  try {
    const db = await getPool();
    const result = await db
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyUserId', sql.Int, legacyUserId)
      .query(`
        SELECT TOP 1 MembershipId
        FROM dbo.TenantMembership WITH (NOLOCK)
        WHERE TenantId = @tenantId AND LegacyUserId = @legacyUserId;
      `);
    if (!result.recordset.length) return null;
    return String((result.recordset[0] as { MembershipId: string }).MembershipId);
  } catch {
    return null;
  }
}

/** Test-only cache reset. */
export function resetStaffTenantContextCache(): void {
  cachedBootstrap = null;
  cacheExpiresAt = 0;
}
