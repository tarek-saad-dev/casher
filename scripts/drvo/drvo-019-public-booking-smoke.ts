#!/usr/bin/env npx tsx
/**
 * DRVO-019 staging smoke — last132_agent / drvo_agent only.
 *
 * Proves two-tenant public booking isolation against real SQL:
 *  1. CASHER_BOOT (GLEEM) and a provisioned salon tenant resolve to different tenants by branchCode.
 *  2. Without branchCode only CUT-compatible requests fall back to CASHER_BOOT; the other
 *     tenant's origin gets BRANCH_REQUIRED.
 *  3. A branch is never served under another tenant (expectedTenantId mismatch → BRANCH_NOT_FOUND).
 *  4. Catalogue, barbers and upcoming-by-phone for the salon tenant contain nothing of CASHER_BOOT.
 *  5. CORS origins are per tenant.
 *  6. A tenant without the booking app (supermarket) is answered like an unknown branch.
 *  7. Cleanup + CASHER_BOOT bootstrap verify.
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

const CUT_BRANCH = 'GLEEM';
const SALON = {
  code: 'DRVO019_SALON',
  branch: 'DRVO019_SBR',
  login: 'drvo019_salon_owner',
  origin: 'https://drvo019-salon.example',
} as const;
const MARKET = {
  code: 'DRVO019_MARKET',
  branch: 'DRVO019_MBR',
  login: 'drvo019_market_owner',
} as const;

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

function publicRequest(origin: string | null): Request {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new Request('https://booking.invalid/api/public/booking/barbers', { headers });
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

/** Smoke-only: open the provisioned branch to public booking (onboarding keeps it internal). */
async function makeBranchPublic(pool: sql.ConnectionPool, branchId: number): Promise<void> {
  await pool.request().input('branchId', sql.Int, branchId).query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus = N'PUBLIC_LIVE', PublicBookingEnabled = 1
    WHERE BranchID = @branchId;
    IF EXISTS (SELECT 1 FROM dbo.QueueBookingSettings WHERE BranchID = @branchId)
      UPDATE dbo.QueueBookingSettings SET BookingEnabled = 1 WHERE BranchID = @branchId;
  `);
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
  const gate = await import('../../src/platform/commercial/tenantAccessGate');
  const tenancy = await import('../../src/lib/booking/publicBookingTenancy');
  const branchCtx = await import('../../src/lib/booking/publicBookingBranchContext');
  const { getPublicBookingServicesCatalog } = await import('../../src/lib/booking/publicBookingServices');
  const { listPublicBookingBarbers } = await import('../../src/lib/booking/publicBookingBarbers');
  const { listPublicUpcomingBookings } = await import('../../src/lib/booking/publicBookingReader');
  const { SALON_PACK } = await import('../../src/packs/salon/public');
  const { SUPERMARKET_PACK } = await import('../../src/packs/supermarket/public');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');

  const resetCaches = () => {
    gate.resetTenantAccessGate();
    tenancy.invalidatePublicBookingTenancyCache();
  };

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);
    await cleanupTenant(pool, SALON.code);
    await cleanupTenant(pool, MARKET.code);

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo019-smoke' };

    console.log('Setup — salon tenant (booking) + supermarket tenant (no booking)');
    const salon = await provisionTenant(
      {
        tenantCode: SALON.code,
        tenantDisplayName: 'DRVO-019 Salon',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO019 Salon Owner',
        ownerLoginName: SALON.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: SALON.branch,
        firstBranchName: 'DRVO019 Salon Branch',
        industryPack: SALON_PACK,
        subscriptionStatus: 'active',
        brand: { primaryColor: '#7C3AED', publicBookingOrigins: [SALON.origin] },
      },
      actor,
    );
    check(salon.apps.includes('booking'), 'salon tenant has the booking app');
    const market = await provisionTenant(
      {
        tenantCode: MARKET.code,
        tenantDisplayName: 'DRVO-019 Market',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'DRVO019 Market Owner',
        ownerLoginName: MARKET.login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: MARKET.branch,
        firstBranchName: 'DRVO019 Market Branch',
        industryPack: SUPERMARKET_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    check(!market.apps.includes('booking'), 'supermarket tenant has no booking app');
    await makeBranchPublic(pool, salon.legacyBranchId);
    await makeBranchPublic(pool, market.legacyBranchId);
    resetCaches();

    console.log('Scenario 1 — branchCode decides the tenant');
    const cut = await tenancy.resolvePublicBookingTenancy(publicRequest(null), {
      branchCode: CUT_BRANCH,
      route: 'drvo019-smoke',
    });
    check(cut.ok, `${CUT_BRANCH} resolves`);
    const salonT = await tenancy.resolvePublicBookingTenancy(publicRequest(SALON.origin), {
      branchCode: SALON.branch,
      route: 'drvo019-smoke',
    });
    check(salonT.ok, `${SALON.branch} resolves`);
    check(
      salonT.tenancy.tenantId.toLowerCase() === salon.tenantId.toLowerCase(),
      'salon branch resolves to the salon tenant',
    );
    check(
      cut.tenancy.tenantId.toLowerCase() !== salonT.tenancy.tenantId.toLowerCase(),
      'the two tenants are distinct',
    );

    console.log('Scenario 2 — CUT compatibility fallback is origin-bound');
    const compat = await tenancy.resolvePublicBookingTenancy(publicRequest(null), {
      branchCode: null,
      route: 'drvo019-smoke',
      allowCutCompat: true,
    });
    check(compat.ok && compat.tenancy.source === 'cut-compat', 'branch-less CUT request uses cut-compat');
    check(
      compat.ok && compat.tenancy.tenantId.toLowerCase() === cut.tenancy.tenantId.toLowerCase(),
      'cut-compat resolves to the GLEEM tenant',
    );
    const foreign = await tenancy.resolvePublicBookingTenancy(publicRequest(SALON.origin), {
      branchCode: null,
      route: 'drvo019-smoke',
      allowCutCompat: true,
    });
    check(!foreign.ok && foreign.code === 'BRANCH_REQUIRED', 'salon origin without branchCode is refused');

    console.log('Scenario 3 — no cross-tenant branch context');
    await expectError(
      () =>
        branchCtx.resolvePublicBookingBranchContext({
          branchCode: SALON.branch,
          purpose: 'public_booking',
          expectedTenantId: cut.tenancy.tenantId,
        }),
      'BRANCH_NOT_FOUND',
      'salon branch under the CUT tenant is BRANCH_NOT_FOUND',
    );
    const salonCtx = await branchCtx.resolvePublicBookingBranchContext({
      branchCode: SALON.branch,
      purpose: 'public_booking',
      expectedTenantId: salon.tenantId,
    });
    check(salonCtx.tenantId.toLowerCase() === salon.tenantId.toLowerCase(), 'salon branch context carries its tenant');

    console.log('Scenario 4 — catalogue / barbers / upcoming isolation');
    const cutCtx = await branchCtx.resolvePublicBookingBranchContext({
      branchCode: CUT_BRANCH,
      purpose: 'public_booking',
      expectedTenantId: cut.tenancy.tenantId,
    });
    const cutCatalog = await getPublicBookingServicesCatalog(cutCtx);
    const salonCatalog = await getPublicBookingServicesCatalog(salonCtx);
    const cutServiceIds = new Set(cutCatalog.services.map((s) => s.serviceId));
    check(
      salonCatalog.services.every((s) => !cutServiceIds.has(s.serviceId)),
      `salon catalogue has no CUT services (cut=${cutCatalog.services.length}, salon=${salonCatalog.services.length})`,
    );
    const cutBarbers = await listPublicBookingBarbers({ tenantId: cut.tenancy.tenantId, mode: 'global' });
    const salonBarbers = await listPublicBookingBarbers({
      tenantId: salon.tenantId,
      mode: 'branch',
      branchCode: SALON.branch,
    });
    const cutEmpIds = new Set(cutBarbers.barbers.map((b) => b.empId));
    check(
      salonBarbers.barbers.every((b) => !cutEmpIds.has(b.empId)),
      `salon barbers contain no CUT employees (cut=${cutBarbers.barbers.length}, salon=${salonBarbers.barbers.length})`,
    );
    const cutPhoneRow = await pool.request().query(`
      SELECT TOP 1 c.Mobile
      FROM dbo.Bookings b INNER JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      WHERE c.Mobile IS NOT NULL AND LEN(c.Mobile) >= 10
      ORDER BY b.BookingID DESC;
    `);
    const cutPhone = cutPhoneRow.recordset[0]?.Mobile as string | undefined;
    if (cutPhone) {
      const salonUpcoming = await listPublicUpcomingBookings({ tenantId: salon.tenantId, phone: cutPhone });
      check(salonUpcoming.bookings.length === 0, 'a CUT customer phone lists nothing under the salon tenant');
    } else {
      console.log('  skip: no CUT customer phone available for the upcoming check');
    }

    console.log('Scenario 5 — per-tenant CORS origins');
    const salonOrigins = await tenancy.loadPublicBookingTenantOrigins(salon.tenantId);
    check(salonOrigins.includes(SALON.origin), 'salon origin allowed for the salon tenant');
    const cutOrigins = await tenancy.loadPublicBookingTenantOrigins(cut.tenancy.tenantId);
    check(!cutOrigins.includes(SALON.origin), 'salon origin not allowed for the CUT tenant');

    console.log('Scenario 6 — booking app not installed → not found');
    const marketT = await tenancy.resolvePublicBookingTenancy(publicRequest(null), {
      branchCode: MARKET.branch,
      route: 'drvo019-smoke',
    });
    check(!marketT.ok && marketT.code === 'BRANCH_NOT_FOUND', 'supermarket branch is BRANCH_NOT_FOUND');

    console.log('Scenario 7 — cleanup + CASHER_BOOT verify');
    await cleanupTenant(pool, SALON.code);
    await cleanupTenant(pool, MARKET.code);
    const residue = await pool
      .request()
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code LIKE N'DRVO019[_]%';`);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO019 residue');
    const baseline = await verifyPlatformBootstrap(pool);
    check(baseline.ok, `CASHER_BOOT bootstrap verify (${baseline.failures.join('; ') || 'clean'})`);

    console.log('DRVO-019 smoke PASS');
  } finally {
    for (const code of [SALON.code, MARKET.code]) {
      try {
        await cleanupTenant(pool, code);
      } catch {
        /* best effort */
      }
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-019 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
