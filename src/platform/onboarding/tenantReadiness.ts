import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { findMissingDependencies } from '@/platform/apps/appCatalog';
import {
  getTenantPackState,
  installedAppCodes,
  listTenantApps,
  type PackResolver,
} from '@/platform/apps/tenantApps';
import { getPlan, getTenantSubscription } from '@/platform/commercial/planRepository';
import type { ReadinessCheck, TenantReadinessReport } from './types';

/** Lifecycle stages in which staff may log in and operate (IsActive=1). */
const USABLE_LIFECYCLES = new Set(['INTERNAL_LIVE', 'PUBLIC_LIVE']);

async function loadTenant(
  pool: ConnectionPool,
  tenantId: string,
): Promise<{ tenantId: string; code: string; status: string } | null> {
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TenantId, Code, Status
      FROM dbo.Tenant WITH (NOLOCK)
      WHERE TenantId = @tenantId;
    `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0] as { TenantId: string; Code: string; Status: string };
  return {
    tenantId: String(row.TenantId),
    code: String(row.Code),
    status: String(row.Status),
  };
}

export async function evaluateTenantReadiness(
  tenantId: string,
  pool?: ConnectionPool,
  opts: { resolvePack?: PackResolver } = {},
): Promise<TenantReadinessReport> {
  const db = pool ?? (await getPool());
  const checks: ReadinessCheck[] = [];
  const tenant = await loadTenant(db, tenantId);

  if (!tenant) {
    return {
      tenantId,
      tenantCode: '',
      overall: 'FAIL',
      checks: [{ id: 'tenant_exists', pass: false, detail: 'Tenant row not found' }],
    };
  }

  const validStatus = tenant.status === 'active' || tenant.status === 'suspended';
  checks.push({
    id: 'tenant_status_valid',
    pass: validStatus,
    detail: validStatus
      ? `Tenant status is ${tenant.status}`
      : `Invalid tenant status: ${tenant.status}`,
  });

  const locations = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT LocationId, LegacyBranchId, BranchCode, Status
      FROM dbo.Location WITH (NOLOCK)
      WHERE TenantId = @tenantId;
    `);

  checks.push({
    id: 'has_location',
    pass: locations.recordset.length >= 1,
    detail:
      locations.recordset.length >= 1
        ? `${locations.recordset.length} location(s)`
        : 'No Location rows for tenant',
  });

  const usableBranchIds: number[] = [];
  for (const loc of locations.recordset as Array<{
    LocationId: string;
    LegacyBranchId: number;
    BranchCode: string;
    Status: string;
  }>) {
    const branchId = Number(loc.LegacyBranchId);
    const branch = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT BranchID, BranchCode, LifecycleStatus, PublicBookingEnabled, IsActive
        FROM dbo.TblBranch WITH (NOLOCK)
        WHERE BranchID = @branchId;
      `);

    const branchExists = branch.recordset.length === 1;
    checks.push({
      id: `location_branch_exists_${branchId}`,
      pass: branchExists,
      detail: branchExists
        ? `Legacy branch ${branchId} exists`
        : `Missing legacy branch for Location ${loc.LocationId}`,
    });

    if (branchExists) {
      const row = branch.recordset[0] as {
        BranchCode: string;
        LifecycleStatus: string;
        PublicBookingEnabled: boolean | number;
        IsActive: boolean | number;
      };
      const codeMatch = String(row.BranchCode) === String(loc.BranchCode);
      checks.push({
        id: `location_branch_code_${branchId}`,
        pass: codeMatch,
        detail: codeMatch
          ? `BranchCode matches for ${branchId}`
          : `BranchCode mismatch location=${loc.BranchCode} branch=${row.BranchCode}`,
      });

      if (
        String(loc.Status) === 'active' &&
        Boolean(row.IsActive) &&
        USABLE_LIFECYCLES.has(String(row.LifecycleStatus))
      ) {
        usableBranchIds.push(branchId);
      }

      const mapRows = await db
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('legacyKey', sql.NVarChar(128), String(branchId))
        .query(`
          SELECT DrvoId FROM dbo.LegacyIdMap WITH (NOLOCK)
          WHERE TenantId = @tenantId AND EntityName = N'branch' AND LegacyKey = @legacyKey;
        `);
      const mapOk =
        mapRows.recordset.length === 1 &&
        String((mapRows.recordset[0] as { DrvoId: string }).DrvoId).toLowerCase() ===
          String(loc.LocationId).toLowerCase();
      checks.push({
        id: `legacy_map_branch_${branchId}`,
        pass: mapOk,
        detail: mapOk
          ? `LegacyIdMap branch OK for ${branchId}`
          : `LegacyIdMap branch missing or mismatched for ${branchId}`,
      });
    }
  }

  checks.push({
    id: 'has_usable_branch',
    pass: usableBranchIds.length >= 1,
    detail: usableBranchIds.length
      ? `Usable branch(es): ${usableBranchIds.join(', ')}`
      : 'No active branch in INTERNAL_LIVE / PUBLIC_LIVE — staff cannot log in',
  });

  const memberships = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT MembershipId, LegacyUserId
      FROM dbo.TenantMembership WITH (NOLOCK)
      WHERE TenantId = @tenantId;
    `);

  checks.push({
    id: 'owner_membership_exists',
    pass: memberships.recordset.length >= 1,
    detail:
      memberships.recordset.length >= 1
        ? `${memberships.recordset.length} membership(s)`
        : 'No TenantMembership rows',
  });

  for (const mem of memberships.recordset as Array<{
    MembershipId: string;
    LegacyUserId: number;
  }>) {
    const userId = Number(mem.LegacyUserId);
    const user = await db
      .request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT UserID FROM dbo.TblUser WITH (NOLOCK)
        WHERE UserID = @userId AND ISNULL(isDeleted, 0) = 0;
      `);
    checks.push({
      id: `membership_user_exists_${userId}`,
      pass: user.recordset.length === 1,
      detail:
        user.recordset.length === 1
          ? `Owner user ${userId} exists`
          : `Missing owner user for membership ${mem.MembershipId}`,
    });

    const mapRows = await db
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyKey', sql.NVarChar(128), String(userId))
      .query(`
        SELECT DrvoId FROM dbo.LegacyIdMap WITH (NOLOCK)
        WHERE TenantId = @tenantId AND EntityName = N'staff_user' AND LegacyKey = @legacyKey;
      `);
    const mapOk =
      mapRows.recordset.length === 1 &&
      String((mapRows.recordset[0] as { DrvoId: string }).DrvoId).toLowerCase() ===
        String(mem.MembershipId).toLowerCase();
    checks.push({
      id: `legacy_map_staff_${userId}`,
      pass: mapOk,
      detail: mapOk
        ? `LegacyIdMap staff_user OK for ${userId}`
        : `LegacyIdMap staff_user missing or mismatched for ${userId}`,
    });
  }

  const owners = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT DISTINCT m.LegacyUserId, uba.BranchID
      FROM dbo.TenantMembership m WITH (NOLOCK)
      INNER JOIN dbo.TblUser u WITH (NOLOCK)
        ON u.UserID = m.LegacyUserId AND ISNULL(u.isDeleted, 0) = 0
      INNER JOIN dbo.TblUserRoles ur WITH (NOLOCK) ON ur.UserID = m.LegacyUserId
      INNER JOIN dbo.TblRoles r WITH (NOLOCK)
        ON r.RoleID = ur.RoleID AND ISNULL(r.IsActive, 1) = 1 AND r.RoleKey IN (N'admin', N'super_admin')
      LEFT JOIN dbo.TblUserBranchAccess uba WITH (NOLOCK)
        ON uba.UserID = m.LegacyUserId AND uba.IsActive = 1
       AND uba.ValidFrom <= SYSUTCDATETIME()
       AND (uba.ValidTo IS NULL OR uba.ValidTo > SYSUTCDATETIME())
      WHERE m.TenantId = @tenantId;
    `);
  const ownerRows = owners.recordset as Array<{ LegacyUserId: number; BranchID: number | null }>;
  checks.push({
    id: 'owner_admin_role',
    pass: ownerRows.length > 0,
    detail: ownerRows.length
      ? `Admin member(s): ${[...new Set(ownerRows.map((r) => r.LegacyUserId))].join(', ')}`
      : 'No tenant member holds the admin role — the owner would see no pages',
  });
  const loginReady = ownerRows.some(
    (r) => r.BranchID != null && usableBranchIds.includes(Number(r.BranchID)),
  );
  checks.push({
    id: 'owner_can_login',
    pass: loginReady,
    detail: loginReady
      ? 'An admin member has valid access to a usable branch'
      : 'No admin member has valid branch access to a usable branch (login would fail NO_BRANCH_ACCESS)',
  });

  const brand = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.TenantBrandProfile', N'U') IS NULL THEN NULL
             ELSE (SELECT COUNT(*) FROM dbo.TenantBrandProfile WITH (NOLOCK) WHERE TenantId = @tenantId)
             END AS cnt;
    `);
  const brandCount = brand.recordset[0]?.cnt;
  checks.push({
    id: 'brand_profile',
    pass: Number(brandCount) === 1,
    detail:
      brandCount == null
        ? 'TenantBrandProfile table missing (apply DRVO migration 11)'
        : Number(brandCount) === 1
          ? 'Brand profile present'
          : 'Missing TenantBrandProfile row',
  });

  const sub = await getTenantSubscription(db, tenantId);
  checks.push({
    id: 'commercial_subscription',
    pass: sub != null,
    detail: sub ? `Subscription ${sub.planCode}/${sub.status}` : 'Missing TenantSubscription',
  });
  if (sub) {
    const plan = await getPlan(db, sub.planCode);
    checks.push({
      id: 'commercial_plan_valid',
      pass: plan != null,
      detail: plan ? `Plan ${plan.planCode} exists` : `Unknown plan ${sub.planCode}`,
    });
  }

  const registry = await db.request().query(`SELECT AppCode FROM dbo.AppRegistry WITH (NOLOCK);`);
  const registered = new Set(
    (registry.recordset as Array<{ AppCode: string }>).map((r) => String(r.AppCode)),
  );
  const installed = installedAppCodes(await listTenantApps(tenantId, { executor: db }));
  const unregistered = installed.filter((code) => !registered.has(code));
  checks.push({
    id: 'installed_apps_registered',
    pass: installed.length > 0 && unregistered.length === 0,
    detail:
      installed.length === 0
        ? 'No installed apps'
        : unregistered.length
          ? `Installed app(s) missing from AppRegistry: ${unregistered.join(', ')}`
          : `${installed.length} installed app(s): ${installed.join(', ')}`,
  });

  const missingDeps = findMissingDependencies(installed);
  checks.push({
    id: 'installed_apps_dependencies',
    pass: missingDeps.length === 0,
    detail: missingDeps.length
      ? missingDeps.map((m) => `${m.appCode} requires ${m.missing.join(', ')}`).join('; ')
      : 'Installed app dependencies satisfied',
  });

  const packState = await getTenantPackState(db, tenantId);
  checks.push({
    id: 'industry_pack_recorded',
    pass: packState != null,
    detail: packState ? `Industry pack ${packState.packCode}` : 'Missing TenantIndustryPack',
  });
  const packDef = packState && opts.resolvePack ? opts.resolvePack(packState.packCode) : null;
  if (packDef) {
    const missingRequired = packDef.required.filter((code) => !installed.includes(code));
    checks.push({
      id: 'pack_required_apps_installed',
      pass: missingRequired.length === 0,
      detail: missingRequired.length
        ? `Pack ${packDef.packCode} required app(s) not installed: ${missingRequired.join(', ')}`
        : `Pack ${packDef.packCode} required apps installed`,
    });
  }

  const pack = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT PackCode, ManifestJson FROM dbo.SalonPackConfig WITH (NOLOCK)
      WHERE TenantId = @tenantId;
    `);
  const packOk = pack.recordset.length === 1;
  checks.push({
    id: 'salon_pack_config',
    pass: packOk,
    detail: packOk ? 'SalonPackConfig present' : 'Missing SalonPackConfig',
  });

  const overall = checks.every((c) => c.pass) ? 'PASS' : 'FAIL';
  return {
    tenantId,
    tenantCode: tenant.code,
    overall,
    checks,
  };
}
