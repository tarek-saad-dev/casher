#!/usr/bin/env npx tsx
/**
 * DRVO-017 staging smoke — last132_agent / drvo_agent only.
 *
 * Scenarios: migration 11 verify + CASHER_BOOT brand seed, operator creates a non-salon tenant
 * (with brand), first branch usable, owner login path succeeds with the tenant admin role,
 * user limit enforced, suspend blocks, reactivate restores, cleanup.
 *
 * First-sale proof is NOT part of this smoke: it completes after DRVO-015 (master-data tenancy).
 *
 * Never loads .env.local (it may point at production). Requires DRVO_STAGING_DB_PASSWORD.
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

const STAGING_DB = 'last132_agent';
const STAGING_LOGIN = 'drvo_agent';
const PRODUCTION_DB = 'last132';

const SMOKE_TENANT = {
  code: 'DRVO017_MARKET',
  branch: 'DRVO017_MBR',
  login: 'drvo017_market_owner',
  password: 'smoke-pass-change-me',
} as const;
const EXTRA_USER_PREFIX = 'drvo017_staff_';

function forceStagingEnv(password: string) {
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1',
    CLOUD_DB_PORT: process.env.DRVO_STAGING_DB_PORT || '14330',
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1',
    DB_PORT: process.env.DRVO_STAGING_DB_PORT || '14330',
    DB_DATABASE: STAGING_DB,
    DB_USER: STAGING_LOGIN,
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

async function assertLiveDatabase(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login;`);
  const liveDb = String(result.recordset[0].db);
  const login = String(result.recordset[0].login);
  if (liveDb === PRODUCTION_DB) throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  if (liveDb !== STAGING_DB) throw new Error(`Refusing: expected ${STAGING_DB}, got ${liveDb}`);
  if (login.toLowerCase() !== STAGING_LOGIN) {
    throw new Error(`Refusing: expected login ${STAGING_LOGIN}, got ${login}`);
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

async function cleanupTenant(pool: sql.ConnectionPool, tenantCode: string): Promise<void> {
  const tenant = await pool
    .request()
    .input('code', sql.NVarChar(64), tenantCode)
    .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code;`);
  if (!tenant.recordset.length) return;
  const tenantId = String(tenant.recordset[0].TenantId);

  const branchIds = (
    await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { LegacyBranchId: number }) => Number(r.LegacyBranchId));
  const userIds = (
    await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT LegacyUserId FROM dbo.TenantMembership WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { LegacyUserId: number }) => Number(r.LegacyUserId));

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).input('tenantId', sql.UniqueIdentifier, tenantId).query(`
      DELETE FROM dbo.PlatformOutbox WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantBrandProfile WHERE TenantId = @tenantId;
      DELETE FROM dbo.SalonPackConfig WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantIndustryPack WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantSubscription WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantAppEntitlement WHERE TenantId = @tenantId;
      DELETE FROM dbo.LegacyIdMap WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantMembership WHERE TenantId = @tenantId;
      DELETE FROM dbo.Location WHERE TenantId = @tenantId;
      DELETE FROM dbo.Tenant WHERE TenantId = @tenantId;
    `);
    for (const userId of userIds) {
      await new sql.Request(tx).input('userId', sql.Int, userId).query(`
        DELETE FROM dbo.TblUserRoles WHERE UserID = @userId;
        DELETE FROM dbo.TblUserBranchAccess WHERE UserID = @userId;
        DELETE FROM dbo.TblUser WHERE UserID = @userId;
      `);
    }
    for (const branchId of branchIds) {
      await new sql.Request(tx).input('branchId', sql.Int, branchId).query(`
        DELETE FROM dbo.QueueBookingSettings WHERE BranchID = @branchId;
        DELETE FROM dbo.TblBranchLifecycleAudit WHERE BranchID = @branchId;
        DELETE FROM dbo.TblBranch WHERE BranchID = @branchId;
      `);
    }
    await tx.commit();
    console.log(`  cleanup: removed ${tenantCode}`);
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD || '';
  if (!password) {
    console.error('Missing DRVO_STAGING_DB_PASSWORD (staging only; .env.local is never read).');
    process.exit(1);
  }
  forceStagingEnv(password);

  const config = buildConfig();
  if (config.database !== STAGING_DB || config.user !== STAGING_LOGIN) {
    console.error(`Refusing: database must be ${STAGING_DB} as ${STAGING_LOGIN}`);
    process.exit(1);
  }

  const { provisionTenant } = await import('../../src/platform/onboarding/provisionTenant');
  const subs = await import('../../src/platform/commercial/subscriptionService');
  const gate = await import('../../src/platform/commercial/tenantAccessGate');
  const { loadTenantBrandProfile } = await import('../../src/platform/branding/brandRepository');
  const { createTenantStaffUser } = await import('../../src/lib/tenant/tenantStaffUsers');
  const { resolveLoginDefaultBranch } = await import('../../src/lib/branch/access');
  const { resolveStaffTenantContextForRequest } = await import('../../src/platform/tenant/tenantContext');
  const { getUserAccess } = await import('../../src/lib/permissions-server');
  const { SUPERMARKET_PACK } = await import('../../src/packs/supermarket/public');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');
  const { verifyTenantBrandProfileSchema } = await import('./migrations/011-tenant-brand-profile');

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);
    await cleanupTenant(pool, SMOKE_TENANT.code);

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo017-smoke' };

    console.log('Scenario 1 — migration 11 verify + CASHER_BOOT brand seed');
    const schema = await verifyTenantBrandProfileSchema(pool);
    check(schema.ok, `migration 11 verify (${schema.failures.join('; ') || 'clean'})`);
    const boot = await pool.request().query(`SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT';`);
    const bootBrand = await loadTenantBrandProfile(String(boot.recordset[0].TenantId));
    check(bootBrand?.displayName === 'Cut Salon' && bootBrand.revision >= 1, 'CASHER_BOOT keeps Cut Salon branding');

    console.log('Scenario 2 — operator creates a non-salon tenant');
    const created = await provisionTenant(
      {
        tenantCode: SMOKE_TENANT.code,
        tenantDisplayName: 'DRVO-017 Market',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO017 Owner',
        ownerLoginName: SMOKE_TENANT.login,
        ownerPassword: SMOKE_TENANT.password,
        firstBranchCode: SMOKE_TENANT.branch,
        firstBranchName: 'DRVO017 Market Branch',
        industryPack: SUPERMARKET_PACK,
        subscriptionStatus: 'active',
        brand: { phone: '0100 000 0000', primaryColor: '#2563EB', receiptFooter: 'Thank you' },
      },
      actor,
    );
    check(created.readiness.overall === 'PASS', 'readiness PASS');
    check(created.ownerRole === 'admin', 'owner role is tenant admin');
    check(!created.apps.includes('booking'), 'supermarket does not install booking');
    const brand = await loadTenantBrandProfile(created.tenantId);
    check(brand?.displayName === 'DRVO-017 Market' && brand.primaryColor === '#2563EB', 'brand row written');

    console.log('Scenario 3 — first branch usable');
    const branch = await pool
      .request()
      .input('branchId', sql.Int, created.legacyBranchId)
      .query(`SELECT IsActive, LifecycleStatus, PublicBookingEnabled, ExternalNotificationsEnabled FROM dbo.TblBranch WHERE BranchID = @branchId;`);
    const b = branch.recordset[0];
    check(b.IsActive === true && b.LifecycleStatus === 'INTERNAL_LIVE', 'branch is active INTERNAL_LIVE');
    check(b.PublicBookingEnabled === false && b.ExternalNotificationsEnabled === false, 'public booking + notifications off');

    console.log('Scenario 4 — owner login path');
    const login = await pool
      .request()
      .input('loginName', SMOKE_TENANT.login)
      .input('password', SMOKE_TENANT.password)
      .query(`
        SELECT UserID, UserName, UserLevel FROM dbo.TblUser
        WHERE loginName = @loginName AND Password = @password AND ISNULL(isDeleted, 0) = 0;
      `);
    check(login.recordset.length === 1, 'owner credentials match');
    const owner = login.recordset[0] as { UserID: number; UserName: string; UserLevel: string };
    const defaultBranch = await resolveLoginDefaultBranch(owner.UserID);
    check(defaultBranch.branchId === created.legacyBranchId, 'owner default branch resolves');
    const ctx = await resolveStaffTenantContextForRequest({
      userId: owner.UserID,
      activeBranchId: defaultBranch.branchId,
      preferredTenantId: null,
    });
    check(ctx.tenantId.toLowerCase() === created.tenantId.toLowerCase(), 'owner tenant context resolves');
    const access = await getUserAccess(owner.UserID, owner.UserName, owner.UserLevel);
    check(access.roles.includes('admin') && !access.roles.includes('super_admin'), 'owner has admin, not super_admin');
    check(access.allowedPagePaths.length > 0, 'owner can see pages');

    console.log('Scenario 5 — user limit');
    const plan = await pool
      .request()
      .input('planCode', sql.NVarChar(64), created.planCode)
      .query(`SELECT MaxUsers FROM dbo.SaaSPlan WHERE PlanCode = @planCode;`);
    const maxUsers = plan.recordset[0]?.MaxUsers as number | null;
    check(maxUsers != null && maxUsers <= 25, `plan ${created.planCode} has a finite user limit (${maxUsers})`);
    for (let i = 1; i < maxUsers; i++) {
      const res = await createTenantStaffUser({
        tenantId: created.tenantId,
        userName: `DRVO017 Staff ${i}`,
        loginName: `${EXTRA_USER_PREFIX}${i}`,
        password: 'smoke-pass-change-me',
        userLevel: 'user',
        shiftId: 1,
      });
      if (!res.ok) throw new Error(`staff user ${i} failed: ${res.code}`);
    }
    check(true, `filled ${maxUsers}/${maxUsers} users`);
    await expectError(
      () =>
        createTenantStaffUser({
          tenantId: created.tenantId,
          userName: 'DRVO017 Over Limit',
          loginName: `${EXTRA_USER_PREFIX}over`,
          password: 'smoke-pass-change-me',
          userLevel: 'user',
          shiftId: 1,
        }),
      'USER_LIMIT_REACHED',
      'user over the plan limit is refused',
    );

    console.log('Scenario 6 — suspend blocks');
    await subs.transitionTenantSubscription(created.tenantId, 'suspend', { actor });
    gate.resetTenantAccessGate();
    await expectError(
      () => gate.assertTenantSubscriptionActive(created.tenantId),
      'SUBSCRIPTION_INACTIVE',
      'suspended tenant is blocked by the access gate',
    );

    console.log('Scenario 7 — reactivate restores');
    await subs.transitionTenantSubscription(created.tenantId, 'reactivate', { actor });
    gate.resetTenantAccessGate();
    const restored = await gate.assertTenantSubscriptionActive(created.tenantId);
    check(restored.allowed, 'reactivated tenant is allowed again');

    console.log('Scenario 8 — cleanup + CASHER_BOOT verify');
    await cleanupTenant(pool, SMOKE_TENANT.code);
    const residue = await pool
      .request()
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code LIKE N'DRVO017[_]%';`);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO017 residue');
    const baseline = await verifyPlatformBootstrap(pool);
    check(baseline.ok, `CASHER_BOOT bootstrap verify (${baseline.failures.join('; ') || 'clean'})`);

    console.log('DRVO-017 smoke PASS (first-sale proof pending DRVO-015)');
  } finally {
    try {
      await cleanupTenant(pool, SMOKE_TENANT.code);
    } catch {
      /* best effort */
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-017 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
