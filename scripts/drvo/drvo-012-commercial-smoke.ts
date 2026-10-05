#!/usr/bin/env npx tsx
/**
 * DRVO-012 staging smoke — last132_agent / drvo_agent only.
 *
 * Scenarios: CASHER_BOOT grandfathered + immutable, customized salon onboarding,
 * supermarket onboarding, unknown pack, dependencies, safe disable/reinstall,
 * subscription lifecycle (persisted + injected clock), plan change without app
 * changes, plan limits, cleanup.
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
const DAY = 24 * 60 * 60 * 1000;

const SMOKE_TENANTS = [
  { code: 'DRVO012_SALON', branch: 'DRVO012_SBR', login: 'drvo012_salon_owner' },
  { code: 'DRVO012_MARKET', branch: 'DRVO012_MBR', login: 'drvo012_market_owner' },
  { code: 'DRVO012_BADPACK', branch: 'DRVO012_XBR', login: 'drvo012_bad_owner' },
] as const;

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
        DELETE FROM dbo.TblUserBranchAccess WHERE UserID = @userId;
        DELETE FROM dbo.TblUser WHERE UserID = @userId;
      `);
    }
    for (const branchId of branchIds) {
      await new sql.Request(tx).input('branchId', sql.Int, branchId).query(`
        DELETE FROM dbo.QueueBookingSettings WHERE BranchID = @branchId;
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

async function cleanupAll(pool: sql.ConnectionPool) {
  for (const t of SMOKE_TENANTS) await cleanupTenant(pool, t.code);
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
  const apps = await import('../../src/platform/apps/tenantApps');
  const subs = await import('../../src/platform/commercial/subscriptionService');
  const { evaluateCommercialAccess } = await import('../../src/platform/commercial/commercialAccess');
  const { canCreateBranch, canCreateUser } = await import('../../src/platform/commercial/limits');
  const { getTenantSubscription } = await import('../../src/platform/commercial/planRepository');
  const { APP_REGISTRY_CODES } = await import('../../src/platform/registry/constants');
  const { SALON_PACK } = await import('../../src/packs/salon/public');
  const { SUPERMARKET_PACK } = await import('../../src/packs/supermarket/public');
  const { findIndustryPack } = await import('../../src/packs');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');
  const { verifyCommercialSubscriptionSchema } = await import(
    './migrations/009-commercial-subscription-tenant-apps'
  );

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);
    await cleanupAll(pool);

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo012-smoke' };

    console.log('Scenario 1 — migration verify + CASHER_BOOT grandfathered');
    const schema = await verifyCommercialSubscriptionSchema(pool);
    check(schema.ok, `migration 9 verify (${schema.failures.join('; ') || 'clean'})`);
    const boot = await pool
      .request()
      .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT';`);
    const bootId = String(boot.recordset[0].TenantId);
    const bootSub = await getTenantSubscription(pool, bootId);
    check(
      bootSub?.planCode === 'internal' && bootSub.status === 'active' && !bootSub.trialEndsAt,
      'CASHER_BOOT is internal/active with no trial clock',
    );
    const bootApps = apps.installedAppCodes(await apps.listTenantApps(bootId));
    check(
      APP_REGISTRY_CODES.every((c) => bootApps.includes(c)),
      'CASHER_BOOT keeps every registered app installed',
    );
    await expectError(
      () => subs.changeTenantPlan(bootId, 'starter', { actor }),
      'BOOTSTRAP_TENANT_PROTECTED',
      'CASHER_BOOT plan change is rejected',
    );
    await expectError(
      () => apps.uninstallTenantApp(bootId, 'pos', { actor, resolvePack: findIndustryPack }),
      'BOOTSTRAP_TENANT_PROTECTED',
      'CASHER_BOOT app uninstall is rejected',
    );

    console.log('Scenario 2 — salon minus queue plus inventory (starter trial)');
    const salonDef = SMOKE_TENANTS[0];
    const salon = await provisionTenant(
      {
        tenantCode: salonDef.code,
        tenantDisplayName: 'DRVO-012 Salon',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO012 Salon Owner',
        ownerLoginName: salonDef.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: salonDef.branch,
        firstBranchName: 'DRVO012 Salon Branch',
        industryPack: SALON_PACK,
        appCustomizations: { add: ['inventory'], remove: ['queue'] },
      },
      actor,
    );
    check(salon.readiness.overall === 'PASS', 'salon readiness PASS');
    check(salon.planCode === 'starter' && salon.subscriptionStatus === 'trial', 'salon on starter trial');
    check(!!salon.trialEndsAt, 'salon trial end recorded');
    check(salon.apps.includes('inventory') && !salon.apps.includes('queue'), 'salon customization applied');
    check(!salon.apps.includes('operations'), 'operations surface is not installed as an app');

    console.log('Scenario 3 — supermarket + unknown pack');
    const marketDef = SMOKE_TENANTS[1];
    const market = await provisionTenant(
      {
        tenantCode: marketDef.code,
        tenantDisplayName: 'DRVO-012 Market',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO012 Market Owner',
        ownerLoginName: marketDef.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: marketDef.branch,
        firstBranchName: 'DRVO012 Market Branch',
        industryPack: SUPERMARKET_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    check(market.readiness.overall === 'PASS', 'supermarket readiness PASS');
    check(market.industryPackCode === 'supermarket', 'supermarket pack recorded');
    check(!market.apps.includes('booking'), 'supermarket does not install booking');
    check(findIndustryPack('does-not-exist') === undefined, 'unknown pack is not resolvable');
    const badDef = SMOKE_TENANTS[2];
    await expectError(
      () =>
        provisionTenant(
          {
            tenantCode: badDef.code,
            tenantDisplayName: 'Bad',
            defaultTimezone: 'Africa/Cairo',
            ownerUserName: 'Bad',
            ownerLoginName: badDef.login,
            ownerPassword: 'x',
            firstBranchCode: badDef.branch,
            firstBranchName: 'Bad',
            industryPack: SALON_PACK,
            appCustomizations: { add: ['not-an-app'] },
          },
          actor,
        ),
      'UNKNOWN_APP',
      'unknown app in onboarding is rejected',
    );

    console.log('Scenario 4 — dependencies, safe disable, reinstall');
    await expectError(
      () => apps.installTenantApp(salon.tenantId, 'purchasing', { actor: actor }).then(async () => {
        await apps.uninstallTenantApp(salon.tenantId, 'inventory', { actor, resolvePack: findIndustryPack });
      }),
      'DEPENDENCY_IN_USE',
      'inventory cannot be disabled while purchasing is installed',
    );
    await apps.uninstallTenantApp(salon.tenantId, 'purchasing', { actor, resolvePack: findIndustryPack });
    const rowAfterDisable = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, salon.tenantId)
      .query(
        `SELECT Status, Enabled FROM dbo.TenantAppEntitlement WHERE TenantId = @tenantId AND AppCode = N'purchasing';`,
      );
    check(
      rowAfterDisable.recordset[0]?.Status === 'disabled' && rowAfterDisable.recordset[0]?.Enabled === false,
      'disable keeps the entitlement row (no delete)',
    );
    const reinstall = await apps.installTenantApp(salon.tenantId, 'purchasing', { actor });
    check(reinstall.outcome === 'reinstalled', 'reinstall restores the existing row');
    await expectError(
      () => apps.uninstallTenantApp(salon.tenantId, 'booking', { actor, resolvePack: findIndustryPack }),
      'REQUIRED_BY_PACK',
      'pack-required booking cannot be disabled',
    );

    console.log('Scenario 5 — limits on starter');
    const branchDecision = await canCreateBranch(salon.tenantId);
    check(!branchDecision.allowed && branchDecision.reason === 'LIMIT_REACHED', 'starter blocks a second branch');
    const userDecision = await canCreateUser(salon.tenantId);
    check(userDecision.allowed, 'starter allows a second user (1 of 5 used)');

    console.log('Scenario 6 — plan change keeps apps');
    const appsBefore = apps.installedAppCodes(await apps.listTenantApps(salon.tenantId)).sort();
    const upgraded = await subs.changeTenantPlan(salon.tenantId, 'growth', { actor });
    check(upgraded.planCode === 'growth', 'starter -> growth applied');
    const appsAfter = apps.installedAppCodes(await apps.listTenantApps(salon.tenantId)).sort();
    check(JSON.stringify(appsBefore) === JSON.stringify(appsAfter), 'installed apps unchanged by plan change');
    check((await canCreateBranch(salon.tenantId)).allowed, 'growth allows a second branch');

    console.log('Scenario 7 — subscription lifecycle');
    const now = new Date();
    const trialAccess = await evaluateCommercialAccess(salon.tenantId, { now });
    check(trialAccess.subscription.allowed && trialAccess.subscription.status === 'trial', 'trial allowed');
    const expired = await evaluateCommercialAccess(salon.tenantId, { now: new Date(now.getTime() + 15 * DAY) });
    check(
      !expired.subscription.allowed && expired.subscription.reason === 'TRIAL_EXPIRED',
      'trial blocked after TrialEndsAt (injected clock)',
    );
    await subs.transitionTenantSubscription(salon.tenantId, 'activate', { actor });
    await subs.transitionTenantSubscription(salon.tenantId, 'mark_past_due', { actor });
    const inGrace = await evaluateCommercialAccess(salon.tenantId, { now: new Date(now.getTime() + DAY) });
    check(inGrace.subscription.allowed && !!inGrace.subscription.warning, 'past_due allowed with warning in grace');
    const pastGrace = await evaluateCommercialAccess(salon.tenantId, { now: new Date(now.getTime() + 8 * DAY) });
    check(!pastGrace.subscription.allowed, 'past_due blocked after grace');
    await subs.transitionTenantSubscription(salon.tenantId, 'suspend', { actor });
    check(!(await evaluateCommercialAccess(salon.tenantId)).subscription.allowed, 'suspended blocked');
    await subs.transitionTenantSubscription(salon.tenantId, 'reactivate', {
      actor,
      currentPeriodEndsAt: new Date(now.getTime() + 30 * DAY),
    });
    await subs.transitionTenantSubscription(salon.tenantId, 'cancel', { actor });
    const cancelled = await evaluateCommercialAccess(salon.tenantId, { now });
    check(
      cancelled.subscription.allowed && cancelled.subscription.reason === 'CANCELLED_UNTIL_PERIOD_END',
      'cancelled allowed until paid period end',
    );
    const cancelledLater = await evaluateCommercialAccess(salon.tenantId, {
      now: new Date(now.getTime() + 31 * DAY),
    });
    check(!cancelledLater.subscription.allowed, 'cancelled blocked after paid period');
    await expectError(
      () => subs.transitionTenantSubscription(salon.tenantId, 'mark_past_due', { actor }),
      'INVALID_TRANSITION',
      'cancelled -> past_due rejected',
    );

    console.log('Scenario 8 — cleanup + CASHER_BOOT verify');
    await cleanupAll(pool);
    const residue = await pool
      .request()
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code LIKE N'DRVO012[_]%';`);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO012 residue');
    const baseline = await verifyPlatformBootstrap(pool);
    check(baseline.ok, `CASHER_BOOT bootstrap verify (${baseline.failures.join('; ') || 'clean'})`);
    const schemaAfter = await verifyCommercialSubscriptionSchema(pool);
    check(schemaAfter.ok, 'migration 9 verify after cleanup');

    console.log('DRVO-012 smoke PASS');
  } finally {
    try {
      await cleanupAll(pool);
    } catch {
      /* best effort */
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-012 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
