#!/usr/bin/env npx tsx
/**
 * DRVO-012 repair: grandfather tenants that have no TenantSubscription (insert-only).
 *
 * Requires --expected-database=<name>; production additionally requires --allow-production
 * (same guard as the DRVO migration runner). Refuses unless migration 9 is applied.
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
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, parent, isMain);
};

function parseExpectedDatabase(argv: string[]): string | undefined {
  const arg = argv.find((a) => a.startsWith('--expected-database='));
  return arg ? arg.slice('--expected-database='.length).trim() : undefined;
}

async function main() {
  const allowProduction = process.argv.includes('--allow-production');
  const expectedDatabase = parseExpectedDatabase(process.argv.slice(2));
  if (!expectedDatabase) {
    console.error('Missing --expected-database=<name>.');
    process.exit(1);
  }

  const { getPool, closePool } = await import('../../src/lib/db');
  const { assertDatabaseAllowed } = await import('./runner');
  const { listAppliedDrvoMigrations } = await import('./registry');
  const {
    COMMERCIAL_MIGRATION_KEY,
    reconcileGrandfatheredSubscriptions,
    verifyCommercialSubscriptionSchema,
  } = await import('./migrations/009-commercial-subscription-tenant-apps');

  try {
    const pool = await getPool();
    const database = await assertDatabaseAllowed(pool, { allowProduction, expectedDatabase });
    if (database !== expectedDatabase) {
      throw new Error(`Refusing: DB_NAME()="${database}" does not match "${expectedDatabase}".`);
    }
    const applied = await listAppliedDrvoMigrations(pool);
    if (!applied.some((r) => r.MigrationKey === COMMERCIAL_MIGRATION_KEY)) {
      throw new Error(`Refusing: ${COMMERCIAL_MIGRATION_KEY} is not applied on ${database}.`);
    }

    const grandfathered = await reconcileGrandfatheredSubscriptions(pool);
    console.log(
      JSON.stringify({ database, grandfathered, count: grandfathered.length }, null, 2),
    );

    const verify = await verifyCommercialSubscriptionSchema(pool);
    if (!verify.ok) {
      console.error(`Verify still failing: ${verify.failures.join('; ')}`);
      process.exit(1);
    }
    console.log('PASS: every tenant has a subscription; DRVO-012 verify OK.');
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
