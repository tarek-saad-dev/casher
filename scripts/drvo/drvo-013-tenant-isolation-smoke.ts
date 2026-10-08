#!/usr/bin/env npx tsx
/**
 * DRVO-013 staging smoke — last132_agent / drvo_agent only.
 *
 * Two synthetic tenants (salon + supermarket) prove, against the real schema:
 * canonical resolver, cross-tenant branch/user/location denial, public tenant derivation,
 * per-tenant app gates, tenant-scoped applocks (concurrent, same parts), PlatformOutbox
 * claim/dispatch preserving TenantId, CASHER_BOOT bootstrap unchanged, full cleanup.
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
const SMOKE_EVENT = 'drvo013.smoke';

const SMOKE_TENANTS = [
  { code: 'DRVO013_A', branch: 'DRVO013_ABR', login: 'drvo013_a_owner' },
  { code: 'DRVO013_B', branch: 'DRVO013_BBR', login: 'drvo013_b_owner' },
] as const;

function forceStagingEnv(password: string) {
  const server = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: server,
    CLOUD_DB_PORT: port,
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: server,
    DB_PORT: port,
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
  const tenantCtx = await import('../../src/platform/tenant/tenantContext');
  const { resolveLegacyBootstrapTenantId } = await import('../../src/platform/tenant/legacyBootstrapSeam');
  const { acquireTenantApplock, TenantLockTimeoutError } = await import('../../src/platform/tenant/tenantApplock');
  const gate = await import('../../src/platform/commercial/tenantAccessGate');
  const { claimPlatformOutboxBatch, processPlatformOutboxTick } = await import(
    '../../src/platform/outbox/consumer'
  );
  const { SALON_PACK } = await import('../../src/packs/salon/public');
  const { SUPERMARKET_PACK } = await import('../../src/packs/supermarket/public');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);

    // Rollout preflight: authoritative TenantContext fails closed for any CASHER_BOOT user or
    // branch lacking TenantMembership / Location, so those rows must be reconciled first.
    const preflight = await verifyPlatformBootstrap(pool);
    if (!preflight.ok) {
      throw new Error(
        `Preflight failed — run the platform bootstrap reconcile before DRVO-013: ${preflight.failures.join('; ')}`,
      );
    }
    console.log('PASS: preflight — every CASHER_BOOT user has a membership and every branch a Location');

    await cleanupAll(pool);

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo013-smoke' };

    console.log('Scenario 1 — provision two synthetic tenants');
    const [defA, defB] = SMOKE_TENANTS;
    const a = await provisionTenant(
      {
        tenantCode: defA.code,
        tenantDisplayName: 'DRVO-013 Tenant A',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO013 A Owner',
        ownerLoginName: defA.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: defA.branch,
        firstBranchName: 'DRVO013 A Branch',
        industryPack: SALON_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    const b = await provisionTenant(
      {
        tenantCode: defB.code,
        tenantDisplayName: 'DRVO-013 Tenant B',
        defaultTimezone: 'Asia/Riyadh',
        ownerUserName: 'DRVO013 B Owner',
        ownerLoginName: defB.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: defB.branch,
        firstBranchName: 'DRVO013 B Branch',
        industryPack: SUPERMARKET_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    const A = a.tenantId.toLowerCase();
    const B = b.tenantId.toLowerCase();
    check(A !== B, 'two distinct tenants provisioned');

    console.log('Scenario 2 — canonical resolver');
    check(
      (await tenantCtx.resolveUserTenantMembership({ userId: a.legacyUserId })).tenantId === A,
      'owner A resolves to tenant A',
    );
    check(
      (await tenantCtx.resolveUserTenantMembership({ userId: b.legacyUserId })).tenantId === B,
      'owner B resolves to tenant B',
    );
    await expectError(
      () => tenantCtx.resolveUserTenantMembership({ userId: a.legacyUserId, preferredTenantId: B }),
      'TENANT_MEMBERSHIP_MISMATCH',
      'owner A cannot claim tenant B',
    );
    const staffA = await tenantCtx.resolveStaffTenantContextForRequest({
      userId: a.legacyUserId,
      activeBranchId: a.legacyBranchId,
    });
    check(staffA.activeLocation.locationId.toLowerCase() === a.locationId.toLowerCase(), 'staff A context on A location');

    console.log('Scenario 3 — cross-tenant branch / user / location');
    await expectError(
      () => tenantCtx.resolveStaffTenantContextForRequest({ userId: a.legacyUserId, activeBranchId: b.legacyBranchId }),
      'LOCATION_NOT_IN_TENANT',
      'owner A cannot activate branch B',
    );
    await expectError(
      () => tenantCtx.assertLegacyBranchInTenant(A, b.legacyBranchId),
      'LOCATION_NOT_IN_TENANT',
      'tenant A cannot address branch B',
    );
    await expectError(
      () => tenantCtx.assertLegacyUserInTenant(B, a.legacyUserId),
      'USER_NOT_IN_TENANT',
      'tenant B cannot address user A',
    );
    const branchesA = await tenantCtx.listTenantLegacyBranchIds(A);
    const branchesB = await tenantCtx.listTenantLegacyBranchIds(B);
    check(branchesA.has(a.legacyBranchId) && !branchesA.has(b.legacyBranchId), 'tenant A branch list excludes B');
    check(branchesB.has(b.legacyBranchId) && !branchesB.has(a.legacyBranchId), 'tenant B branch list excludes A');

    console.log('Scenario 4 — public tenant derivation');
    check(
      (await tenantCtx.resolvePublicTenantContext({ branchCode: a.branchCode })).tenantId === A,
      'public branch code A derives tenant A',
    );
    check(
      (await tenantCtx.resolvePublicTenantContext({ branchCode: b.branchCode })).tenantId === B,
      'public branch code B derives tenant B',
    );
    await expectError(
      () => tenantCtx.resolvePublicTenantContext({ branchCode: 'DRVO013_NOPE' }),
      'TENANT_CONTEXT_UNRESOLVED',
      'unknown public branch resolves no tenant',
    );

    console.log('Scenario 5 — DRVO-012 gates via the authoritative tenant');
    gate.resetTenantAccessGate();
    await gate.assertTenantSubscriptionActive(A);
    await gate.assertTenantSubscriptionActive(B);
    check(true, 'both subscriptions active through their own tenant');
    await gate.assertTenantAppInstalled(A, 'booking');
    check(true, 'salon tenant A has booking');
    await expectError(
      () => gate.assertTenantAppInstalled(B, 'booking'),
      'APP_NOT_INSTALLED',
      'supermarket tenant B is denied booking',
    );
    check(
      (await gate.assertRouteAppEntitlement(A, '/api/bookings/estimate')) === 'booking',
      'booking route family passes for tenant A',
    );
    await expectError(
      () => gate.assertRouteAppEntitlement(B, '/api/operations/bookings/1/arrive'),
      'APP_NOT_INSTALLED',
      'booking route family denied for tenant B',
    );
    check((await gate.assertRouteAppEntitlement(B, '/api/day')) === null, 'core routes are not app-gated');
    check(
      !(await gate.isAppInstalledForBranchTenant(a.legacyBranchId, 'loyalty')),
      'Loyalty stays off for a generic tenant (POS earn fail-closed)',
    );

    console.log('Scenario 5b — system jobs fan out tenant by tenant');
    const { listTenantJobTargets } = await import('../../src/platform/tenant/tenantJobFanout');
    const fanout = await listTenantJobTargets({ scope: { kind: 'all_tenants' }, app: 'booking' });
    const targetA = fanout.targets.find((t) => t.tenantId.toLowerCase() === A);
    check(
      targetA && targetA.branchIds.includes(a.legacyBranchId) && !targetA.branchIds.includes(b.legacyBranchId),
      'cron fan-out gives tenant A only its own branches',
    );
    check(
      fanout.skipped.some((s) => s.tenantId.toLowerCase() === B && s.reason === 'APP_NOT_INSTALLED'),
      'cron fan-out skips tenant B for an app it lacks',
    );
    const sessionScope = await listTenantJobTargets({ scope: { kind: 'single_tenant', tenantId: B } });
    check(
      sessionScope.targets.length === 1 &&
        sessionScope.targets[0].tenantId.toLowerCase() === B &&
        sessionScope.targets[0].branchIds.every((id) => id === b.legacyBranchId),
      'session-triggered job is limited to the caller tenant',
    );

    console.log('Scenario 6 — tenant-scoped applocks');
    const txA = new sql.Transaction(pool);
    const txB = new sql.Transaction(pool);
    await txA.begin();
    await txB.begin();
    try {
      const resA = await acquireTenantApplock(txA, A.toUpperCase(), ['drvo013', 'same-resource'], 2000);
      const resB = await acquireTenantApplock(txB, B, ['drvo013', 'same-resource'], 2000);
      check(resA !== resB && resA === `t:${A}:drvo013:same-resource`, 'same parts lock independently per tenant');
      const txA2 = new sql.Transaction(pool);
      await txA2.begin();
      try {
        let blocked = false;
        try {
          await acquireTenantApplock(txA2, A, ['drvo013', 'same-resource'], 200);
        } catch (err) {
          blocked = err instanceof TenantLockTimeoutError;
        }
        check(blocked, 'a second holder in the same tenant (any id casing) blocks');
      } finally {
        await txA2.rollback().catch(() => undefined);
      }
    } finally {
      await txA.rollback().catch(() => undefined);
      await txB.rollback().catch(() => undefined);
    }

    console.log('Scenario 7 — PlatformOutbox preserves TenantId');
    for (const [tenantId, n] of [[A, 2], [B, 1]] as const) {
      for (let i = 0; i < n; i++) {
        await pool
          .request()
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .input('eventType', sql.NVarChar(128), SMOKE_EVENT)
          .input('agg', sql.NVarChar(128), `drvo013-${tenantId}-${i}`).query(`
            INSERT INTO dbo.PlatformOutbox (
              TenantId, AggregateType, AggregateId, EventType, Payload,
              IdempotencyKey, CorrelationId, OccurredAt, Status, Attempts
            ) VALUES (
              @tenantId, N'drvo013', @agg, @eventType, N'{}', NULL, NULL, SYSUTCDATETIME(), N'pending', 0
            );
          `);
      }
    }
    const claimedB = await claimPlatformOutboxBatch({ batchSize: 50, tenantId: B, eventTypes: [SMOKE_EVENT] }, pool);
    check(claimedB.length === 1 && claimedB.every((r) => r.tenantId === B), 'tenant-scoped claim returns only B rows');
    await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, B)
      .query(`UPDATE dbo.PlatformOutbox SET Status = N'pending' WHERE TenantId = @tenantId AND Status = N'delivering';`);
    const seen: Array<{ rowTenant: string; ctxTenant: string }> = [];
    const summary = await processPlatformOutboxTick(
      async ({ row, tenant }) => {
        seen.push({ rowTenant: row.tenantId, ctxTenant: tenant.tenantId });
      },
      { batchSize: 50, eventTypes: [SMOKE_EVENT], source: 'drvo013-smoke' },
      pool,
    );
    check(summary.delivered === 3 && seen.length === 3, 'all smoke events delivered');
    check(seen.every((s) => s.rowTenant === s.ctxTenant), 'every handler context carries its row TenantId');
    check(seen.filter((s) => s.ctxTenant === A).length === 2, 'two events dispatched for A, one for B');

    console.log('Scenario 8 — CASHER_BOOT seams + cleanup');
    const boot = await resolveLegacyBootstrapTenantId('casher-boot-staging-smoke');
    check(boot !== A && boot !== B, 'CASHER_BOOT seam resolves CASHER_BOOT, not a synthetic tenant');
    await cleanupAll(pool);
    const residue = await pool
      .request()
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code LIKE N'DRVO013[_]%';`);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO013 residue');
    const baseline = await verifyPlatformBootstrap(pool);
    check(baseline.ok, `CASHER_BOOT bootstrap verify (${baseline.failures.join('; ') || 'clean'})`);

    console.log('DRVO-013 smoke PASS');
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
  console.error('DRVO-013 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
