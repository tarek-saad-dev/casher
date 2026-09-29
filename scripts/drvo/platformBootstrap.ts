/**
 * DRVO-003 platform bootstrap — shared by central migrations and staging tools.
 * Idempotent data reconciliation; never creates a second tenant.
 */
import type { ConnectionPool, Transaction } from 'mssql';
import sql from 'mssql';
import { getSalonPackManifest } from '../../src/packs/salon/manifest';

export const BOOTSTRAP_TENANT_CODE = 'CASHER_BOOT';
export const BOOTSTRAP_TENANT_NAME = 'Casher Bootstrap Tenant';

export type PlatformBootstrapVerifyReport = {
  ok: boolean;
  failures: string[];
  tenantId: string | null;
  branchCodes: string[];
  tenantCount: number;
  locationCount: number;
  branchCount: number;
};

const PLATFORM_TABLES = [
  'Tenant',
  'Location',
  'TenantMembership',
  'LegacyIdMap',
  'PlatformOutbox',
  'AppRegistry',
  'TenantAppEntitlement',
  'SalonPackConfig',
] as const;

export async function tableExists(pool: ConnectionPool, name: string): Promise<boolean> {
  const result = await pool
    .request()
    .input('name', sql.NVarChar(128), name)
    .query(`SELECT OBJECT_ID(N'dbo.' + @name, N'U') AS oid;`);
  return result.recordset[0]?.oid != null;
}

export async function allPlatformCoreTablesExist(pool: ConnectionPool): Promise<boolean> {
  for (const name of PLATFORM_TABLES) {
    if (!(await tableExists(pool, name))) return false;
  }
  return true;
}

export async function verifyPlatformBootstrap(
  pool: ConnectionPool,
): Promise<PlatformBootstrapVerifyReport> {
  const failures: string[] = [];
  for (const name of PLATFORM_TABLES) {
    if (!(await tableExists(pool, name))) failures.push(`Missing table dbo.${name}`);
  }

  let tenantId: string | null = null;
  let tenantCount = 0;
  let branchCodes: string[] = [];
  let locationCount = 0;
  let branchCount = 0;

  if (failures.length === 0) {
    const tenants = await pool.request().query(`
      SELECT TenantId, Code, Status FROM dbo.Tenant WITH (NOLOCK) ORDER BY CreatedAt;
    `);
    tenantCount = tenants.recordset.length;
    if (tenantCount === 0) failures.push('No Tenant row (CASHER_BOOT required)');
    else if (tenantCount > 1) failures.push(`Expected one Tenant row, found ${tenantCount}`);
    else {
      const row = tenants.recordset[0] as { TenantId: string; Code: string; Status: string };
      tenantId = String(row.TenantId);
      if (row.Code !== BOOTSTRAP_TENANT_CODE || row.Status !== 'active') {
        failures.push(`Bootstrap tenant invalid (code=${row.Code}, status=${row.Status})`);
      }
    }
  }

  if (tenantId) {
    const branches = await pool.request().query(`
      SELECT BranchID, BranchCode FROM dbo.TblBranch WITH (NOLOCK) ORDER BY BranchID;
    `);
    branchCount = branches.recordset.length;
    const locRows = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT LegacyBranchId, BranchCode FROM dbo.Location WITH (NOLOCK)
        WHERE TenantId = @tenantId;
      `);
    locationCount = locRows.recordset.length;
    branchCodes = (locRows.recordset as Array<{ BranchCode: string }>).map((r) =>
      String(r.BranchCode),
    );
    const mapped = new Set(
      (locRows.recordset as Array<{ LegacyBranchId: number }>).map((r) =>
        Number(r.LegacyBranchId),
      ),
    );
    const missing = (branches.recordset as Array<{ BranchID: number }>)
      .map((r) => Number(r.BranchID))
      .filter((id) => !mapped.has(id));
    if (missing.length) failures.push(`Missing Location for BranchIDs: ${missing.join(',')}`);
    if (locationCount !== branchCount) {
      failures.push(`Location count ${locationCount} != TblBranch count ${branchCount}`);
    }

    const users = await pool.request().query(`
      SELECT UserID FROM dbo.TblUser WITH (NOLOCK) WHERE ISNULL(isDeleted, 0) = 0;
    `);
    const mem = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT LegacyUserId FROM dbo.TenantMembership WITH (NOLOCK)
        WHERE TenantId = @tenantId;
      `);
    const have = new Set(
      (mem.recordset as Array<{ LegacyUserId: number }>).map((r) => Number(r.LegacyUserId)),
    );
    const missingUsers = (users.recordset as Array<{ UserID: number }>)
      .map((r) => Number(r.UserID))
      .filter((id) => !have.has(id));
    if (missingUsers.length) {
      failures.push(`Missing TenantMembership for UserIDs: ${missingUsers.join(',')}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    tenantId,
    branchCodes,
    tenantCount,
    locationCount,
    branchCount,
  };
}

async function ensureTenant(tx: Transaction): Promise<string> {
  const existing = await new sql.Request(tx).query(`
    SELECT TenantId, Code, Status FROM dbo.Tenant WITH (UPDLOCK, HOLDLOCK);
  `);
  if (existing.recordset.length > 1) {
    throw new Error(
      `Abort: ${existing.recordset.length} Tenant rows (second tenant forbidden).`,
    );
  }
  if (existing.recordset.length === 1) {
    const row = existing.recordset[0] as { TenantId: string; Code: string; Status: string };
    if (row.Code !== BOOTSTRAP_TENANT_CODE) {
      throw new Error(`Abort: tenant code "${row.Code}" is not ${BOOTSTRAP_TENANT_CODE}.`);
    }
    if (row.Status !== 'active') {
      throw new Error(`Abort: bootstrap tenant status "${row.Status}" is not active.`);
    }
    return String(row.TenantId);
  }
  const inserted = await new sql.Request(tx)
    .input('code', sql.NVarChar(64), BOOTSTRAP_TENANT_CODE)
    .input('name', sql.NVarChar(256), BOOTSTRAP_TENANT_NAME)
    .query(`
      INSERT INTO dbo.Tenant (Code, Name, Status, DefaultTimezone)
      OUTPUT INSERTED.TenantId AS tenantId
      VALUES (@code, @name, N'active', N'Africa/Cairo');
    `);
  return String(inserted.recordset[0].tenantId);
}

async function ensureLocations(tx: Transaction, tenantId: string): Promise<number> {
  const branches = await new sql.Request(tx).query(`
    SELECT BranchID, BranchCode, ISNULL(TimeZone, N'Africa/Cairo') AS TimeZone
    FROM dbo.TblBranch WITH (UPDLOCK, HOLDLOCK) ORDER BY BranchID;
  `);
  let added = 0;
  for (const row of branches.recordset as Array<{
    BranchID: number;
    BranchCode: string;
    TimeZone: string;
  }>) {
    const existing = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyBranchId', sql.Int, row.BranchID)
      .query(`
        SELECT LocationId, BranchCode FROM dbo.Location WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND LegacyBranchId = @legacyBranchId;
      `);
    if (existing.recordset.length) {
      const mapped = existing.recordset[0] as { BranchCode: string };
      if (String(mapped.BranchCode) !== String(row.BranchCode)) {
        throw new Error(
          `Abort: BranchID ${row.BranchID} mapped to ${mapped.BranchCode}, expected ${row.BranchCode}.`,
        );
      }
      continue;
    }
    const loc = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyBranchId', sql.Int, row.BranchID)
      .input('branchCode', sql.NVarChar(64), row.BranchCode)
      .input('tz', sql.NVarChar(64), row.TimeZone)
      .query(`
        INSERT INTO dbo.Location (TenantId, LegacyBranchId, BranchCode, Timezone, Status)
        OUTPUT INSERTED.LocationId AS locationId
        VALUES (@tenantId, @legacyBranchId, @branchCode, @tz, N'active');
      `);
    const locationId = String(loc.recordset[0].locationId);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyKey', sql.NVarChar(128), String(row.BranchID))
      .input('drvoId', sql.UniqueIdentifier, locationId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.LegacyIdMap WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND EntityName = N'branch' AND LegacyKey = @legacyKey
        )
          INSERT INTO dbo.LegacyIdMap (TenantId, EntityName, LegacyKey, DrvoId)
          VALUES (@tenantId, N'branch', @legacyKey, @drvoId);
      `);
    added += 1;
  }
  const branchCount = Number(
    (await new sql.Request(tx).query(`SELECT COUNT(*) AS cnt FROM dbo.TblBranch;`)).recordset[0]
      .cnt,
  );
  const locationCount = Number(
    (
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`SELECT COUNT(*) AS cnt FROM dbo.Location WHERE TenantId = @tenantId;`)
    ).recordset[0].cnt,
  );
  if (locationCount !== branchCount) {
    throw new Error(`Abort: Location count ${locationCount} != TblBranch count ${branchCount}`);
  }
  return added;
}

async function ensureMemberships(tx: Transaction, tenantId: string): Promise<number> {
  const users = await new sql.Request(tx).query(`
    SELECT UserID FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK) WHERE ISNULL(isDeleted, 0) = 0;
  `);
  let added = 0;
  for (const user of users.recordset as Array<{ UserID: number }>) {
    const existing = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyUserId', sql.Int, user.UserID)
      .query(`
        SELECT MembershipId FROM dbo.TenantMembership WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND LegacyUserId = @legacyUserId;
      `);
    if (existing.recordset.length) continue;
    const mem = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyUserId', sql.Int, user.UserID)
      .query(`
        INSERT INTO dbo.TenantMembership (TenantId, LegacyUserId)
        OUTPUT INSERTED.MembershipId AS membershipId
        VALUES (@tenantId, @legacyUserId);
      `);
    const membershipId = String(mem.recordset[0].membershipId);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('legacyKey', sql.NVarChar(128), String(user.UserID))
      .input('drvoId', sql.UniqueIdentifier, membershipId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.LegacyIdMap WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND EntityName = N'staff_user' AND LegacyKey = @legacyKey
        )
          INSERT INTO dbo.LegacyIdMap (TenantId, EntityName, LegacyKey, DrvoId)
          VALUES (@tenantId, N'staff_user', @legacyKey, @drvoId);
      `);
    added += 1;
  }
  return added;
}

async function ensureRegistry(tx: Transaction, tenantId: string): Promise<void> {
  const registryApps = [
    ...getSalonPackManifest().enabledApps.map((code) => ({
      code,
      name: code,
      entitled: 1,
    })),
    { code: 'operations', name: 'Operations', entitled: 0 },
  ];
  for (const app of registryApps) {
    await new sql.Request(tx)
      .input('code', sql.NVarChar(64), app.code)
      .input('name', sql.NVarChar(256), app.name)
      .input('entitled', sql.Bit, app.entitled)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.AppRegistry WHERE AppCode = @code)
          INSERT INTO dbo.AppRegistry (AppCode, DisplayName, EntitledSeparately)
          VALUES (@code, @name, @entitled);
      `);
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('code', sql.NVarChar(64), app.code)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TenantAppEntitlement
          WHERE TenantId = @tenantId AND AppCode = @code
        )
          INSERT INTO dbo.TenantAppEntitlement (TenantId, AppCode, Enabled)
          VALUES (@tenantId, @code, 1);
      `);
  }
  const manifestJson = JSON.stringify(getSalonPackManifest());
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('manifest', sql.NVarChar(sql.MAX), manifestJson)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.SalonPackConfig WHERE TenantId = @tenantId)
        INSERT INTO dbo.SalonPackConfig (TenantId, PackCode, ManifestJson)
        VALUES (@tenantId, N'salon', @manifest);
      ELSE
        UPDATE dbo.SalonPackConfig
        SET ManifestJson = @manifest, UpdatedAt = SYSUTCDATETIME()
        WHERE TenantId = @tenantId;
    `);
}

export async function ensurePlatformBootstrapData(
  pool: ConnectionPool,
): Promise<{ tenantId: string; locationsAdded: number; membershipsAdded: number }> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const tenantId = await ensureTenant(tx);
    const locationsAdded = await ensureLocations(tx, tenantId);
    const membershipsAdded = await ensureMemberships(tx, tenantId);
    await ensureRegistry(tx, tenantId);
    await tx.commit();
    return { tenantId, locationsAdded, membershipsAdded };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
