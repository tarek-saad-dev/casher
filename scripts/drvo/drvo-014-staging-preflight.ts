#!/usr/bin/env npx tsx
/**
 * Read-only DRVO Clinics staging preflight for Codex running on the VPS.
 *
 * Uses the existing local SQL listener; does not need Cursor Cloud or SSH tunnel.
 * NEVER loads .env / .env.local, mutates SQL, or connects to production.
 */
import sql from 'mssql';
import { existsSync } from 'node:fs';

const expectedDatabase = 'last132_agent';
const expectedLogin = 'drvo_agent';

async function main() {
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(name)) {
      throw new Error(`Refusing to run from a checkout containing ${name}. Use an isolated staging checkout.`);
    }
  }
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('DRVO_STAGING_DB_PASSWORD is missing (use an approved staging-only secret source).');

  const host = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = Number(process.env.DRVO_STAGING_DB_PORT || '1433');
  if (host !== '127.0.0.1' || port !== 1433) {
    throw new Error('Preflight requires the VPS loopback SQL listener 127.0.0.1:1433.');
  }

  const pool = await new sql.ConnectionPool({
    server: host,
    port,
    database: expectedDatabase,
    user: expectedLogin,
    password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 10000,
    requestTimeout: 10000,
  }).connect();
  try {
    const { recordset } = await pool.request().query(`
      SELECT DB_NAME() AS db, SUSER_SNAME() AS login,
             HAS_DBACCESS(N'last132') AS productionAccess;
    `);
    const row = recordset[0];
    if (row.db !== expectedDatabase || String(row.login).toLowerCase() !== expectedLogin) {
      throw new Error('REFUSED: staging database/login identity mismatch.');
    }
    if (row.productionAccess !== 0) {
      throw new Error('REFUSED: staging login may have production database access (or access cannot be proven absent).');
    }
    console.log('STAGING_PREFLIGHT_PASS');
    console.log('DB=last132_agent LOGIN=drvo_agent PRODUCTION_ACCESS=0');
    console.log('READ_ONLY=true MIGRATION_APPLIED=false');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('STAGING_PREFLIGHT_FAIL:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
