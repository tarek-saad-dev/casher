import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';
import { requireApprovalOrExecute } from '@/lib/approvalWorkflow';

export const runtime = 'nodejs';

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session) return null;
  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) return null;
  return session;
}

// GET — list all users with their roles
export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });

  const db = await getPool();
  const res = await db.request().query(`
    SELECT
      u.UserID, u.UserName, u.loginName, u.UserLevel, u.isDeleted,
      STRING_AGG(r.RoleKey, ',') AS roles
    FROM dbo.TblUser u
    LEFT JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    LEFT JOIN dbo.TblRoles r     ON r.RoleID  = ur.RoleID AND r.IsActive = 1
    GROUP BY u.UserID, u.UserName, u.loginName, u.UserLevel, u.isDeleted
    ORDER BY u.UserID
  `);

  const users = res.recordset.map((u: any) => ({
    userID:    u.UserID,
    userName:  u.UserName,
    loginName: u.loginName,
    userLevel: u.UserLevel,
    isDeleted: u.isDeleted,
    roles:     u.roles ? u.roles.split(',') : [],
  }));

  // Also return all available roles
  const rolesRes = await db.request().query(`SELECT RoleID, RoleKey, RoleName FROM dbo.TblRoles WHERE IsActive=1 ORDER BY RoleID`);

  return NextResponse.json({ users, roles: rolesRes.recordset });
}

// POST — assign or remove roles for a user
// Body: { userID: number, roles: string[] }  — full replacement of roles
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);

  const { userID, roles }: { userID: number; roles: string[] } = await req.json();
  if (!userID || !Array.isArray(roles)) {
    return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 });
  }

  const db = await getPool();

  // Fetch role IDs for oldData snapshot
  const oldRolesRes = await db.request().input('uid', userID)
    .query(`SELECT r.RoleID FROM dbo.TblUserRoles ur JOIN dbo.TblRoles r ON r.RoleID=ur.RoleID WHERE ur.UserID=@uid`);
  const oldRoleIds = oldRolesRes.recordset.map((r: Record<string, number>) => r.RoleID);

  // Fetch new role IDs
  const roleIdsRes = await db.request().query(
    `SELECT RoleID, RoleKey FROM dbo.TblRoles WHERE RoleKey IN (${roles.map((_,i)=>`@r${i}`).join(',')})`);
  // inject params individually
  const reqObj = db.request();
  roles.forEach((rk, i) => reqObj.input(`r${i}`, rk));
  const roleIdsRes2 = await reqObj.query(
    `SELECT RoleID FROM dbo.TblRoles WHERE RoleKey IN (${roles.map((_,i)=>`@r${i}`).join(',')})`);
  const newRoleIds = roleIdsRes2.recordset.map((r: Record<string,number>) => r.RoleID);

  void roleIdsRes; // suppress unused

  // Non-super_admin → route through approval workflow
  if (!access.isSuperAdmin) {
    const workflow = await requireApprovalOrExecute({
      userId:      session.UserID,
      userName:    session.UserName,
      requestType: 'update_user_roles',
      entityId:    String(userID),
      actionMethod:'UPDATE',
      endpointPath:'/api/admin/permissions/users',
      oldDataLoader: async () => ({ roles: oldRoleIds }),
      newData:     { roles: newRoleIds },
      riskLevel:   'critical',
    });
    if (workflow.pendingApproval)
      return NextResponse.json({ success: true, pendingApproval: true, approvalId: workflow.approvalId, message: workflow.message });
  }

  // super_admin executes directly (workflow.execute already ran, but that uses registry;
  // here we also keep the original inline logic so page access token cache refreshes properly)
  await db.request().input('uid', userID).query(`DELETE FROM dbo.TblUserRoles WHERE UserID=@uid`);
  for (const roleKey of roles) {
    await db.request()
      .input('uid',     userID)
      .input('roleKey', roleKey)
      .query(`
        DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey=@roleKey)
        IF @rid IS NOT NULL INSERT INTO dbo.TblUserRoles (UserID,RoleID) VALUES (@uid,@rid)
      `);
  }

  await db.request()
    .input('actor',   session.UserID)
    .input('target',  userID)
    .input('details', JSON.stringify(roles))
    .query(`
      INSERT INTO dbo.TblPermissionAuditLog (ActorUserID,Action,TargetType,TargetID,Details)
      VALUES (@actor,'assign_roles','user',@target,@details)
    `);

  return NextResponse.json({ success: true });
}
