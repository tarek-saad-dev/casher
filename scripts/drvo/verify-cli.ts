#!/usr/bin/env npx tsx
/**
 * Read-only DRVO system verification — npm run drvo:verify
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

async function main() {
  const allowProduction = process.argv.includes('--allow-production');
  const { PRODUCTION_DB } = await import('./types');
  const { getPool, closePool } = await import('../../src/lib/db');
  const { verifyDrvoSystem } = await import('./readiness');

  try {
    const pool = await getPool();
    const live = String(
      (await pool.request().query(`SELECT DB_NAME() AS db;`)).recordset[0]?.db ?? '',
    );
    if (live === PRODUCTION_DB && !allowProduction) {
      throw new Error(`Refusing production ${PRODUCTION_DB} without --allow-production.`);
    }
    const report = await verifyDrvoSystem(pool);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
    console.log('PASS: DRVO verify.');
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
