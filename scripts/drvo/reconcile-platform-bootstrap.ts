#!/usr/bin/env npx tsx
/**
 * Idempotent production-safe reconciliation for DRVO platform bootstrap data.
 * This is not a schema migration. It restores missing legacy user/branch mappings
 * using the existing ensurePlatformBootstrapData reconciliation logic.
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
  const {
    ensurePlatformBootstrapData,
    verifyPlatformBootstrap,
  } = await import('./platformBootstrap');

  try {
    const pool = await getPool();
    const live = String(
      (await pool.request().query(`SELECT DB_NAME() AS db;`)).recordset[0]?.db ?? '',
    );

    if (live === PRODUCTION_DB && !allowProduction) {
      throw new Error(
        `Refusing production ${PRODUCTION_DB} without --allow-production.`,
      );
    }

    const applied = await ensurePlatformBootstrapData(pool);
    const report = await verifyPlatformBootstrap(pool);

    console.log(
      JSON.stringify(
        {
          database: live,
          tenantId: applied.tenantId,
          locationsAdded: applied.locationsAdded,
          membershipsAdded: applied.membershipsAdded,
          verified: report.ok,
          failures: report.failures,
        },
        null,
        2,
      ),
    );

    if (!report.ok) {
      process.exitCode = 1;
      return;
    }

    console.log('PASS: platform bootstrap reconciliation.');
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
