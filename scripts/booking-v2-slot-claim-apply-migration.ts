/**
 * Apply create-booking-slot-claims.sql if table missing (deploy-time only).
 * Usage: npx tsx scripts/booking-v2-slot-claim-apply-migration.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { getPool } = await import('../src/lib/db');
  const { verifySlotClaimMigrationReadiness } = await import(
    '../src/lib/booking/claims/slotClaimMigrationReady'
  );

  let readiness = await verifySlotClaimMigrationReadiness();
  if (readiness.ready) {
    console.log(JSON.stringify({ status: 'already_ready', readiness }, null, 2));
    process.exit(0);
  }

  const sqlPath = path.join(
    process.cwd(),
    'db/migrations/create-booking-slot-claims.sql',
  );
  const raw = fs.readFileSync(sqlPath, 'utf8');
  // Split on GO batches
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  const db = await getPool();
  for (const batch of batches) {
    await db.request().query(batch);
  }

  readiness = await verifySlotClaimMigrationReadiness();
  console.log(JSON.stringify({ status: 'applied', readiness }, null, 2));
  process.exit(readiness.ready ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
