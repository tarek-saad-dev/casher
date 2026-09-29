#!/usr/bin/env npx tsx
/**
 * Apply db/migrations/add-drvo-007-treasury-movement-registry.sql.
 *
 * Staging (Cloud Agent): last132_agent / drvo_agent. Do not pass --allow-production.
 * Production deploy on the VPS: --allow-production, and DB_NAME() must be last132.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

const PRODUCTION_DB = 'last132';
const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';

function forceStagingEnv(password: string) {
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: '127.0.0.1',
    CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_USER,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: STAGING_DB,
    DB_NAME: STAGING_DB,
    DB_USER: STAGING_USER,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
    LOCAL_DB_SERVER: '127.0.0.1',
    LOCAL_DB_PORT: '14330',
    LOCAL_DB_NAME: STAGING_DB,
    LOCAL_DB_USER: STAGING_USER,
    LOCAL_DB_PASSWORD: password,
    LOCAL_DB_ENCRYPT: 'false',
    LOCAL_DB_TRUST_CERT: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

async function main() {
  const allowProduction = process.argv.includes('--allow-production');
  if (!allowProduction) {
    const password = process.env.DRVO_STAGING_DB_PASSWORD;
    if (!password) {
      throw new Error('Staging migration requires DRVO_STAGING_DB_PASSWORD');
    }
    forceStagingEnv(password);
  }

  const { getPool, closePool } = await import('../src/lib/db');
  const { applyDrvo007TreasuryMigration } = await import('./drvo007Migration');
  try {
    const pool = await getPool();
    const guard = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login`);
    const db = String(guard.recordset[0]?.db ?? '');
    const login = String(guard.recordset[0]?.login ?? '');
    if (allowProduction) {
      if (db !== PRODUCTION_DB) {
        throw new Error(`Refusing --allow-production on ${db}`);
      }
    } else if (db !== STAGING_DB || login !== STAGING_USER) {
      throw new Error(`Refusing ${db}/${login}`);
    }
    if (db === PRODUCTION_DB && !allowProduction) {
      throw new Error('Refusing production last132');
    }
    await applyDrvo007TreasuryMigration(pool);
    console.log(`PASS: DRVO-007 treasury migration applied on ${db}`);
  } finally {
    await closePool();
  }
}

main().catch(async (err) => {
  const { formatSqlErrorContext } = await import('./drvo007Migration');
  const message = err instanceof Error
    ? (err.message.includes('DRVO-007 migration failed at step')
      ? err.message
      : formatSqlErrorContext('runner', err))
    : String(err);
  console.error(message);
  process.exit(1);
});
