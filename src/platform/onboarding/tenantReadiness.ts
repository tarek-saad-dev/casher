import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { ALL_KNOWN_APP_CODES } from '@/platform/registry/constants';
import type { ReadinessCheck, TenantReadinessReport } from './types';

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

      const setup = String(row.LifecycleStatus) === 'SETUP';
      checks.push({
        id: `branch_lifecycle_setup_${branchId}`,
        pass: setup,
        detail: setup
          ? `Branch ${branchId} lifecycle is SETUP`
          : `Branch ${branchId} lifecycle is ${row.LifecycleStatus}`,
      });

      const bookingOff = !Boolean(row.PublicBookingEnabled);
      checks.push({
        id: `public_booking_disabled_${branchId}`,
        pass: bookingOff,
        detail: bookingOff
          ? `Public booking disabled for branch ${branchId}`
          : `Public booking must remain disabled during onboarding`,
      });

      const inactive = !Boolean(row.IsActive);
      checks.push({
        id: `branch_inactive_${branchId}`,
        pass: inactive,
        detail: inactive
          ? `Branch ${branchId} is inactive (SETUP onboarding)`
          : `Branch ${branchId} must remain inactive during onboarding`,
      });

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

  const apps = [...ALL_KNOWN_APP_CODES];
  for (const code of apps) {
    const reg = await db
      .request()
      .input('code', sql.NVarChar(64), code)
      .query(`SELECT 1 AS ok FROM dbo.AppRegistry WITH (NOLOCK) WHERE AppCode = @code;`);
    checks.push({
      id: `app_registry_${code}`,
      pass: reg.recordset.length > 0,
      detail:
        reg.recordset.length > 0
          ? `AppRegistry has ${code}`
          : `Missing AppRegistry row for ${code}`,
    });

    const ent = await db
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('code', sql.NVarChar(64), code)
      .query(`
        SELECT Enabled FROM dbo.TenantAppEntitlement WITH (NOLOCK)
        WHERE TenantId = @tenantId AND AppCode = @code;
      `);
    checks.push({
      id: `tenant_entitlement_${code}`,
      pass: ent.recordset.length > 0,
      detail:
        ent.recordset.length > 0
          ? `TenantAppEntitlement has ${code}`
          : `Missing TenantAppEntitlement for ${code}`,
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
