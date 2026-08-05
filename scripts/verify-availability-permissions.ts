#!/usr/bin/env npx tsx
/**
 * Verify hr.workforce_availability page + expected role grants.
 * Exit non-zero when missing. Does not grant.
 * Usage: npm run verify:availability-permissions
 */
async function main() {
  try {
    const path = await import('path');
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
    dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
  } catch {
    /* optional */
  }

  const { getPool } = await import('../src/lib/db');
  const { verifyWorkforceAvailabilityPermissions } = await import(
    '../src/lib/permissions/workforceAvailabilityPermissions'
  );

  const db = await getPool();
  const result = await verifyWorkforceAvailabilityPermissions(db);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error('[verify:availability-permissions] FAILED:', result.message);
    process.exit(1);
  }
  console.log('[verify:availability-permissions] OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify:availability-permissions] error', err);
  process.exit(1);
});
