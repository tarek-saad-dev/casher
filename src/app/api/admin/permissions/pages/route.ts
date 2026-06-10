import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export const runtime = 'nodejs';

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session) return null;
  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  if (!access.isSuperAdmin) return null;
  return session;
}

// GET — all pages with their current accessMode and role assignments
export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });

  const db = await getPool();

  const pagesRes = await db.request().query(`
    SELECT
      sp.PageID, sp.PageKey, sp.PageName, sp.PagePath,
      sp.Section, sp.AccessMode, sp.SortOrder, sp.IsActive,
      STRING_AGG(r.RoleKey, ',') AS roles
    FROM dbo.TblSystemPages sp
    LEFT JOIN dbo.TblPageRoleAccess pra ON pra.PageID = sp.PageID
    LEFT JOIN dbo.TblRoles r ON r.RoleID = pra.RoleID AND r.IsActive = 1
    GROUP BY sp.PageID, sp.PageKey, sp.PageName, sp.PagePath,
             sp.Section, sp.AccessMode, sp.SortOrder, sp.IsActive
    ORDER BY sp.SortOrder, sp.PageKey
  `);

  const rolesRes = await db.request().query(`SELECT RoleID, RoleKey, RoleName FROM dbo.TblRoles WHERE IsActive=1 ORDER BY RoleID`);

  const pages = pagesRes.recordset.map((p: any) => ({
    pageID:     p.PageID,
    pageKey:    p.PageKey,
    pageName:   p.PageName,
    pagePath:   p.PagePath,
    section:    p.Section,
    accessMode: p.AccessMode,
    sortOrder:  p.SortOrder,
    isActive:   p.IsActive,
    roles:      p.roles ? p.roles.split(',') : [],
  }));

  return NextResponse.json({ pages, roles: rolesRes.recordset });
}

// POST — update a page's accessMode and/or role assignments
// Body: { pageKey: string, accessMode: string, roles: string[] }
export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });

  const { pageKey, accessMode, roles }: {
    pageKey: string;
    accessMode: 'all' | 'roles' | 'super_admin_only';
    roles: string[];
  } = await req.json();

  if (!pageKey || !accessMode) {
    return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 });
  }

  const db = await getPool();

  // Update accessMode
  await db.request()
    .input('mode', accessMode)
    .input('key',  pageKey)
    .query(`UPDATE dbo.TblSystemPages SET AccessMode = @mode WHERE PageKey = @key`);

  // If roles provided, replace role access entries
  if (Array.isArray(roles)) {
    const pidRes = await db.request()
      .input('key', pageKey)
      .query(`SELECT PageID FROM dbo.TblSystemPages WHERE PageKey = @key`);
    const pageID = pidRes.recordset[0]?.PageID;
    if (pageID) {
      await db.request().input('pid', pageID).query(`DELETE FROM dbo.TblPageRoleAccess WHERE PageID = @pid`);
      for (const roleKey of roles) {
        await db.request()
          .input('pid',     pageID)
          .input('roleKey', roleKey)
          .query(`
            DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
            IF @rid IS NOT NULL
              INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
              VALUES (@pid, @rid, 1, 0, 0)
          `);
      }
    }
  }

  // Audit log
  await db.request()
    .input('actor',   session.UserID)
    .input('details', JSON.stringify({ pageKey, accessMode, roles }))
    .query(`
      INSERT INTO dbo.TblPermissionAuditLog (ActorUserID, Action, TargetType, Details)
      VALUES (@actor, 'update_page_access', 'page', @details)
    `);

  return NextResponse.json({ success: true });
}

// PUT — create a new page
// Body: { pageKey, pageName, pagePath, section, accessMode, sortOrder, roles }
export async function PUT(req: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });

  const body = await req.json();
  const { pageKey, pageName, pagePath, section, accessMode, sortOrder, roles } = body;

  if (!pageKey || !pageName || !pagePath || !accessMode) {
    return NextResponse.json({ error: 'pageKey و pageName و pagePath و accessMode مطلوبون' }, { status: 400 });
  }

  const db = await getPool();

  // Check duplicate key
  const dup = await db.request().input('key', pageKey).query(
    `SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = @key`
  );
  if (dup.recordset.length > 0) {
    return NextResponse.json({ error: 'مفتاح الصفحة موجود بالفعل' }, { status: 409 });
  }

  // Insert page
  const ins = await db.request()
    .input('key',     pageKey)
    .input('name',    pageName)
    .input('path',    pagePath)
    .input('section', section || null)
    .input('access',  accessMode)
    .input('sort',    sortOrder ?? 999)
    .query(`
      INSERT INTO dbo.TblSystemPages (PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
      OUTPUT INSERTED.PageID
      VALUES (@key, @name, @path, @section, @access, @sort)
    `);

  const pageID = ins.recordset[0]?.PageID;

  // Assign roles
  if (pageID && Array.isArray(roles)) {
    for (const roleKey of roles) {
      await db.request()
        .input('pid',     pageID)
        .input('roleKey', roleKey)
        .query(`
          DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
          IF @rid IS NOT NULL
            INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
            VALUES (@pid, @rid, 1, 0, 0)
        `);
    }
  }

  // Audit log
  await db.request()
    .input('actor',   session.UserID)
    .input('details', JSON.stringify({ pageKey, pageName, pagePath, accessMode, roles }))
    .query(`
      INSERT INTO dbo.TblPermissionAuditLog (ActorUserID, Action, TargetType, Details)
      VALUES (@actor, 'create_page', 'page', @details)
    `);

  return NextResponse.json({ success: true, pageID });
}
