import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { getTenantPackState, installedAppCodes, listTenantApps } from '@/platform/apps/tenantApps';
import { loadTenantBrandProfile } from '@/platform/branding/brandRepository';
import { evaluateCommercialAccess } from '@/platform/commercial/commercialAccess';
import { getTenantSubscription } from '@/platform/commercial/planRepository';
import { invalidTenantIdResponse } from '../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * GET /api/admin/platform/tenants/:tenantId — operator tenant detail: tenant, branches,
 * members (no passwords), brand, subscription + limits, pack and installed apps.
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  const pool = await getPool();
  const tenantRes = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TenantId, Code, Name, Status, DefaultTimezone, CreatedAt
      FROM dbo.Tenant WHERE TenantId = @tenantId;
    `);
  const t = tenantRes.recordset[0] as Record<string, unknown> | undefined;
  if (!t) {
    return NextResponse.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, { status: 404 });
  }

  const [branches, members, apps, pack, subscription, access, brand] = await Promise.all([
    pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT l.LocationId, l.LegacyBranchId, l.BranchCode, l.Status AS LocationStatus,
               b.BranchName, b.LifecycleStatus, b.IsActive, b.PublicBookingEnabled
        FROM dbo.Location l
        LEFT JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
        WHERE l.TenantId = @tenantId
        ORDER BY l.BranchCode;
      `),
    pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT u.UserID, u.UserName, u.loginName, u.UserLevel,
               STRING_AGG(r.RoleKey, ',') AS Roles
        FROM dbo.TenantMembership m
        INNER JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId AND ISNULL(u.isDeleted, 0) = 0
        LEFT JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
        LEFT JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND ISNULL(r.IsActive, 1) = 1
        WHERE m.TenantId = @tenantId
        GROUP BY u.UserID, u.UserName, u.loginName, u.UserLevel
        ORDER BY u.UserID;
      `),
    listTenantApps(tenantId, { executor: pool }),
    getTenantPackState(pool, tenantId),
    getTenantSubscription(pool, tenantId),
    evaluateCommercialAccess(tenantId, { executor: pool }),
    loadTenantBrandProfile(tenantId, { executor: pool }),
  ]);

  return NextResponse.json({
    tenant: {
      tenantId: String(t.TenantId).toLowerCase(),
      code: String(t.Code),
      name: String(t.Name),
      status: String(t.Status),
      defaultTimezone: String(t.DefaultTimezone),
      createdAt: t.CreatedAt instanceof Date ? t.CreatedAt.toISOString() : String(t.CreatedAt),
    },
    branches: (branches.recordset as Array<Record<string, unknown>>).map((b) => ({
      locationId: String(b.LocationId),
      legacyBranchId: Number(b.LegacyBranchId),
      branchCode: String(b.BranchCode),
      branchName: b.BranchName != null ? String(b.BranchName) : null,
      locationStatus: String(b.LocationStatus),
      lifecycleStatus: b.LifecycleStatus != null ? String(b.LifecycleStatus) : null,
      isActive: Boolean(b.IsActive),
      publicBookingEnabled: Boolean(b.PublicBookingEnabled),
    })),
    members: (members.recordset as Array<Record<string, unknown>>).map((m) => ({
      userId: Number(m.UserID),
      userName: String(m.UserName),
      loginName: String(m.loginName),
      userLevel: String(m.UserLevel),
      roles: m.Roles ? String(m.Roles).split(',') : [],
    })),
    pack,
    apps,
    installed: installedAppCodes(apps),
    subscription,
    access,
    brand,
  });
}
