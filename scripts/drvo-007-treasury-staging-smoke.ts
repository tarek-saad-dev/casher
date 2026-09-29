#!/usr/bin/env npx tsx
/**
 * DRVO-007 staging smoke — last132_agent only.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';

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

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) {
    console.error('BLOCKER: DRVO_STAGING_DB_PASSWORD not set');
    process.exit(1);
  }
  forceStagingEnv(password);

  const { getPool, sql } = await import('../src/lib/db');
  const pool = await getPool();
  const guard = await pool.query(`
    SELECT DB_NAME() AS db, SUSER_SNAME() AS login
  `);
  const db = guard.recordset[0]?.db;
  const login = guard.recordset[0]?.login;
  if (db !== STAGING_DB || login !== STAGING_USER) {
    console.error(`BLOCKER: expected ${STAGING_DB}/${STAGING_USER}, got ${db}/${login}`);
    process.exit(1);
  }
  console.log('PASS: staging DB guard');

  const trigger = await pool.query(`
    SELECT name, is_disabled FROM sys.triggers WHERE name = N'InsCashMoveSales'
  `);
  if (!trigger.recordset.length) {
    console.error('BLOCKER: InsCashMoveSales trigger not found');
    process.exit(1);
  }
  if (trigger.recordset[0].is_disabled) {
    console.error('BLOCKER: InsCashMoveSales must remain enabled in DRVO-007');
    process.exit(1);
  }
  console.log('PASS: InsCashMoveSales trigger live');

  const registry = await pool.query(`
    SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = N'TreasuryMovementRegistry'
  `);
  if (!registry.recordset[0]?.cnt) {
    console.error('BLOCKER: run add-drvo-007-treasury-movement-registry.sql on staging first');
    process.exit(1);
  }
  console.log('PASS: TreasuryMovementRegistry exists');

  console.log('SMOKE: manual income/expense/transfer probes require open shift — registry + trigger checks complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
