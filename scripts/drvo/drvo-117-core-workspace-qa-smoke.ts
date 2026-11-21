#!/usr/bin/env npx tsx
/**
 * Issue #117 staging QA — last132_agent / drvo_agent only.
 *
 * Two synthetic tenants (A/B): workforce directory boundaries, workspace active
 * Location isolation, synthetic readiness providers, CASHER_BOOT roster unchanged.
 *
 * Never loads .env.local. Requires DRVO_STAGING_DB_PASSWORD and SSH tunnel to 14330.
 */
import Module from 'module';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, parent, isMain);
};

import sql from 'mssql';

const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';
const PRODUCTION_DB = 'last132';
const ASSIGNMENT_START = '2026-10-27';
const ASSIGNMENT_BEFORE = '2026-10-26';

const SMOKE_TENANTS = [
  { code: 'DRVO117_A', branch: 'DRVO117_ABR', login: 'drvo117_a_owner' },
  { code: 'DRVO117_B', branch: 'DRVO117_BBR', login: 'drvo117_b_owner' },
] as const;

function forceStagingEnv(password: string) {
  const server = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: server,
    CLOUD_DB_PORT: port,
    CLOUD_DB_NAME: EXPECTED_DB,
    CLOUD_DB_USER: EXPECTED_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: server,
    DB_PORT: port,
    DB_DATABASE: EXPECTED_DB,
    DB_USER: EXPECTED_LOGIN,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function buildConfig(): sql.config {
  return {
    server: process.env.DB_SERVER || '',
    port: parseInt(process.env.DB_PORT || '14330', 10),
    database: process.env.DB_DATABASE || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  };
}

async function assertStaging(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login;`);
  const liveDb = String(result.recordset[0].db);
  const login = String(result.recordset[0].login);
  if (liveDb === PRODUCTION_DB) throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  if (liveDb !== EXPECTED_DB) throw new Error(`Refusing: expected ${EXPECTED_DB}, got ${liveDb}`);
  if (login.toLowerCase() !== EXPECTED_LOGIN) {
    throw new Error(`Refusing: expected login ${EXPECTED_LOGIN}, got ${login}`);
  }
  console.log(`  live database: ${liveDb} (${login})`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ok: ${message}`);
}

async function expectError(fn: () => Promise<unknown>, code: string, message: string) {
  try {
    await fn();
  } catch (err) {
    const actual = (err as { code?: string }).code;
    check(actual === code, `${message} (got ${actual ?? String(err)})`);
    return;
  }
  throw new Error(`${message}: expected ${code}, but call succeeded`);
}

async function casherBootEmpCount(pool: sql.ConnectionPool): Promise<number> {
  const r = await pool.request().query(`
    SELECT COUNT_BIG(*) AS c
    FROM dbo.TblEmp e
    INNER JOIN dbo.Tenant t ON t.TenantId = e.TenantId
    WHERE t.Code = N'CASHER_BOOT';
  `);
  return Number(r.recordset[0].c);
}

async function cleanupTenant(pool: sql.ConnectionPool, tenantCode: string): Promise<void> {
  const { purgeSmokeTenant } = await import('./smokeTenantPurge');
  if (await purgeSmokeTenant(pool, tenantCode)) {
    console.log(`  cleanup: removed ${tenantCode}`);
  }
}

async function cleanupAll(pool: sql.ConnectionPool) {
  for (const t of SMOKE_TENANTS) await cleanupTenant(pool, t.code);
}

async function insertAssignedEmployee(
  pool: sql.ConnectionPool,
  tenantId: string,
  branchId: number,
  displayName: string,
): Promise<number> {
  const ins = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('name', sql.NVarChar(100), displayName)
    .query(`
      INSERT INTO dbo.TblEmp (TenantId, EmpName, Job, isActive)
      OUTPUT INSERTED.EmpID
      VALUES (@tenantId, @name, N'Staff', 1);
    `);
  const empId = Number(ins.recordset[0].EmpID);
  await pool
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('from', sql.Date, ASSIGNMENT_START)
    .query(`
      INSERT INTO dbo.TblEmpBranchAssignment (
        EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom, EffectiveTo, Notes
      )
      VALUES (@empId, @branchId, 1, 1, 1, @from, NULL, N'drvo117-smoke');
    `);
  return empId;
}

function staffActor(tenantId: string): import('@/platform/public').ActorContext {
  return {
    actorType: 'staff',
    actorId: '117',
    tenantId,
    membershipId: 'drvo117-smoke',
    viewLocationId: null,
  };
}

async function main() {
  if (process.env.DB_DATABASE === PRODUCTION_DB || process.env.CLOUD_DB_NAME === PRODUCTION_DB) {
    console.error('Refusing production database env');
    process.exit(1);
  }
  const password = process.env.DRVO_STAGING_DB_PASSWORD || '';
  if (!password) {
    console.error('Missing DRVO_STAGING_DB_PASSWORD (staging only; .env.local is never read).');
    process.exit(1);
  }
  forceStagingEnv(password);

  const config = buildConfig();
  if (config.database !== EXPECTED_DB || config.user !== EXPECTED_LOGIN) {
    console.error(`Refusing: database must be ${EXPECTED_DB} as ${EXPECTED_LOGIN}`);
    process.exit(1);
  }

  const { provisionTenant } = await import('../../src/platform/onboarding/provisionTenant');
  const tenantCtx = await import('../../src/platform/tenant/tenantContext');
  const { SALON_PACK } = await import('../../src/packs/salon/public');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');
  const { createLegacyWorkforceDirectoryAdapter } = await import('@/shared/workforce/public');
  const { evaluateTenantGoLive } = await import('../../src/platform/onboarding/goLiveReadiness');
  const { buildTenantWorkspace } = await import('../../src/platform/tenant/workspaceReadiness');
  const { enrichTenantWorkspaceWithProviders } = await import('../../src/platform/tenant/workspaceSignalCollector');
  const { getTenantInstalledAppsForGate } = await import('../../src/platform/commercial/tenantAccessGate');
  const directory = createLegacyWorkforceDirectoryAdapter();

  const pool = await sql.connect(config);
  try {
    await assertStaging(pool);

    const preflight = await verifyPlatformBootstrap(pool);
    if (!preflight.ok) {
      throw new Error(`Preflight failed: ${preflight.failures.join('; ')}`);
    }
    console.log('PASS: platform bootstrap preflight');

    const bootEmpBefore = await casherBootEmpCount(pool);
    console.log(`  CASHER_BOOT TblEmp baseline: ${bootEmpBefore}`);

    await cleanupAll(pool);

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo117-smoke' };

    console.log('Scenario 1 — provision tenants A and B');
    const [defA, defB] = SMOKE_TENANTS;
    const a = await provisionTenant(
      {
        tenantCode: defA.code,
        tenantDisplayName: 'DRVO-117 Tenant A',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO117 A Owner',
        ownerLoginName: defA.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: defA.branch,
        firstBranchName: 'DRVO117 A Branch',
        industryPack: SALON_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    const b = await provisionTenant(
      {
        tenantCode: defB.code,
        tenantDisplayName: 'DRVO-117 Tenant B',
        defaultTimezone: 'Asia/Riyadh',
        ownerUserName: 'DRVO117 B Owner',
        ownerLoginName: defB.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: defB.branch,
        firstBranchName: 'DRVO117 B Branch',
        industryPack: SALON_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    const tenantA = a.tenantId.toLowerCase();
    const tenantB = b.tenantId.toLowerCase();
    check(tenantA !== tenantB, 'two distinct tenants provisioned');

    const empA = await insertAssignedEmployee(pool, tenantA, a.legacyBranchId, 'DRVO117 Employee A');
    const empB = await insertAssignedEmployee(pool, tenantB, b.legacyBranchId, 'DRVO117 Employee B');

    console.log('Scenario 2 — workforce directory boundaries');
    const locFilterA = { location: { locationId: a.locationId, onDate: ASSIGNMENT_START } };
    const locFilterB = { location: { locationId: b.locationId, onDate: ASSIGNMENT_START } };
    const rosterOnStart = await directory.listEmployees(staffActor(tenantA), locFilterA);
    check(rosterOnStart.some((e) => e.employeeId === empA), 'employee A listed on assignment start date');
    const rosterBefore = await directory.listEmployees(staffActor(tenantA), {
      location: { locationId: a.locationId, onDate: ASSIGNMENT_BEFORE },
    });
    check(!rosterBefore.some((e) => e.employeeId === empA), 'assignment boundary: day before EffectiveFrom excluded');
    check(await directory.getEmployee(staffActor(tenantA), empB, locFilterA) === null, 'tenant A cannot read tenant B employee by id');
    const crossList = await directory.listEmployees(staffActor(tenantA), locFilterB);
    check(crossList.length === 0, 'tenant A roster at tenant B location is empty');

    console.log('Scenario 3 — inactive branch rejected');
    await pool.request().input('branchId', sql.Int, a.legacyBranchId).query(`
      UPDATE dbo.TblBranch SET IsActive = 0 WHERE BranchID = @branchId;
      UPDATE dbo.Location SET Status = N'inactive'
      WHERE LegacyBranchId = @branchId;
    `);
    const inactiveRoster = await directory.listEmployees(staffActor(tenantA), locFilterA);
    check(inactiveRoster.length === 0, 'inactive branch/location yields empty workforce roster');
    await pool.request().input('branchId', sql.Int, a.legacyBranchId).query(`
      UPDATE dbo.TblBranch SET IsActive = 1 WHERE BranchID = @branchId;
      UPDATE dbo.Location SET Status = N'active'
      WHERE LegacyBranchId = @branchId;
    `);

    console.log('Scenario 4 — workspace active Location and membership isolation');
    const ctxA = await tenantCtx.resolveStaffTenantContextForRequest({
      userId: a.legacyUserId,
      activeBranchId: a.legacyBranchId,
    });
    check(ctxA.activeLocation.locationId.toLowerCase() === a.locationId.toLowerCase(), 'user A active Location matches provisioned branch');
    await expectError(
      () => tenantCtx.resolveStaffTenantContextForRequest({ userId: a.legacyUserId, activeBranchId: b.legacyBranchId }),
      'LOCATION_NOT_IN_TENANT',
      'user A cannot activate tenant B branch',
    );
    await expectError(
      () => tenantCtx.resolveUserTenantMembership({ userId: a.legacyUserId, preferredTenantId: tenantB }),
      'TENANT_MEMBERSHIP_MISMATCH',
      'user A cannot claim tenant B membership',
    );
    const branchesB = await tenantCtx.listTenantLegacyBranchIds(tenantB);
    check(!branchesB.has(a.legacyBranchId), 'tenant B branch list excludes tenant A branch');

    console.log('Scenario 5 — synthetic readiness providers (fail / unknown / observed / throw)');
    const installedA = await getTenantInstalledAppsForGate(tenantA);
    const goLiveA = await evaluateTenantGoLive(tenantA);
    const baseline = buildTenantWorkspace(goLiveA, installedA);

    const failOut = await enrichTenantWorkspaceWithProviders(baseline, tenantA, [
      {
        appCode: 'booking',
        check: async (tid) => ({
          tenantId: tid,
          appCode: 'booking',
          checks: [{ key: 'booking_setup', state: 'fail', detail: 'Configure booking', actionHref: '/admin/booking' }],
          usage: 'unknown',
        }),
      },
    ]);
    check(failOut.apps.find((app) => app.code === 'booking')?.status === 'needs_setup', 'provider fail -> needs_setup');

    const unknownOut = await enrichTenantWorkspaceWithProviders(baseline, tenantA, [
      {
        appCode: 'queue',
        check: async (tid) => ({
          tenantId: tid,
          appCode: 'queue',
          checks: [{ key: 'queue_audit', state: 'unknown', detail: 'Not audited yet' }],
          usage: 'unknown',
        }),
      },
    ]);
    check(unknownOut.apps.find((app) => app.code === 'queue')?.status === 'installed_unverified', 'provider unknown check -> installed_unverified');

    const observedOut = await enrichTenantWorkspaceWithProviders(baseline, tenantA, [
      {
        appCode: 'pos',
        check: async (tid) => ({
          tenantId: tid,
          appCode: 'pos',
          checks: [{ key: 'pos_ready', state: 'pass', detail: 'POS configured' }],
          usage: 'observed',
        }),
      },
    ]);
    check(observedOut.apps.find((app) => app.code === 'pos')?.status === 'in_use', 'pass + observed -> in_use');

    const throwOut = await enrichTenantWorkspaceWithProviders(baseline, tenantA, [
      {
        appCode: 'treasury',
        check: async () => {
          throw new Error('provider internal failure');
        },
      },
    ]);
    check(throwOut.apps.find((app) => app.code === 'treasury')?.status === 'installed_unverified', 'thrown provider -> installed_unverified');

    console.log('Scenario 6 — cleanup and CASHER_BOOT roster unchanged');
    await cleanupAll(pool);
    const bootEmpAfter = await casherBootEmpCount(pool);
    check(bootEmpAfter === bootEmpBefore, `CASHER_BOOT TblEmp count unchanged (${bootEmpBefore} -> ${bootEmpAfter})`);

    const postBootstrap = await verifyPlatformBootstrap(pool);
    check(postBootstrap.ok, 'CASHER_BOOT bootstrap verify after cleanup');

    console.log('DRVO117_CORE_WORKSPACE_QA_STAGING_PASS');
    process.exit(0);
  } catch (err) {
    console.error('DRVO117_CORE_WORKSPACE_QA_STAGING_FAIL', err);
    try {
      await cleanupAll(pool);
    } catch {
      /* best effort */
    }
    process.exit(1);
  } finally {
    await pool.close();
  }
}

main();
