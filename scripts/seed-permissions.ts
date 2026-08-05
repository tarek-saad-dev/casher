#!/usr/bin/env npx tsx
/**
 * Seed / ensure workforce availability permissions (idempotent).
 * Usage: npm run seed:permissions
 */
async function main() {
  try {
    const path = await import('path');
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
  } catch {
    /* dotenv optional */
  }

  const { getPool } = await import('../src/lib/db');
  const {
    ensureWorkforceAvailabilityGrants,
    verifyWorkforceAvailabilityPermissions,
  } = await import('../src/lib/permissions/workforceAvailabilityPermissions');

  const db = await getPool();
  const ensured = await ensureWorkforceAvailabilityGrants(db);
  console.log('[seed:permissions] workforce page ensured, grantsAdded=', ensured.grantsAdded);

  const verify = await verifyWorkforceAvailabilityPermissions(db);
  if (!verify.ok) {
    console.error('[seed:permissions] verification failed:', verify.message);
    process.exit(1);
  }
  console.log('[seed:permissions]', verify.message);
  console.log('[seed:permissions] grantedRoles=', verify.grantedRoles.join(', '));
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:permissions] failed', err);
  process.exit(1);
});
