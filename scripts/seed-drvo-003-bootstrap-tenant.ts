#!/usr/bin/env npx tsx
/**
 * DRVO-003 bootstrap seed — one tenant, one Location per TblBranch row.
 * Staging database last132_agent only. Refuses second Tenant row.
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';
import { getSalonPackManifest } from '../src/packs/salon/manifest';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const STAGING_DB = 'last132_agent';
const PRODUCTION_DB = 'last132';
const BOOTSTRAP_TENANT_CODE = 'CASHER_BOOT';
const BOOTSTRAP_TENANT_NAME = 'Casher Bootstrap Tenant';

function parseArgs(argv: string[]) {
  let expectedDatabase = STAGING_DB;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    }
  }
  return { expectedDatabase };
}

function buildConfig(): sql.config {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.CLOUD_DB_ENCRYPT !== 'false' && process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  };
}

async function main() {
  const { expectedDatabase } = parseArgs(process.argv.slice(2));
  const config = buildConfig();

  if (!config.server || !config.user || !config.database) {
    console.error('Missing database connection environment.');
    process.exit(1);
  }

  if (config.database === PRODUCTION_DB) {
    console.error(`Refusing: production database ${PRODUCTION_DB}.`);
    process.exit(1);
  }

  if (config.database !== expectedDatabase) {
    console.error(`Refusing: expected ${expectedDatabase}, got ${config.database}.`);
    process.exit(1);
  }

  const pool = await sql.connect(config);
  try {
    const existing = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant;`);
    const tenantCount = Number(existing.recordset[0].cnt);
    if (tenantCount > 0) {
      console.error('Refusing: Tenant table already has rows (second tenant forbidden).');
      process.exit(1);
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const tenantInsert = await new sql.Request(tx)
        .input('code', sql.NVarChar(64), BOOTSTRAP_TENANT_CODE)
        .input('name', sql.NVarChar(256), BOOTSTRAP_TENANT_NAME)
        .query(`
          INSERT INTO dbo.Tenant (Code, Name, Status, DefaultTimezone)
          OUTPUT INSERTED.TenantId AS tenantId
          VALUES (@code, @name, N'active', N'Africa/Cairo');
        `);
      const tenantId = String(tenantInsert.recordset[0].tenantId);

      const branches = await new sql.Request(tx).query(`
        SELECT BranchID, BranchCode, ISNULL(TimeZone, N'Africa/Cairo') AS TimeZone
        FROM dbo.TblBranch WITH (NOLOCK)
        ORDER BY BranchID;
      `);

      for (const row of branches.recordset as Array<{
        BranchID: number;
        BranchCode: string;
        TimeZone: string;
      }>) {
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
            INSERT INTO dbo.LegacyIdMap (TenantId, EntityName, LegacyKey, DrvoId)
            VALUES (@tenantId, N'branch', @legacyKey, @drvoId);
          `);
      }

      const branchCountResult = await new sql.Request(tx).query(
        `SELECT COUNT(*) AS cnt FROM dbo.TblBranch;`,
      );
      const locationCountResult = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(
          `SELECT COUNT(*) AS cnt FROM dbo.Location WHERE TenantId = @tenantId;`,
        );
      const branchCount = Number(branchCountResult.recordset[0].cnt);
      const locationCount = Number(locationCountResult.recordset[0].cnt);
      if (locationCount !== branchCount) {
        throw new Error(
          `Location count ${locationCount} does not equal TblBranch count ${branchCount}`,
        );
      }

      const users = await new sql.Request(tx).query(`
        SELECT UserID FROM dbo.TblUser WITH (NOLOCK) WHERE ISNULL(isDeleted, 0) = 0;
      `);
      for (const user of users.recordset as Array<{ UserID: number }>) {
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
            INSERT INTO dbo.LegacyIdMap (TenantId, EntityName, LegacyKey, DrvoId)
            VALUES (@tenantId, N'staff_user', @legacyKey, @drvoId);
          `);
      }

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
            INSERT INTO dbo.TenantAppEntitlement (TenantId, AppCode, Enabled)
            VALUES (@tenantId, @code, 1);
          `);
      }

      const manifestJson = JSON.stringify(getSalonPackManifest());
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('manifest', sql.NVarChar(sql.MAX), manifestJson)
        .query(`
          INSERT INTO dbo.SalonPackConfig (TenantId, PackCode, ManifestJson)
          VALUES (@tenantId, N'salon', @manifest);
        `);

      await tx.commit();
      console.log(`Bootstrap tenant seeded: ${BOOTSTRAP_TENANT_CODE}`);
      console.log(`  locations: ${branches.recordset.length}`);
      console.log(`  memberships: ${users.recordset.length}`);
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
