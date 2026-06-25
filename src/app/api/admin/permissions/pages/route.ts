import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { getPageAccessSnapshot, updatePageAccess, createPage } from '@/lib/actions/permissionActions';

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
  try {
    const session = await requireSuperAdmin();
    if (!session) return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });

    const { pageKey, accessMode, roles, reason }: {
      pageKey: string;
      accessMode: 'all' | 'roles' | 'super_admin_only';
      roles: string[];
      reason?: string;
    } = await req.json();

    if (!pageKey || !accessMode) {
      return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 });
    }

    const db = await getPool();

    const auditResult = await executeAuditedAction({
      actionType: 'update_page_access',
      user: session,
      entityId: pageKey,
      request: req,
      actionMethod: 'POST',
      endpointPath: '/api/admin/permissions/pages',
      reason: reason || null,
      loadOldData: async (transaction) => getPageAccessSnapshot(transaction, pageKey) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => updatePageAccess(transaction, pageKey, accessMode, roles),
      loadNewData: async (transaction) => getPageAccessSnapshot(transaction, pageKey) as unknown as Record<string, unknown> | null,
    });

    // Keep legacy permission audit log as a secondary trail
    await db.request()
      .input('actor',   session.UserID)
      .input('details', JSON.stringify({ pageKey, accessMode, roles }))
      .query(`
        INSERT INTO dbo.TblPermissionAuditLog (ActorUserID, Action, TargetType, Details)
        VALUES (@actor, 'update_page_access', 'page', @details)
      `);

    return NextResponse.json({ success: true, auditId: auditResult.auditId });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/permissions/pages] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT — create a new page
// Body: { pageKey, pageName, pagePath, section, accessMode, sortOrder, roles }
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    if (!session) return NextResponse.json({ error: 'غير مصرح — super_admin فقط' }, { status: 403 });

    const body = await req.json();
    const { pageKey, pageName, pagePath, section, accessMode, sortOrder, roles } = body;

    if (!pageKey || !pageName || !pagePath || !accessMode) {
      return NextResponse.json({ error: 'pageKey و pageName و pagePath و accessMode مطلوبون' }, { status: 400 });
    }

    const db = await getPool();

    const auditResult = await executeAuditedAction({
      actionType: 'create_page',
      user: session,
      entityId: pageKey,
      request: req,
      actionMethod: 'PUT',
      endpointPath: '/api/admin/permissions/pages',
      reason: body.reason || null,
      loadOldData: async () => null,
      execute: async (transaction) => createPage(transaction, {
        pageKey,
        pageName,
        pagePath,
        section,
        accessMode,
        sortOrder,
        roles,
      }),
      loadNewData: async () => null,
    });

    const data = auditResult.data as { pageID: number; pageKey: string; accessMode: string; roles: string[] } | undefined;

    // Keep legacy permission audit log as a secondary trail
    await db.request()
      .input('actor',   session.UserID)
      .input('details', JSON.stringify({ pageKey, pageName, pagePath, accessMode, roles }))
      .query(`
        INSERT INTO dbo.TblPermissionAuditLog (ActorUserID, Action, TargetType, Details)
        VALUES (@actor, 'create_page', 'page', @details)
      `);

    return NextResponse.json({ success: true, pageID: data?.pageID, auditId: auditResult.auditId });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/permissions/pages] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
