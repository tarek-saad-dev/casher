import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export const runtime = 'nodejs';

// Super-admin only debug endpoint — never expose publicly
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'super_admin فقط' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const targetUserId = searchParams.get('userId');
  const requestedPath = searchParams.get('path') || '';

  if (!targetUserId || !requestedPath) {
    return NextResponse.json({ error: 'userId و path مطلوبان' }, { status: 400 });
  }

  const db = await getPool();

  // Load target user
  const userRes = await db.request()
    .input('uid', parseInt(targetUserId, 10))
    .query(`SELECT UserID, UserName, loginName, UserLevel FROM dbo.TblUser WHERE UserID = @uid`);

  if (!userRes.recordset.length) {
    return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
  }

  const u = userRes.recordset[0];

  // Load roles from TblUserRoles
  const rolesRes = await db.request()
    .input('uid', u.UserID)
    .query(`
      SELECT r.RoleID, r.RoleKey, r.RoleName FROM dbo.TblUserRoles ur
      JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
      WHERE ur.UserID = @uid AND r.IsActive = 1
    `);
  const roles = rolesRes.recordset;
  const roleKeys: string[] = roles.map((r: any) => r.RoleKey);
  const isSuperAdmin = roleKeys.includes('super_admin');

  // Normalize path
  const cleanPath = requestedPath.split('?')[0].replace(/\/$/, '') || '/';

  // Find matching page in TblSystemPages (exact match)
  const pageRes = await db.request()
    .input('path', cleanPath)
    .query(`
      SELECT sp.PageID, sp.PageKey, sp.PageName, sp.AccessMode,
        STRING_AGG(r.RoleKey, ',') AS allowedRoles
      FROM dbo.TblSystemPages sp
      LEFT JOIN dbo.TblPageRoleAccess pra ON pra.PageID = sp.PageID
      LEFT JOIN dbo.TblRoles r ON r.RoleID = pra.RoleID AND r.IsActive = 1
      WHERE sp.PagePath = @path AND sp.IsActive = 1
      GROUP BY sp.PageID, sp.PageKey, sp.PageName, sp.AccessMode
    `);

  const matchedPage = pageRes.recordset[0] || null;
  const allowedRoles: string[] = matchedPage?.allowedRoles
    ? matchedPage.allowedRoles.split(',')
    : [];

  // Determine decision
  let finalDecision: 'allowed' | 'denied' = 'denied';
  let reason = '';

  if (isSuperAdmin) {
    finalDecision = 'allowed';
    reason = 'allowed because super_admin';
  } else if (!matchedPage) {
    finalDecision = 'denied';
    reason = 'denied because page is unknown — not in TblSystemPages';
  } else if (matchedPage.AccessMode === 'super_admin_only') {
    finalDecision = 'denied';
    reason = 'denied because accessMode=super_admin_only and user is not super_admin';
  } else if (matchedPage.AccessMode === 'all') {
    finalDecision = 'allowed';
    reason = 'allowed because accessMode=all';
  } else if (matchedPage.AccessMode === 'roles') {
    const hasRole = roleKeys.some((rk: string) => allowedRoles.includes(rk));
    if (hasRole) {
      const matchingRole = roleKeys.find((rk: string) => allowedRoles.includes(rk));
      finalDecision = 'allowed';
      reason = `allowed because role "${matchingRole}" has page access`;
    } else {
      finalDecision = 'denied';
      reason = `denied because no matching role (user roles: [${roleKeys.join(', ')}], page allowed roles: [${allowedRoles.join(', ')}])`;
    }
  }

  // Also check what the actual allowedPagePaths returns for this user
  const userAccessProfile = await getUserAccess(u.UserID, u.UserName, u.UserLevel);
  const inAllowedList = userAccessProfile.allowedPagePaths.includes(cleanPath);

  return NextResponse.json({
    user: {
      id: u.UserID,
      name: u.UserName,
      loginName: u.loginName,
      userLevel: u.UserLevel,
    },
    roles: roleKeys,
    isSuperAdmin,
    requestedPath: cleanPath,
    matchedPage: matchedPage ? {
      pageKey:    matchedPage.PageKey,
      pageName:   matchedPage.PageName,
      accessMode: matchedPage.AccessMode,
    } : null,
    allowedRoles,
    finalDecision,
    reason,
    inAllowedPagesList: inAllowedList,
    note: inAllowedList !== (finalDecision === 'allowed')
      ? '⚠️ mismatch between logic and allowedPagesList'
      : '✓ consistent',
  });
}
