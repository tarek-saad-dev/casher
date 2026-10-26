#!/usr/bin/env npx tsx
/**
 * Salon Queue acceptance: disposable tenant → authenticated walk-in API →
 * staff status workflow → SQL verification → full tenant cleanup.
 * Run ONLY on last132_agent as drvo_agent, through dedicated staging tunnel.
 * No .env.local, no external messages, no CUT writes, no production access.
 */
import Module from 'module';
import crypto from 'node:crypto';
import sql from 'mssql';
import { spawn, type ChildProcess } from 'node:child_process';

const loader = Module as unknown as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function guardedServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return originalLoad.call(loader, name, parent, isMain);
};

const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';
const SMOKE_PHONE = '010' + String(crypto.randomInt(10000000, 99999999));
const RUN_ID = 'SALON-QUEUE-' + crypto.randomBytes(6).toString('hex');
const BASE_URL = 'http://127.0.0.1:5518';

function check(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description);
  console.log('PASS: ' + description);
}

function forceStagingConfig() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD; refusing to run');
  if (process.env.DB_DATABASE === 'last132' || process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Production database environment detected; refusing to run');
  }
  const host = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  Object.assign(process.env, {
    DB_SERVER: host, DB_PORT: port, DB_DATABASE: EXPECTED_DB, DB_USER: EXPECTED_LOGIN,
    DB_PASSWORD: password, DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: host, CLOUD_DB_PORT: port, CLOUD_DB_NAME: EXPECTED_DB,
    CLOUD_DB_USER: EXPECTED_LOGIN, CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  });
  return {
    server: host, port: Number(port), database: EXPECTED_DB,
    user: EXPECTED_LOGIN, password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  } satisfies sql.config;
}

async function assertStaging(pool: sql.ConnectionPool) {
  const result = await pool.request().query("SELECT DB_NAME() AS databaseName, SUSER_SNAME() AS loginName");
  const identity = result.recordset[0];
  check(identity?.databaseName === EXPECTED_DB, 'Connected to last132_agent only');
  check(String(identity?.loginName).toLowerCase() === EXPECTED_LOGIN, 'Using drvo_agent only');
}

function futureDate(days: number): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Libraries used by the booking stack may keep pooled SQL requests/handles alive
 * after the complete staging proof. Closing is best-effort only AFTER tenant
 * cleanup has been verified; do not hang the job just to drain test connections.
 */
async function closeSmokePool(pool: sql.ConnectionPool, maxWaitMs = 12_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SQL pool close deadline exceeded')), maxWaitMs);
      }),
    ]);
    console.log('PASS: Smoke SQL pool closed');
  } catch (err) {
    console.warn(
      'WARN: Test SQL pool did not close cleanly after cleanup:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const config = forceStagingConfig();
  const pool = await sql.connect(config);
  let tenantCode: string | null = null;
  let queueTicketId: number | null = null;
  let app: ChildProcess | null = null;
  try {
    await assertStaging(pool);
    // Dynamic imports happen after staging-only environment and DB identity checks.
    const { parsePublicSignupInput, buildOnboardingRequest } = await import('../../src/platform/publicSignup/service');
    const { findIndustryPack } = await import('../../src/packs');
    const { onboardBusiness, defaultOnboardingDeps } = await import('../../src/platform/onboarding/wizard/coordinator');
    const { saveEmployeeBranchWeeklySchedule } = await import('../../src/lib/hr/employeeBranchScheduleSave');

    // Exercise the real authenticated HTTP queue routes, not synthetic SQL insertions.

    const input = parsePublicSignupInput({
      industry: 'salon', needs: ['booking'], contactName: 'Salon QA Owner',
      businessName: 'DRVO Salon Queue Acceptance', phone: SMOKE_PHONE,
      password: 'StagingOnlyPass123!', startMode: 'demo',
    });
    const req = buildOnboardingRequest(input);
    tenantCode = req.business.tenantCode;
    check(req.branches[0].branchName !== 'الفرع الرئيسي', 'Branch name is signup-specific');
    check(req.services.length > 0 && req.employees.length > 0, 'Salon demo includes services and barbers');
    req.subscription = { planCode: 'starter', status: 'active' };
    const actors = await pool.request().query("SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0 ORDER BY UserID");
    check(actors.recordset.length === 1, 'Onboarding actor exists in staging');
    const actor = { actorUserId: Number(actors.recordset[0].UserID), actorUserName: 'salon-queue-staging' };
    const onboarding = await onboardBusiness(req, actor, defaultOnboardingDeps(findIndustryPack));
    check(onboarding.complete, 'Tenant onboarding stages completed');
    const tenantId = onboarding.core.tenantId;
    const branchCode = onboarding.core.branchCode;
    // Resolve the new branch through its tenant-owned Location.
    const owned = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('branchCode', sql.NVarChar(30), branchCode).query(`SELECT LegacyBranchId AS branchId FROM dbo.Location WHERE TenantId=@tenantId AND BranchCode=@branchCode`);
    check(owned.recordset.length === 1, 'New branch is owned by the fresh tenant');
    const branchId = Number(owned.recordset[0].branchId);
    const staff = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('name', sql.NVarChar(200), req.employees[0].name)
      .query("SELECT EmpID FROM dbo.TblEmp WHERE TenantId=@tenantId AND EmpName=@name");
    check(staff.recordset.length === 1, 'New barber belongs to the tenant');
    const empId = Number(staff.recordset[0].EmpID);

    // One controlled staging test roster. Payroll validation is outside booking scope.
    await saveEmployeeBranchWeeklySchedule({
      empId, branchId, effectiveFrom: futureDate(0), skipPayrollCheck: true,
      cells: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek, isWorking: true, startTime: '00:00', endTime: '23:59', canReceiveBookings: true,
      })),
    });

    // Synthetic business open all day: smoke is independent of Cairo's current hour.
    await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('branchId', sql.Int, branchId).query(`
        UPDATE b SET DefaultOpenTime=CAST('00:00' AS TIME), DefaultCloseTime=CAST('23:59' AS TIME)
        FROM dbo.TblBranch b
        JOIN dbo.Location l ON l.LegacyBranchId=b.BranchID AND l.TenantId=@tenantId
        WHERE b.BranchID=@branchId;
        UPDATE dbo.QueueBookingSettings SET DefaultServiceMinutes=45, QueuePrefix=N'Q'
        WHERE BranchID=@branchId;
      `);
    check((await pool.request().input('branchId', sql.Int, branchId)
      .query('SELECT DefaultServiceMinutes FROM dbo.QueueBookingSettings WHERE BranchID=@branchId'))
      .recordset[0]?.DefaultServiceMinutes === 45, 'Fresh branch has a distinct 45-minute queue default');

    app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack',
      '--hostname', '127.0.0.1', '--port', '5518'], {
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Bound diagnostic log output; never print session cookies, DB password, or login secrets.
    let appError = '';
    app.stderr?.on('data', (chunk: Buffer) => {
      appError = (appError + chunk.toString('utf8')).slice(-1200);
    });
    app.stdout?.on('data', () => {});
    const withTimeout = async (uri: string, options?: RequestInit) =>
      fetch(BASE_URL + uri, { ...options, signal: AbortSignal.timeout(120_000) });
    let serverReady = false;
    for (let tryNo = 0; tryNo < 75; tryNo++) {
      if (app.exitCode !== null) throw new Error('Local staging-only Next server exited before readiness');
      try {
        const ping = await fetch(BASE_URL + '/api/auth/login', { signal: AbortSignal.timeout(2_000) });
        if (ping.ok) { serverReady = true; break; }
      } catch { /* server still compiling */ }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    check(serverReady, 'Authenticated queue HTTP server started on staging runner');

    const loginResponse = await withTimeout('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: req.owner.loginName, password: req.owner.password }),
    });
    const setCookie = loginResponse.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0];
    check(loginResponse.ok && cookie.startsWith('pos_session='), 'New salon owner authenticated through real login');
    const json = (method: string, data: Record<string, unknown>) => ({
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(data),
    });
    const createResponse = await withTimeout('/api/queue', json('POST', {
      empId, clientId: null, notes: RUN_ID, services: [],
    }));
    const ticket = await createResponse.json() as {
      ok?: boolean; error?: string; ticketId?: number; estimatedWaitMinutes?: number;
      ticket?: { status?: string; durationMinutes?: number; estimatedWaitMinutes?: number };
    };
    check(createResponse.status === 201 && ticket.ok && Number(ticket.ticketId) > 0,
      'Walk-in queue ticket created through authenticated API' + (ticket.error ? ': ' + ticket.error : ''));
    queueTicketId = Number(ticket.ticketId);
    check(ticket.ticket?.status === 'waiting', 'Fresh walk-in starts in waiting status');
    check(ticket.ticket?.durationMinutes === 45, 'Walk-in ticket uses this salon 45-minute default');
    check(Number.isFinite(Number(ticket.estimatedWaitMinutes)) ||
      Number.isFinite(Number(ticket.ticket?.estimatedWaitMinutes)), 'Queue ETA calculated for walk-in');

    const meta = await pool.request().input('ticketId', sql.Int, queueTicketId)
      .query('SELECT BranchID, EmpID, Source, Status, DurationMinutes FROM dbo.QueueTickets WHERE QueueTicketID=@ticketId');
    check(meta.recordset[0]?.BranchID === branchId && meta.recordset[0]?.EmpID === empId,
      'Walk-in belongs to new salon and new barber');
    check(meta.recordset[0]?.Source === 'walk_in', 'Walk-in uses queue source not booking source');
    check(meta.recordset[0]?.DurationMinutes === 45, 'Persisted ticket duration matches salon policy');

    const listResponse = await withTimeout('/api/queue', { headers: { cookie } });
    const listing = await listResponse.json() as { tickets?: Array<{ QueueTicketID?: number }> };
    check(listResponse.ok && Array.isArray(listing.tickets) &&
      listing.tickets.some((q) => q.QueueTicketID === queueTicketId),
      'Walk-in is visible on the authenticated branch queue list');
    const ticketPath = '/api/queue/' + queueTicketId;
    for (const [action, expected] of [
      ['called', 'called'],
      ['arrived', 'arrived'],
      ['in_service', 'in_service'],
      ['done', 'done'],
    ] as const) {
      const changed = await withTimeout(ticketPath, json('PATCH', { action }));
      const body = await changed.json() as { ok?: boolean; newStatus?: string; error?: string };
      check(changed.ok && body.ok && body.newStatus === expected,
        'Queue ticket advanced to ' + expected + (body.error ? ': ' + body.error : ''));
    }
    const persisted = await pool.request().input('ticketId', sql.Int, queueTicketId)
      .query('SELECT Status, ServiceStartedAt, ServiceEndedAt, BranchID FROM dbo.QueueTickets WHERE QueueTicketID=@ticketId');
    check(persisted.recordset[0]?.Status === 'done' &&
      persisted.recordset[0]?.ServiceStartedAt != null &&
      persisted.recordset[0]?.ServiceEndedAt != null,
      'Completed queue lifecycle persisted with service timestamps');
    check(persisted.recordset[0]?.BranchID === branchId, 'Completed queue ticket stays in original branch');
    const history = await pool.request().input('ticketId', sql.Int, queueTicketId)
      .query('SELECT NewStatus FROM dbo.QueueTicketHistory WHERE QueueTicketID=@ticketId');
    const statuses = history.recordset.map((row) => String(row.NewStatus));
    check(['called', 'arrived', 'in_service', 'done'].every((status) => statuses.includes(status)),
      'Queue history persisted the full staff workflow');
    console.log('SALON_QUEUE_WALKIN_E2E_STAGING_PASS');
  } finally {
    if (app && app.exitCode === null) {
      app.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (app.exitCode === null) app.kill('SIGKILL');
    }
    if (tenantCode) {
      await assertStaging(pool);
      const { purgeSmokeTenant } = await import('./smokeTenantPurge');
      await purgeSmokeTenant(pool, tenantCode);
      const left = await pool.request().input('code', sql.NVarChar(64), tenantCode)
        .query('SELECT COUNT(*) AS total FROM dbo.Tenant WHERE Code=@code');
      check(Number(left.recordset[0].total) === 0, 'Synthetic queue salon cleaned completely');
      if (queueTicketId != null) {
        const tickets = await pool.request().input('ticketId', sql.Int, queueTicketId)
          .query('SELECT COUNT(*) AS total FROM dbo.QueueTickets WHERE QueueTicketID=@ticketId');
        check(Number(tickets.recordset[0].total) === 0, 'Synthetic queue ticket cleaned completely');
      }
    }
    await closeSmokePool(pool);
  }
}
// This is a one-off CLI smoke, not a persistent server. Explicitly terminate
// after verified tenant cleanup and bounded pool close; Node/Next may hold open
// background handles even when all booking and cleanup assertions have passed.
void main().then(
  () => {
    console.log('SALON_QUEUE_E2E_STAGING_EXIT_OK');
    process.exit(0);
  },
  (err: unknown) => {
    console.error('SALON_QUEUE_E2E_STAGING_FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
