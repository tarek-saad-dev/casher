import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { DRVO_ROLE_TEMPLATES } from '@/platform/access/permissions';

/**
 * Grants the tenant's own owner role, never a platform operator grant.
 * Called in the same transaction as tenant onboarding: any failure rolls back
 * the tenant, user, branch, and subscription rather than leaving a locked-out owner.
 */
export async function seedTenantOwnerRoleInTransaction(
  tx: Transaction,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  const owner = DRVO_ROLE_TEMPLATES.owner;
  const created = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('roleKey', sql.NVarChar(64), 'owner')
    .input('displayName', sql.NVarChar(120), owner.label)
    .query<{ RoleId: string }>(`
      INSERT INTO dbo.DrvoTenantRole (TenantId, RoleKey, DisplayName, IsActive)
      OUTPUT INSERTED.RoleId
      VALUES (@tenantId, @roleKey, @displayName, 1)
    `);
  const roleId = created.recordset[0]?.RoleId;
  if (!roleId) throw new Error('DRVO_OWNER_ROLE_NOT_CREATED');

  for (const permission of owner.permissions) {
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('roleId', sql.UniqueIdentifier, roleId)
      .input('permission', sql.NVarChar(100), permission)
      .query(`
        INSERT INTO dbo.DrvoTenantRolePermission (TenantId, RoleId, PermissionKey)
        VALUES (@tenantId, @roleId, @permission)
      `);
  }
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('roleId', sql.UniqueIdentifier, roleId)
    .input('membershipId', sql.UniqueIdentifier, membershipId)
    .query(`
      INSERT INTO dbo.DrvoTenantRoleAssignment (TenantId, MembershipId, RoleId)
      VALUES (@tenantId, @membershipId, @roleId)
    `);
}
