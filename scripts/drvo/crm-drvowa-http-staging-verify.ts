#!/usr/bin/env npx tsx
/**
 * Read-only HTTP check of Cashier Next.js routes against last132_agent.
 * Runs only from the dedicated staging GitHub Action / drvo_agent SQL tunnel.
 * No pairing, token rotation, inserts, updates, sends, or production access.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import sql from 'mssql';

const DATABASE = 'last132_agent';
const LOGIN = 'drvo_agent';
const PORT = 5501;

function assertCiStaging(): void {
  if (process.env.CI !== 'true'
    || process.env.DB_DATABASE !== DATABASE
    || process.env.CLOUD_DB_NAME !== DATABASE
    || process.env.DB_USER !== LOGIN
    || process.env.CLOUD_DB_USER !== LOGIN
    || process.env.DB_SERVER !== '127.0.0.1'
    || process.env.DB_PORT !== '14330'
    || !process.env.DRVO_STAGING_DB_PASSWORD
  ) throw new Error('Refusing HTTP smoke outside the dedicated staging CI SQL identity');
  for (const key of ['DB_NAME','MSSQL_DATABASE']) {
    if (process.env[key]?.trim() === 'last132') throw new Error('Production DB env is forbidden');
  }
}

async function configTokenHash(pool: sql.ConnectionPool): Promise<string | null> {
  const result = await pool.request().query<{ tokenHash: string }>(`
    IF OBJECT_ID(N'dbo.TblDrvowaIntegrationConfig', N'U') IS NULL
      SELECT TOP 0 CAST(NULL AS NVARCHAR(128)) AS tokenHash;
    ELSE
      SELECT TOP 1 OutboundTokenHash AS tokenHash
      FROM dbo.TblDrvowaIntegrationConfig
      WHERE ConfigID = 1 AND Status = N'ACTIVE'
  `);
  return result.recordset[0]?.tokenHash ?? null;
}

function limitBody(value: unknown): Record<string,unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string,unknown> : {};
}

async function run(): Promise<void> {
  assertCiStaging();
  const pool = new sql.ConnectionPool({
    server: '127.0.0.1', port: 14330, database: DATABASE, user: LOGIN,
    password: process.env.DRVO_STAGING_DB_PASSWORD!,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 12000, requestTimeout: 15000,
  });
  let existingTokenHash: string | null;
  try {
    await pool.connect();
    const identity = await pool.request().query<{ databaseName: string; loginName: string }>(
      'SELECT DB_NAME() AS databaseName, SUSER_SNAME() AS loginName',
    );
    if (identity.recordset[0]?.databaseName !== DATABASE
      || identity.recordset[0]?.loginName?.toLowerCase() !== LOGIN) {
      throw new Error('Staging SQL DB/login identity mismatch');
    }
    existingTokenHash = await configTokenHash(pool);
  } finally {
    await pool.close();
  }

  const configuredToken = process.env.DRVO_STAGING_CONNECTOR_TOKEN?.trim();
  if (existingTokenHash && !configuredToken) {
    console.log('CASHIER_STAGING_HTTP_BLOCKED: staging database has a configured token; dedicated DRVO_STAGING_CONNECTOR_TOKEN not supplied');
    return;
  }
  const token = configuredToken ?? `ci_ephemeral_${randomBytes(20).toString('hex')}`;
  if (existingTokenHash
    && createHash('sha256').update(token).digest('hex') !== existingTokenHash) {
    throw new Error('Dedicated staging HTTP token does not match the staging DB hash');
  }
  if (process.env.VPS_SSH_KEY && token === process.env.VPS_SSH_KEY) {
    throw new Error('Refusing production token substitution');
  }

  // No stdout/stderr of the Next process is forwarded: potentially sensitive.
  const child: ChildProcess = spawn(process.execPath, [
    'node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', String(PORT),
  ], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DRVOWA_INTEGRATION_TOKEN: token,
    },
    stdio: ['ignore','pipe','pipe'],
  });
  let lastError = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    lastError = (lastError + chunk.toString('utf8')).slice(-1200);
  });
  child.stdout?.resume();

  try {
    const base = `http://127.0.0.1:${PORT}`;
    const endpoint = '/api/integrations/drvowa/v1/manifest';
    let ready = false;
    for (let i = 0; i < 70; i++) {
      if (child.exitCode !== null) throw new Error('Staging Next process exited before HTTP readiness');
      try {
        const res = await fetch(base + endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
        if (res.status === 200) { ready = true; break; }
        if (res.status === 401) {
          const payload = limitBody(await res.json().catch(() => ({})));
          const err = payload.error;
          const errorCode = typeof err === 'string'
            ? 'EDGE_SESSION_GATE'
            : String(limitBody(err).code ?? 'UNKNOWN_BEARER_REJECTION');
          throw new Error(`Staging manifest bearer rejected at ${errorCode}; no bypass attempted`);
        }
        if (![404, 503, 502, 500].includes(res.status)) {
          throw new Error(`Unexpected staging manifest HTTP ${res.status}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unexpected')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!ready) throw new Error('Staging Next manifest was not ready via HTTP');

    const negative = await fetch(base + endpoint, {
      headers: { Authorization: 'Bearer invalid-synthetic-token' },
      signal: AbortSignal.timeout(12000),
    });
    if (negative.status !== 401) throw new Error('Staging manifest did not reject invalid bearer token');

    const response = await fetch(base + endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Manifest returned HTTP ${response.status}`);
    const manifest = limitBody(await response.json());
    const defined = Array.isArray(manifest.tools) ? manifest.tools.map(x => String(limitBody(x).name)) : [];
    const specs = [
      { tool: 'customer.list_changes', key: 'customers', input: { sinceClientId:0, limit:3 } },
      { tool: 'invoice.list_changes', key: 'invoices', input: { sinceInvId:0, includeInactive:true, limit:3 } },
      { tool: 'catalog.list_services', key: 'services', input: { sinceProId:0, limit:3 } },
    ];
    const samples: Record<string,number> = {};
    for (const spec of specs) {
      if (!defined.includes(spec.tool)) throw new Error(`Missing real HTTP CRM tool ${spec.tool}`);
      const res = await fetch(
        base + '/api/integrations/drvowa/v1/tools/' + encodeURIComponent(spec.tool),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requestId: randomUUID(), input: spec.input }),
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        },
      );
      if (!res.ok) throw new Error(`Staging HTTP tool ${spec.tool} returned HTTP ${res.status}`);
      const json = limitBody(await res.json());
      const data = limitBody(json.data);
      const rows = Array.isArray(data[spec.key]) ? data[spec.key] as unknown[] : [];
      if (json.ok !== true || rows.length > 3 || (rows.length > 0 && !data.nextCursor)) {
        throw new Error(`Staging HTTP tool ${spec.tool} violated CRM page contract`);
      }
      samples[spec.tool] = rows.length;
    }
    console.log(JSON.stringify({
      result: 'CASHIER_STAGING_HTTP_PASS',
      database: DATABASE, login: LOGIN, mode: 'real Next HTTP routes against read-only staging SQL',
      authenticated: true, invalidTokenRejected: true,
      sampleRowCounts: samples, productionTouched:false, messagesSent:false,
      autoRespondPaired:false,
    }));
  } catch (error) {
    // Do not output the captured Next stderr (may include runtime environment details).
    void lastError;
    throw error;
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.killed) return resolve();
      child.once('exit', () => resolve());
      setTimeout(resolve, 3000).unref();
    });
  }
}

run().catch(err => {
  console.error('CASHIER_STAGING_HTTP_FAIL', err instanceof Error ? err.message : 'unknown');
  process.exitCode = 1;
});
