import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requireTenantSession } from '@/lib/api-auth';
import { getUserAccess } from '@/lib/permissions-server';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { getUserRolesSnapshot, updateUserRoles } from '@/lib/actions/permissionActions';
import { assertLegacyUserInTenant, isTenantContextError } from '@/platform/tenant/tenantContext';

export const runtime = 'nodejs';

async function requireSuperAdmin() {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return null;
  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) return null;
  return session;
}

// GET — list the session tenant's users with their roles
export async function GET() {
  try {
    const session = await requireSuperAdmin();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });
    }

    const db = await getPool();
    const res = await db.request()
      .input('tenantId', sql.UniqueIdentifier, session.TenantId)
      .query(`
      SELECT
        u.UserID, u.UserName, u.loginName, u.UserLevel, u.isDeleted,
        STRING_AGG(r.RoleKey, ',') AS roles
      FROM dbo.TblUser u
      INNER JOIN dbo.TenantMembership m ON m.LegacyUserId = u.UserID AND m.TenantId = @tenantId
      LEFT JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
      LEFT JOIN dbo.TblRoles r     ON r.RoleID  = ur.RoleID AND r.IsActive = 1
      GROUP BY u.UserID, u.UserName, u.loginName, u.UserLevel, u.isDeleted
      ORDER BY u.UserID
    `);

    const users = res.recordset.map((u: Record<string, unknown>) => ({
      userID:    u.UserID,
      userName:  u.UserName,
      loginName: u.loginName,
      userLevel: u.UserLevel,
      isDeleted: u.isDeleted,
      roles:     u.roles ? String(u.roles).split(',') : [],
    }));

    const rolesRes = await db
      .request()
      .query(`SELECT RoleID, RoleKey, RoleName FROM dbo.TblRoles WHERE IsActive=1 ORDER BY RoleID`);

    return NextResponse.json({ users, roles: rolesRes.recordset });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/permissions/users] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — assign or remove roles for a user of the session tenant
// Body: { userID: number, roles: string[] }  — full replacement of roles
export async function POST(req: NextRequest) {
  try {
    const session = await requireTenantSession();
    if (session instanceof NextResponse) return session;

    const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);

    const { userID, roles, reason }: { userID: number; roles: string[]; reason?: string } = await req.json();
    if (!userID || !Array.isArray(roles)) {
      return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 });
    }

    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });
    }

    try {
      await assertLegacyUserInTenant(session.TenantId, Number(userID));
    } catch (err) {
      if (isTenantContextError(err)) {
        return NextResponse.json({ error: err.publicMessage, code: err.publicCode }, { status: err.status });
      }
      throw err;
    }

    const db = await getPool();

    const auditResult = await executeAuditedAction({
      actionType: 'update_user_roles',
      user: session,
      entityId: userID,
      request: req,
      actionMethod: 'UPDATE',
      endpointPath: '/api/admin/permissions/users',
      reason: reason || null,
      loadOldData: async (transaction) => getUserRolesSnapshot(transaction, userID) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => updateUserRoles(transaction, userID, roles),
      loadNewData: async (transaction) => getUserRolesSnapshot(transaction, userID) as unknown as Record<string, unknown> | null,
    });

    // Keep legacy permission audit log as a secondary trail
    await db.request()
      .input('actor',   session.UserID)
      .input('target',  userID)
      .input('details', JSON.stringify(roles))
      .query(`
        INSERT INTO dbo.TblPermissionAuditLog (ActorUserID, Action, TargetType, TargetID, Details)
        VALUES (@actor, 'assign_roles', 'user', @target, @details)
      `);

    return NextResponse.json({ success: true, auditId: auditResult.auditId });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/permissions/users] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
