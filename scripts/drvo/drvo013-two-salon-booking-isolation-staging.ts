#!/usr/bin/env npx tsx
/**
 * DRVO Salon first-stage proof: two synthetic SALON Tenants, real SQL contact read.
 *
 * SAFETY:
 * - Only last132_agent / drvo_agent via 127.0.0.1:14330 staging tunnel.
 * - Never reads .env.local, no real customer phone, no public signup or live provider call.
 * - No schema changes. Creates two unique synthetic Tenants and Bookings; always purges both.
 * - A separate approved Owner/Staff browser and worker integration test is still required.
 */
import Module from 'module';
import crypto from 'node:crypto';
import sql from 'mssql';

const guarded = Module as unknown as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = guarded._load;
guarded._load = function guardServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return originalLoad.call(guarded, name, parent, isMain);
};

const DB = 'last132_agent';
const LOGIN = 'drvo_agent';
const HOST = '127.0.0.1';
const PORT = 14330;
const NONCE = crypto.randomBytes(6).toString('hex');
type SalonFixture = {
  tenantId: string;
  tenantCode: string;
  branchId: number;
  bookingId: number;
  clientId: number;
  phone: string;
};

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
  console.log('PASS: ' + label);
}

function stageConfig(): sql.config {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD; staging-only proof not started');
  if (process.env.DB_DATABASE === 'last132' || process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Production database setting detected; refusing to connect');
  }
  if (process.env.DRVO_STAGING_DB_SERVER && process.env.DRVO_STAGING_DB_SERVER !== HOST) {
    throw new Error('Use only a local, reviewed staging SSH tunnel');
  }
  if (process.env.DRVO_STAGING_DB_PORT && Number(process.env.DRVO_STAGING_DB_PORT) !== PORT) {
    throw new Error('Refusing non-staging SQL tunnel port');
  }
  Object.assign(process.env, {
    DB_SERVER: HOST, DB_PORT: String(PORT), DB_DATABASE: DB, DB_USER: LOGIN,
    DB_PASSWORD: password, DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: HOST, CLOUD_DB_PORT: String(PORT), CLOUD_DB_NAME: DB,
    CLOUD_DB_USER: LOGIN, CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  });
  return {
    server: HOST, port: PORT, database: DB, user: LOGIN, password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  };
}

async function assertStaging(pool: sql.ConnectionPool) {
  const r = await pool.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
  check(r.recordset[0]?.db === DB && String(r.recordset[0]?.login).toLowerCase() === LOGIN,
    'exact isolated last132_agent / drvo_agent (never last132)');
}

function futureDate(days: number): string {
  const date = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function syntheticEgyptPhone(): string {
  return '010' + String(crypto.randomInt(10_000_000, 99_999_999));
}

async function main() {
  const pool = await sql.connect(stageConfig());
  const toPurge: string[] = [];
  let failure: unknown;
  let cleanupFailure: unknown;
  try {
    await assertStaging(pool);
    // All application imports happen AFTER the fixed staging SQL identity is proven.
    const { parsePublicSignupInput, buildOnboardingRequest } =
      await import('../../src/platform/publicSignup/service');
    const { findIndustryPack } = await import('../../src/packs');
    const { onboardBusiness, defaultOnboardingDeps } =
      await import('../../src/platform/onboarding/wizard/coordinator');
    const { upsertCustomer, normalizePublicBookingPhone } =
      await import('../../src/lib/publicBookingHelpers');
    const { loadBookingCustomerContactForTenant } =
      await import('../../src/lib/booking/bookingCustomerContact');
    const tenantCtx = await import('../../src/platform/tenant/tenantContext');

    const actors = await pool.request().query(
      'SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0 ORDER BY UserID',
    );
    check(actors.recordset.length === 1, 'staging has an actor identifier; no existing user modified');
    const actorId = Number(actors.recordset[0].UserID);
    const actor = { actorUserId: actorId, actorUserName: 'drvo013-isolation-smoke' };

    async function createSalon(index: number): Promise<SalonFixture> {
      const phone = syntheticEgyptPhone();
      const input = parsePublicSignupInput({
        industry: 'salon', needs: ['booking'], startMode: 'demo',
        businessName: `DRVO013 Isolation QA ${NONCE} ${index}`,
        contactName: `Synthetic Owner ${index}`,
        phone, password: 'StagingOnlyPass123!',
      });
      const request = buildOnboardingRequest(input);
      request.subscription = { planCode: 'starter', status: 'active' };
      const tenantCode = request.business.tenantCode;
      check(/^DRVO_[A-F0-9]{10}$/.test(tenantCode), 'tenant is a generated synthetic DRVO tenant');
      const preexisting = await pool.request().input('code', sql.NVarChar(64), tenantCode)
        .query('SELECT COUNT(*) AS n FROM dbo.Tenant WHERE Code=@code');
      check(Number(preexisting.recordset[0].n) === 0, 'never overwrite or purge a preexisting tenant');
      // Record the previously absent identifier before the first write, for reliable cleanup
      // even if onboarding fails part way through its own transaction.
      toPurge.push(tenantCode);
      check(request.employees.length > 0, 'Salon pack includes a synthetic employee');
      const onboarding = await onboardBusiness(request, actor, defaultOnboardingDeps(findIndustryPack));
      check(onboarding.complete, 'synthetic Salon onboarding completed');
      const tenantId = String(onboarding.core.tenantId);
      const branch = await pool.request()
        .input('tid', sql.UniqueIdentifier, tenantId)
        .input('code', sql.NVarChar(64), onboarding.core.branchCode)
        .query(`
          SELECT l.LegacyBranchId AS branchId
          FROM dbo.Location l INNER JOIN dbo.Tenant t ON t.TenantId=l.TenantId
          WHERE l.TenantId=@tid AND l.BranchCode=@code
            AND l.Status=N'active' AND t.Status=N'active';
        `);
      check(branch.recordset.length === 1, 'Salon has one active tenant-owned Branch');
      const branchId = Number(branch.recordset[0].branchId);
      const employee = await pool.request().input('tid', sql.UniqueIdentifier, tenantId)
        .input('name', sql.NVarChar(200), request.employees[0].name)
        .query('SELECT EmpID FROM dbo.TblEmp WHERE TenantId=@tid AND EmpName=@name');
      check(employee.recordset.length === 1, 'employee belongs to the same TenantId');

      // Synthetic QA branches must never emit customer/provider messages.
      await pool.request().input('tid', sql.UniqueIdentifier, tenantId)
        .input('bid', sql.Int, branchId)
        .query(`
          UPDATE b SET ExternalNotificationsEnabled=0
          FROM dbo.TblBranch b
          INNER JOIN dbo.Location l ON l.LegacyBranchId=b.BranchID
          WHERE l.TenantId=@tid AND b.BranchID=@bid;
        `);
      const clientId = await upsertCustomer(`Synthetic QA Client ${index}`, phone, undefined, tenantId);
      const day = futureDate(index + 2);
      const startUtc = new Date(day + 'T09:00:00Z');
      const endUtc = new Date(day + 'T09:30:00Z');
      const code = `DRVO013-${NONCE}-${index}`;
      const persisted = await pool.request()
        .input('clientId', sql.Int, clientId)
        .input('empId', sql.Int, Number(employee.recordset[0].EmpID))
        .input('branchId', sql.Int, branchId)
        .input('workDate', sql.Date, day)
        .input('startTime', sql.VarChar(8), '11:00:00')
        .input('endTime', sql.VarChar(8), '11:30:00')
        .input('startUtc', sql.DateTime2, startUtc)
        .input('endUtc', sql.DateTime2, endUtc)
        .input('code', sql.NVarChar(40), code)
        .input('userId', sql.Int, actorId)
        .query(`
          INSERT INTO dbo.Bookings (
            ClientID, AssignedEmpID, BookingDate, StartTime, EndTime, Status, Source,
            BookingCode, CreatedByUserID, BranchID, PublicWorkDate, PublicDayOffset,
            AbsoluteStartUtc, AbsoluteEndUtc
          ) OUTPUT INSERTED.BookingID VALUES (
            @clientId, @empId, @workDate, @startTime, @endTime, N'confirmed', N'operations',
            @code, @userId, @branchId, @workDate, 0, @startUtc, @endUtc
          );
        `);
      const bookingId = Number(persisted.recordset[0]?.BookingID);
      check(Number.isSafeInteger(bookingId) && bookingId > 0, 'synthetic booking persisted');
      return { tenantId, tenantCode, branchId, clientId, bookingId, phone };
    }

    const a = await createSalon(1);
    const b = await createSalon(2);
    check(a.tenantId.toLowerCase() !== b.tenantId.toLowerCase(), 'two distinct synthetic Salon Tenants created');
    check(a.branchId !== b.branchId && a.clientId !== b.clientId && a.bookingId !== b.bookingId,
      'Branches, customers and bookings have distinct IDs');

    const ownA = await loadBookingCustomerContactForTenant(a.bookingId, a.tenantId);
    const ownB = await loadBookingCustomerContactForTenant(b.bookingId, b.tenantId);
    check(ownA?.bookingId === a.bookingId && ownA.branchId === a.branchId &&
      ownA.phone === normalizePublicBookingPhone(a.phone), 'Tenant A reads only its own synthetic booking contact');
    check(ownB?.bookingId === b.bookingId && ownB.branchId === b.branchId &&
      ownB.phone === normalizePublicBookingPhone(b.phone), 'Tenant B reads only its own synthetic booking contact');
    check(await loadBookingCustomerContactForTenant(b.bookingId, a.tenantId) === null,
      'Tenant A is denied Booking B before materializing customer PII');
    check(await loadBookingCustomerContactForTenant(a.bookingId, b.tenantId) === null,
      'Tenant B is denied Booking A before materializing customer PII');
    await tenantCtx.assertLegacyBranchInTenant(a.tenantId, a.branchId);
    await tenantCtx.assertLegacyBranchInTenant(b.tenantId, b.branchId);
    let denied = false;
    try { await tenantCtx.assertLegacyBranchInTenant(a.tenantId, b.branchId); }
    catch (err) { denied = (err as { code?: string }).code === 'LOCATION_NOT_IN_TENANT'; }
    check(denied, 'cross-Tenant Branch access fails closed');

    // Synthetic insert does NOT call the outbox processor or a WhatsApp provider. Prove no
    // booking delivery rows were scheduled for these two booking IDs by the fixture.
    const outbox = await pool.request()
      .input('a', sql.NVarChar(128), String(a.bookingId))
      .input('b', sql.NVarChar(128), String(b.bookingId))
      .query(`
        SELECT COUNT(*) AS n FROM dbo.PlatformOutbox
        WHERE AggregateType=N'booking' AND AggregateId IN (@a,@b)
          AND EventType IN (N'booking.created',N'booking.cancelled',N'booking.rescheduled')
      `);
    check(Number(outbox.recordset[0]?.n) === 0,
      'no provider-facing Booking outbox events created by synthetic fixture');

    // Deliberately no worker send call: mocked no-provider-send proof is mandatory PR CI.
    console.log('DRVO013_TWO_SALON_BOOKING_SQL_ISOLATION_PASS');
  } catch (err) {
    failure = err;
  } finally {
    // Exact connected DB identity is rechecked BEFORE any cleanup writes.
    try {
      await assertStaging(pool);
      const { purgeSmokeTenant } = await import('./smokeTenantPurge');
      for (const code of [...toPurge].reverse()) {
        await purgeSmokeTenant(pool, code);
        const r = await pool.request().input('code', sql.NVarChar(64), code)
          .query('SELECT COUNT(*) AS n FROM dbo.Tenant WHERE Code=@code');
        check(Number(r.recordset[0]?.n) === 0, 'synthetic Tenant cleaned completely');
      }
    } catch (err) {
      cleanupFailure = err;
    }
    await Promise.race([
      pool.close().catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, 10000)),
    ]);
  }
  if (cleanupFailure) throw cleanupFailure;
  if (failure) throw failure;
}

void main().then(
  () => { console.log('DRVO013_TWO_SALON_STAGING_EXIT_OK'); process.exit(0); },
  (err: unknown) => {
    console.error('DRVO013_TWO_SALON_STAGING_FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
