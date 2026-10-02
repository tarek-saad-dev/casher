#!/usr/bin/env npx tsx
/**
 * DRVO-011 staging smoke — last132_agent / drvo_agent only.
 * Scenarios: create tenant, duplicate protection, cleanup, CASHER_BOOT verify.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

import sql from 'mssql';

const STAGING_DB = 'last132_agent';
const PRODUCTION_DB = 'last132';
const SMOKE_TENANT_CODE = 'DRVO011_SMOKE';
const SMOKE_BRANCH_CODE = 'DRVO011_BR';
const SMOKE_OWNER_LOGIN = 'drvo011_smoke_owner';

function forceStagingEnv(password: string) {
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: '127.0.0.1',
    CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: 'drvo_agent',
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: STAGING_DB,
    DB_USER: 'drvo_agent',
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function buildConfig(): sql.config {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '14330', 10),
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

async function resolveSmokeActorUserId(pool: sql.ConnectionPool): Promise<number> {
  const result = await pool.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY UserID;
  `);
  if (!result.recordset.length) {
    throw new Error('No active TblUser row available for smoke actor');
  }
  return Number((result.recordset[0] as { UserID: number }).UserID);
}

async function assertLiveDatabase(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login;`);
  const liveDb = String(result.recordset[0].db);
  const login = String(result.recordset[0].login);
  if (liveDb === PRODUCTION_DB) {
    throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  }
  if (liveDb !== STAGING_DB) {
    throw new Error(`Refusing: expected ${STAGING_DB}, got ${liveDb}`);
  }
  if (login.toLowerCase() !== 'drvo_agent') {
    throw new Error(`Refusing: expected login drvo_agent, got ${login}`);
  }
  console.log(`  live database: ${liveDb} (${login})`);
}

async function cleanupSmokeTenant(pool: sql.ConnectionPool): Promise<void> {
  const tenant = await pool
    .request()
    .input('code', sql.NVarChar(64), SMOKE_TENANT_CODE)
    .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code;`);
  if (!tenant.recordset.length) return;

  const tenantId = String((tenant.recordset[0] as { TenantId: string }).TenantId);
  const locations = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId;`);
  const branchIds = (locations.recordset as Array<{ LegacyBranchId: number }>).map((r) =>
    Number(r.LegacyBranchId),
  );

  const memberships = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT LegacyUserId FROM dbo.TenantMembership WHERE TenantId = @tenantId;`);
  const userIds = (memberships.recordset as Array<{ LegacyUserId: number }>).map((r) =>
    Number(r.LegacyUserId),
  );

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        DELETE FROM dbo.PlatformOutbox WHERE TenantId = @tenantId;
        DELETE FROM dbo.SalonPackConfig WHERE TenantId = @tenantId;
        DELETE FROM dbo.TenantAppEntitlement WHERE TenantId = @tenantId;
        DELETE FROM dbo.LegacyIdMap WHERE TenantId = @tenantId;
        DELETE FROM dbo.TenantMembership WHERE TenantId = @tenantId;
        DELETE FROM dbo.Location WHERE TenantId = @tenantId;
        DELETE FROM dbo.Tenant WHERE TenantId = @tenantId;
      `);

    for (const userId of userIds) {
      await new sql.Request(tx)
        .input('userId', sql.Int, userId)
        .query(`
          DELETE FROM dbo.TblUserBranchAccess WHERE UserID = @userId;
          DELETE FROM dbo.TblUser WHERE UserID = @userId;
        `);
    }

    for (const branchId of branchIds) {
      await new sql.Request(tx)
        .input('branchId', sql.Int, branchId)
        .query(`
          DELETE FROM dbo.QueueBookingSettings WHERE BranchID = @branchId;
          DELETE FROM dbo.TblBranch WHERE BranchID = @branchId;
        `);
    }

    await tx.commit();
    console.log('  cleanup: removed DRVO011 synthetic tenant residue');
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function main() {
  const password =
    process.env.DRVO_STAGING_DB_PASSWORD ||
    process.env.CLOUD_DB_PASSWORD ||
    process.env.DB_PASSWORD ||
    '';
  if (!password) {
    console.error('Missing DRVO_STAGING_DB_PASSWORD');
    process.exit(1);
  }
  forceStagingEnv(password);

  const { provisionTenant } = await import('../../src/platform/onboarding/provisionTenant');
  const { TenantOnboardingError } = await import('../../src/platform/onboarding/errors');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');

  const config = buildConfig();
  if (!config.server || !config.user || !config.database) {
    console.error('Missing database connection environment.');
    process.exit(1);
  }
  if (config.database === PRODUCTION_DB || config.database !== STAGING_DB) {
    console.error(`Refusing: database must be ${STAGING_DB}`);
    process.exit(1);
  }

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);
    await cleanupSmokeTenant(pool);

    const actorUserId = await resolveSmokeActorUserId(pool);

    console.log('Scenario 1 — create tenant');
    const created = await provisionTenant(
      {
        tenantCode: SMOKE_TENANT_CODE,
        tenantDisplayName: 'DRVO-011 Smoke Tenant',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO011 Owner',
        ownerLoginName: SMOKE_OWNER_LOGIN,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: SMOKE_BRANCH_CODE,
        firstBranchName: 'DRVO011 Smoke Branch',
      },
      { actorUserId, actorUserName: 'drvo-smoke' },
    );
    console.log(`  tenantId=${created.tenantId} readiness=${created.readiness.overall}`);

    if (created.readiness.overall !== 'PASS') {
      throw new Error(`Readiness FAIL: ${JSON.stringify(created.readiness.checks.filter((c) => !c.pass))}`);
    }

    const withExtraTenant = await verifyPlatformBootstrap(pool);
    if (!withExtraTenant.ok) {
      throw new Error(
        `CASHER_BOOT verify failed with extra tenant present: ${withExtraTenant.failures.join('; ')}`,
      );
    }
    console.log(`  CASHER_BOOT verify OK (tenantCount=${withExtraTenant.tenantCount})`);

    console.log('Scenario 2 — duplicate protection');
    let duplicateBlocked = false;
    try {
      await provisionTenant(
        {
          tenantCode: SMOKE_TENANT_CODE,
          tenantDisplayName: 'Duplicate',
          defaultTimezone: 'Africa/Cairo',
          ownerUserName: 'Dup Owner',
          ownerLoginName: 'dup_owner',
          ownerPassword: 'x',
          firstBranchCode: 'DUP_BR',
          firstBranchName: 'Dup Branch',
        },
        { actorUserId },
      );
    } catch (err) {
      duplicateBlocked = err instanceof TenantOnboardingError && err.code === 'TENANT_CODE_CONFLICT';
    }
    if (!duplicateBlocked) {
      throw new Error('Expected TENANT_CODE_CONFLICT on duplicate tenant code');
    }
    console.log('  duplicate tenant code rejected');

    console.log('Scenario 3 — cleanup');
    await cleanupSmokeTenant(pool);
    const afterCleanup = await pool
      .request()
      .input('code', sql.NVarChar(64), SMOKE_TENANT_CODE)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code = @code;`);
    if (Number(afterCleanup.recordset[0].cnt) !== 0) {
      throw new Error('Smoke tenant residue remains after cleanup');
    }
    console.log('  no DRVO011 residue');

    console.log('Scenario 4 — CASHER_BOOT verify after cleanup');
    const baseline = await verifyPlatformBootstrap(pool);
    if (!baseline.ok) {
      throw new Error(`Baseline verify failed: ${baseline.failures.join('; ')}`);
    }
    console.log('  baseline CASHER_BOOT verify OK');

    console.log('DRVO-011 smoke PASS');
  } finally {
    try {
      await cleanupSmokeTenant(pool);
    } catch {
      /* best effort */
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-011 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
