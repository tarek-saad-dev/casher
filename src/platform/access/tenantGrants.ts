import 'server-only';
import type { TenantSqlExecutor, StaffTenantContext } from '@/platform/tenant/tenantContext';
import { getPool, sql } from '@/lib/db';
import { canDrvo, isDrvoPermission, type DrvoPermission, type DrvoPermissionActor } from './permissions';

/**
 * Authoritative DRVO SaaS grants. Requires the separately-reviewed RBAC schema
 * (see docs/drvo/tenant-rbac-schema-proposal.sql).
 *
 * No legacy TblRoles, UserLevel, or role-template fallbacks are permitted.
 * Missing schema, missing assignments, or an inactive membership fail closed.
 */
export async function loadTenantPermissionActor(
  context: StaffTenantContext,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<DrvoPermissionActor> {
  const db = opts.executor ?? await getPool();
  const result = await db.request()
    .input('tenantId', sql.UniqueIdentifier, context.tenantId)
    .input('membershipId', sql.UniqueIdentifier, context.membershipId)
    .input('userId', sql.Int, context.userId)
    .query<{ MembershipId: string; PermissionKey: string | null }>(`
      SELECT m.MembershipId, rp.PermissionKey
      FROM dbo.TenantMembership AS m
      INNER JOIN dbo.Tenant AS t ON t.TenantId = m.TenantId AND t.Status = N'active'
      LEFT JOIN dbo.DrvoTenantRoleAssignment AS a
        ON a.TenantId = m.TenantId AND a.MembershipId = m.MembershipId
      LEFT JOIN dbo.DrvoTenantRole AS r
        ON r.TenantId = a.TenantId AND r.RoleId = a.RoleId AND r.IsActive = 1
      LEFT JOIN dbo.DrvoTenantRolePermission AS rp
        ON rp.TenantId = r.TenantId AND rp.RoleId = r.RoleId
      WHERE m.TenantId = @tenantId
        AND m.MembershipId = @membershipId
        AND m.LegacyUserId = @userId
    `);

  if (!result.recordset.length) {
    return { tenantId: context.tenantId, membershipId: context.membershipId, membershipActive: false, grants: [] };
  }
  const rows = result.recordset as Array<{ MembershipId: string; PermissionKey: string | null }>;
  const grants: DrvoPermission[] = [...new Set(rows
    .map((row) => row.PermissionKey)
    .filter((key): key is DrvoPermission => typeof key === 'string' && isDrvoPermission(key)))];
  return { tenantId: context.tenantId, membershipId: context.membershipId, membershipActive: true, grants };
}

export async function requireTenantPermission(
  context: StaffTenantContext,
  permission: DrvoPermission,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<void> {
  const actor = await loadTenantPermissionActor(context, opts);
  if (!canDrvo(actor, context.tenantId, permission)) {
    throw new DrvoAccessDeniedError();
  }
}

export class DrvoAccessDeniedError extends Error {
  readonly code = 'DRVO_ACCESS_DENIED';
  readonly status = 403;
  constructor() {
    super('غير مصرح لك بتنفيذ هذا الإجراء');
    this.name = 'DrvoAccessDeniedError';
  }
}
