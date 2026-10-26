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
