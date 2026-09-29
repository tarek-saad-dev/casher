#!/usr/bin/env npx tsx
/**
 * DRVO-008 staging smoke — last132_agent / drvo_agent only.
 * Verifies POS boundary prerequisites, InsCashMoveSales trigger, and pos migration.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';
const PRODUCTION_DB = 'last132';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function forceStagingEnv(password: string) {
  const values: Record<string, string> = {
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: STAGING_DB,
    DB_NAME: STAGING_DB,
    DB_USER: STAGING_USER,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('DRVO_STAGING_DB_PASSWORD not set');
  forceStagingEnv(password);

  const { getPool, closePool } = await import('../src/lib/db');
  const { posPrerequisitesMigration } = await import('./drvo/migrations/008-pos-prerequisites');
  const { getDrvoModuleRolloutSpec } = await import('../src/platform/drvo/moduleManifest');

  const pool = await getPool();
  try {
    const guard = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login`);
    const db = String(guard.recordset[0]?.db ?? '');
    const login = String(guard.recordset[0]?.login ?? '');
    if (db === PRODUCTION_DB) fail('refusing production last132');
    if (db !== STAGING_DB || login !== STAGING_USER) {
      fail(`expected ${STAGING_DB}/${STAGING_USER}, got ${db}/${login}`);
    }
    console.log('PASS: staging DB guard');

    const posSpec = getDrvoModuleRolloutSpec('pos');
    if (posSpec.rollout !== 'legacy') fail('expected POS rollout legacy for DRVO-008');
    console.log('PASS: POS manifest rollout=legacy');

    const trigger = await pool.request().query(`
      SELECT t.name, t.is_disabled
      FROM sys.triggers t
      WHERE t.name = N'InsCashMoveSales'
    `);
    if (!trigger.recordset[0]) fail('InsCashMoveSales trigger not found');
    if (trigger.recordset[0].is_disabled) fail('InsCashMoveSales must remain enabled');
    console.log('PASS: InsCashMoveSales live');

    const verify = await posPrerequisitesMigration.verify!({
      pool,
      databaseName: STAGING_DB,
      appCommitSha: 'drvo-008-smoke',
    });
    if (!verify.ok) fail(`pos-prerequisites verify failed: ${verify.failures?.join('; ')}`);
    console.log('PASS: pos-prerequisites verification');

    console.log('DRVO-008 POS staging smoke complete');
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
