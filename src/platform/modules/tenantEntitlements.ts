import 'server-only';
import type { StaffTenantContext, TenantSqlExecutor } from '@/platform/tenant/tenantContext';
import { getPool, sql } from '@/lib/db';
import {
  canUseDrvoModule, isDrvoModuleKey,
  type DrvoModuleEntitlement, type DrvoModuleKey,
} from './registry';

/**
 * Authoritative module entitlements for one verified staff tenant.
 * Requires the reviewed, separately applied DrvoTenantModuleEntitlement schema.
 * No legacy flags, global subscription fallback, or automatic free modules.
 * A missing schema / database failure propagates (fail closed).
 */
export async function listTenantModuleEntitlements(
  context: StaffTenantContext,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<DrvoModuleEntitlement[]> {
  const db = opts.executor ?? await getPool();
  const result = await db.request()
    .input('tenantId', sql.UniqueIdentifier, context.tenantId)
    .input('membershipId', sql.UniqueIdentifier, context.membershipId)
    .input('userId', sql.Int, context.userId)
    .query<{
      TenantId: string;
      ModuleKey: string;
      Status: string;
      ValidUntilUtc: Date | string | null;
    }>(`
      SELECT e.TenantId, e.ModuleKey, e.Status, e.ValidUntilUtc
      FROM dbo.DrvoTenantModuleEntitlement AS e
      INNER JOIN dbo.Tenant AS t
        ON t.TenantId = e.TenantId AND t.Status = N'active'
      INNER JOIN dbo.TenantMembership AS m
        ON m.TenantId = t.TenantId
       AND m.MembershipId = @membershipId
       AND m.LegacyUserId = @userId
      WHERE e.TenantId = @tenantId
    `);

  return result.recordset
    .filter(row =>
      String(row.TenantId).toLowerCase() === context.tenantId.toLowerCase() &&
      isDrvoModuleKey(row.ModuleKey) &&
      (row.Status === 'enabled' || row.Status === 'disabled' || row.Status === 'suspended'))
    .map(row => ({
      tenantId: String(row.TenantId),
      moduleKey: row.ModuleKey,
      status: row.Status as DrvoModuleEntitlement['status'],
      validUntilUtc: row.ValidUntilUtc instanceof Date
        ? row.ValidUntilUtc.toISOString()
        : row.ValidUntilUtc,
    }));
}

export async function requireTenantModule(
  context: StaffTenantContext,
  moduleKey: DrvoModuleKey,
  opts: { executor?: TenantSqlExecutor; now?: Date } = {},
): Promise<void> {
  const entitlements = await listTenantModuleEntitlements(context, opts);
  const entitlement = entitlements.find(item => item.moduleKey === moduleKey);
  if (!canUseDrvoModule(context.tenantId, moduleKey, entitlement, opts.now)) {
    throw new DrvoModuleUnavailableError();
  }
}

export class DrvoModuleUnavailableError extends Error {
  readonly code = 'DRVO_MODULE_UNAVAILABLE';
  readonly status = 403;
  constructor() {
    super('الوحدة غير متاحة لهذه الشركة');
    this.name = 'DrvoModuleUnavailableError';
  }
}
