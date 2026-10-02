/**
 * DRVO-003 platform bootstrap — shared by central migrations and staging tools.
 * Idempotent data reconciliation for CASHER_BOOT; additional tenants are allowed.
 * Never replaces existing Location/Membership IDs to satisfy verification.
 */
import type { ConnectionPool, Transaction } from 'mssql';
import sql from 'mssql';
import { seedTenantRegistry } from '../../src/platform/registry/seedTenantRegistry';
import { decideLegacyIdMapAction } from './legacyIdMap';
import { verifyPlatformCoreStructure } from './platformCoreSchema';

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

async function findBootstrapTenantId(pool: ConnectionPool): Promise<string | null> {
  const result = await pool
    .request()
    .input('code', sql.NVarChar(64), BOOTSTRAP_TENANT_CODE)
    .query(`
      SELECT TenantId FROM dbo.Tenant WITH (NOLOCK) WHERE Code = @code;
    `);
  if (!result.recordset.length) return null;
  return String((result.recordset[0] as { TenantId: string }).TenantId);
}

async function ensureLegacyIdMap(
  tx: Transaction,
  args: {
    tenantId: string;
    entityName: 'branch' | 'staff_user';
    legacyKey: string;
    authoritativeDrvoId: string;
  },
): Promise<'ok' | 'inserted'> {
  const existing = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, args.tenantId)
    .input('entityName', sql.NVarChar(64), args.entityName)
    .input('legacyKey', sql.NVarChar(128), args.legacyKey)
    .query(`
      SELECT DrvoId FROM dbo.LegacyIdMap WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND EntityName = @entityName AND LegacyKey = @legacyKey;
    `);

  const existingDrvoId =
    existing.recordset.length > 0
      ? String((existing.recordset[0] as { DrvoId: string }).DrvoId)
      : null;

  if (existing.recordset.length > 1) {
    throw new Error(
      `Abort: duplicate LegacyIdMap rows for ${args.entityName}/${args.legacyKey}`,
    );
  }

  const decision = decideLegacyIdMapAction({
    entityName: args.entityName,
    legacyKey: args.legacyKey,
    authoritativeDrvoId: args.authoritativeDrvoId,
    existingMapDrvoId: existingDrvoId,
  });

  if (decision.action === 'abort') {
    throw new Error(`Abort: ${decision.reason}`);
  }
  if (decision.action === 'ok') {
    return 'ok';
  }

  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, args.tenantId)
    .input('entityName', sql.NVarChar(64), args.entityName)
    .input('legacyKey', sql.NVarChar(128), args.legacyKey)
    .input('drvoId', sql.UniqueIdentifier, decision.drvoId)
    .query(`
      INSERT INTO dbo.LegacyIdMap (TenantId, EntityName, LegacyKey, DrvoId)
      VALUES (@tenantId, @entityName, @legacyKey, @drvoId);
    `);
  return 'inserted';
}

export async function verifyPlatformBootstrap(
  pool: ConnectionPool,
): Promise<PlatformBootstrapVerifyReport> {
  const failures: string[] = [];

  const structure = await verifyPlatformCoreStructure(pool);
  if (!structure.ok) {
    failures.push(...structure.failures);
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
    tenantId = await findBootstrapTenantId(pool);

    if (!tenantId) {
      failures.push(`No ${BOOTSTRAP_TENANT_CODE} tenant row`);
    } else {
      const bootRow = (tenants.recordset as Array<{ TenantId: string; Code: string; Status: string }>).find(
        (row) => String(row.TenantId).toLowerCase() === tenantId!.toLowerCase(),
      );
      if (!bootRow || bootRow.Status !== 'active') {
        failures.push(
          `Bootstrap tenant invalid (code=${bootRow?.Code ?? 'missing'}, status=${bootRow?.Status ?? 'missing'})`,
        );
      }
    }
  }

  if (tenantId && failures.length === 0) {
    const locRows = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT LocationId, LegacyBranchId, BranchCode
        FROM dbo.Location WITH (NOLOCK)
        WHERE TenantId = @tenantId;
      `);
    locationCount = locRows.recordset.length;
    branchCodes = (locRows.recordset as Array<{ BranchCode: string }>).map((r) =>
      String(r.BranchCode),
    );

    type LocRow = { LocationId: string; LegacyBranchId: number; BranchCode: string };
    const locs = locRows.recordset as LocRow[];

    for (const loc of locs) {
      const branchId = Number(loc.LegacyBranchId);
      const branch = await pool
        .request()
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT BranchID, BranchCode FROM dbo.TblBranch WITH (NOLOCK)
          WHERE BranchID = @branchId;
        `);

      if (!branch.recordset.length) {
        failures.push(`Missing legacy branch for CASHER_BOOT Location BranchID ${branchId}`);
        continue;
      }

      const branchRow = branch.recordset[0] as { BranchID: number; BranchCode: string };
      if (String(loc.BranchCode) !== String(branchRow.BranchCode)) {
        failures.push(
          `Location.BranchCode mismatch for BranchID ${branchId}: ` +
            `location=${loc.BranchCode} branch=${branchRow.BranchCode}`,
        );
      }

      const mapRows = await pool
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('legacyKey', sql.NVarChar(128), String(branchId))
        .query(`
          SELECT DrvoId FROM dbo.LegacyIdMap WITH (NOLOCK)
          WHERE TenantId = @tenantId AND EntityName = N'branch' AND LegacyKey = @legacyKey;
        `);
      if (mapRows.recordset.length === 0) {
        failures.push(`Missing LegacyIdMap branch for BranchID ${branchId}`);
      } else if (mapRows.recordset.length > 1) {
        failures.push(`Duplicate LegacyIdMap branch for BranchID ${branchId}`);
      } else {
        const mapId = String((mapRows.recordset[0] as { DrvoId: string }).DrvoId).toLowerCase();
        const locId = String(loc.LocationId).toLowerCase();
        if (mapId !== locId) {
          failures.push(
            `LegacyIdMap branch DrvoId mismatch for BranchID ${branchId}: ` +
              `map=${mapId} location=${locId}`,
          );
        }
      }
    }

    const mappedBranchIds = new Set(locs.map((loc) => Number(loc.LegacyBranchId)));
    const unmappedBranches = await pool.request().query(`
      SELECT BranchID FROM dbo.TblBranch WITH (NOLOCK) ORDER BY BranchID;
    `);
    branchCount = unmappedBranches.recordset.length;

    for (const row of unmappedBranches.recordset as Array<{ BranchID: number }>) {
      const branchId = Number(row.BranchID);
      const mappedAnywhere = await pool
        .request()
        .input('legacyBranchId', sql.Int, branchId)
        .query(`
          SELECT TOP 1 TenantId FROM dbo.Location WITH (NOLOCK)
          WHERE LegacyBranchId = @legacyBranchId;
        `);
      if (!mappedAnywhere.recordset.length) {
        failures.push(`Unmapped legacy branch ${branchId} (no Location row in any tenant)`);
      }
    }

    const mem = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT MembershipId, LegacyUserId FROM dbo.TenantMembership WITH (NOLOCK)
        WHERE TenantId = @tenantId;
      `);
    type MemRow = { MembershipId: string; LegacyUserId: number };
    const memberships = mem.recordset as MemRow[];

    for (const membership of memberships) {
      const userId = Number(membership.LegacyUserId);
      const user = await pool
        .request()
        .input('userId', sql.Int, userId)
        .query(`
          SELECT UserID FROM dbo.TblUser WITH (NOLOCK)
          WHERE UserID = @userId AND ISNULL(isDeleted, 0) = 0;
        `);
      if (!user.recordset.length) {
        failures.push(`Missing legacy user for CASHER_BOOT membership UserID ${userId}`);
        continue;
      }

      const mapRows = await pool
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('legacyKey', sql.NVarChar(128), String(userId))
        .query(`
          SELECT DrvoId FROM dbo.LegacyIdMap WITH (NOLOCK)
          WHERE TenantId = @tenantId AND EntityName = N'staff_user' AND LegacyKey = @legacyKey;
        `);
      if (mapRows.recordset.length === 0) {
        failures.push(`Missing LegacyIdMap staff_user for UserID ${userId}`);
      } else if (mapRows.recordset.length > 1) {
        failures.push(`Duplicate LegacyIdMap staff_user for UserID ${userId}`);
      } else {
        const mapId = String((mapRows.recordset[0] as { DrvoId: string }).DrvoId).toLowerCase();
        const memId = String(membership.MembershipId).toLowerCase();
        if (mapId !== memId) {
          failures.push(
            `LegacyIdMap staff_user DrvoId mismatch for UserID ${userId}: ` +
              `map=${mapId} membership=${memId}`,
          );
        }
      }
    }

    const users = await pool.request().query(`
      SELECT UserID FROM dbo.TblUser WITH (NOLOCK) WHERE ISNULL(isDeleted, 0) = 0;
    `);
    const memByUser = new Map<number, MemRow[]>();
    for (const row of memberships) {
      const uid = Number(row.LegacyUserId);
      const list = memByUser.get(uid) ?? [];
      list.push(row);
      memByUser.set(uid, list);
    }

    for (const user of users.recordset as Array<{ UserID: number }>) {
      const userId = Number(user.UserID);
      const tenantMemberships = await pool
        .request()
        .input('legacyUserId', sql.Int, userId)
        .query(`
          SELECT TenantId FROM dbo.TenantMembership WITH (NOLOCK)
          WHERE LegacyUserId = @legacyUserId;
        `);
      if (!tenantMemberships.recordset.length) {
        failures.push(`Missing TenantMembership for UserID ${userId}`);
        continue;
      }
      const bootstrapMatches = (tenantMemberships.recordset as Array<{ TenantId: string }>).filter(
        (row) => String(row.TenantId).toLowerCase() === tenantId!.toLowerCase(),
      );
      if (bootstrapMatches.length > 1) {
        failures.push(`Duplicate CASHER_BOOT TenantMembership for UserID ${userId}`);
      }
      if (
        tenantMemberships.recordset.length === 1 &&
        bootstrapMatches.length === 0
      ) {
        // User belongs exclusively to another tenant — valid after DRVO-011.
        continue;
      }
    }

    const { getSalonPackManifest } = await import('../../src/packs/salon/manifest');
    const apps = [...getSalonPackManifest().enabledApps, 'operations'];
    for (const code of apps) {
      const reg = await pool
        .request()
        .input('code', sql.NVarChar(64), code)
        .query(`SELECT 1 AS ok FROM dbo.AppRegistry WITH (NOLOCK) WHERE AppCode = @code;`);
      if (!reg.recordset.length) {
        failures.push(`Missing AppRegistry row for ${code}`);
      }
      const ent = await pool
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('code', sql.NVarChar(64), code)
        .query(`
          SELECT 1 AS ok FROM dbo.TenantAppEntitlement WITH (NOLOCK)
          WHERE TenantId = @tenantId AND AppCode = @code;
        `);
      if (!ent.recordset.length) {
        failures.push(`Missing TenantAppEntitlement for ${code}`);
      }
    }

    const pack = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT PackCode, ManifestJson FROM dbo.SalonPackConfig WITH (NOLOCK)
        WHERE TenantId = @tenantId;
      `);
    if (!pack.recordset.length) {
      failures.push('Missing SalonPackConfig for bootstrap tenant');
    } else {
      const row = pack.recordset[0] as { PackCode: string; ManifestJson: string };
      if (String(row.PackCode) !== 'salon') {
        failures.push(`SalonPackConfig.PackCode expected salon, got ${row.PackCode}`);
      }
      const raw = String(row.ManifestJson ?? '').trim();
      if (!raw) {
        failures.push('SalonPackConfig.ManifestJson is empty');
      } else {
        try {
          const parsed = JSON.parse(raw) as { enabledApps?: unknown };
          if (!Array.isArray(parsed.enabledApps) || parsed.enabledApps.length === 0) {
            failures.push('SalonPackConfig.ManifestJson missing enabledApps');
          }
        } catch {
          failures.push('SalonPackConfig.ManifestJson is not valid JSON');
        }
      }
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
  const bootstrap = await new sql.Request(tx)
    .input('code', sql.NVarChar(64), BOOTSTRAP_TENANT_CODE)
    .query(`
      SELECT TenantId, Code, Status FROM dbo.Tenant WITH (UPDLOCK, HOLDLOCK)
      WHERE Code = @code;
    `);

  if (bootstrap.recordset.length > 1) {
    throw new Error(`Abort: duplicate ${BOOTSTRAP_TENANT_CODE} tenant rows.`);
  }
  if (bootstrap.recordset.length === 1) {
    const row = bootstrap.recordset[0] as { TenantId: string; Code: string; Status: string };
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
    const mappedAnywhere = await new sql.Request(tx)
      .input('legacyBranchId', sql.Int, row.BranchID)
      .query(`
        SELECT TenantId, LocationId, BranchCode FROM dbo.Location WITH (UPDLOCK, HOLDLOCK)
        WHERE LegacyBranchId = @legacyBranchId;
      `);

    if (mappedAnywhere.recordset.length > 1) {
      throw new Error(`Abort: duplicate Location for BranchID ${row.BranchID}`);
    }

    let locationId: string;
    if (mappedAnywhere.recordset.length === 1) {
      const mapped = mappedAnywhere.recordset[0] as {
        TenantId: string;
        LocationId: string;
        BranchCode: string;
      };
      if (String(mapped.TenantId).toLowerCase() !== tenantId.toLowerCase()) {
        // Branch belongs to another tenant — never attach to CASHER_BOOT.
        continue;
      }
      if (String(mapped.BranchCode) !== String(row.BranchCode)) {
        throw new Error(
          `Abort: BranchID ${row.BranchID} mapped to ${mapped.BranchCode}, expected ${row.BranchCode}.`,
        );
      }
      locationId = String(mapped.LocationId);
    } else {
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
      locationId = String(loc.recordset[0].locationId);
      added += 1;
    }

    await ensureLegacyIdMap(tx, {
      tenantId,
      entityName: 'branch',
      legacyKey: String(row.BranchID),
      authoritativeDrvoId: locationId,
    });
  }

  const bootstrapLocationCount = Number(
    (
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`SELECT COUNT(*) AS cnt FROM dbo.Location WHERE TenantId = @tenantId;`)
    ).recordset[0].cnt,
  );
  const unmappedCount = Number(
    (
      await new sql.Request(tx).query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.TblBranch b
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.Location l WHERE l.LegacyBranchId = b.BranchID
        );
      `)
    ).recordset[0].cnt,
  );
  if (unmappedCount > 0) {
    throw new Error(`Abort: ${unmappedCount} legacy branch(es) have no Location mapping`);
  }
  if (bootstrapLocationCount === 0) {
    throw new Error('Abort: CASHER_BOOT has no Location rows after reconcile');
  }
  return added;
}

async function ensureMemberships(tx: Transaction, tenantId: string): Promise<number> {
  const users = await new sql.Request(tx).query(`
    SELECT UserID FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK) WHERE ISNULL(isDeleted, 0) = 0;
  `);
  let added = 0;
  for (const user of users.recordset as Array<{ UserID: number }>) {
    const existingAny = await new sql.Request(tx)
      .input('legacyUserId', sql.Int, user.UserID)
      .query(`
        SELECT TenantId, MembershipId FROM dbo.TenantMembership WITH (UPDLOCK, HOLDLOCK)
        WHERE LegacyUserId = @legacyUserId;
      `);

    if (existingAny.recordset.length > 1) {
      throw new Error(`Abort: duplicate TenantMembership for UserID ${user.UserID}`);
    }

    let membershipId: string;
    if (existingAny.recordset.length === 1) {
      const mapped = existingAny.recordset[0] as { TenantId: string; MembershipId: string };
      if (String(mapped.TenantId).toLowerCase() !== tenantId.toLowerCase()) {
        continue;
      }
      membershipId = String(mapped.MembershipId);
    } else {
      const mem = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('legacyUserId', sql.Int, user.UserID)
        .query(`
          INSERT INTO dbo.TenantMembership (TenantId, LegacyUserId)
          OUTPUT INSERTED.MembershipId AS membershipId
          VALUES (@tenantId, @legacyUserId);
        `);
      membershipId = String(mem.recordset[0].membershipId);
      added += 1;
    }

    await ensureLegacyIdMap(tx, {
      tenantId,
      entityName: 'staff_user',
      legacyKey: String(user.UserID),
      authoritativeDrvoId: membershipId,
    });
  }
  return added;
}

async function ensureRegistry(tx: Transaction, tenantId: string): Promise<void> {
  await seedTenantRegistry(tx, tenantId, 'salon');
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
