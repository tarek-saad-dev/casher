/**
 * B6.5 — verify TblBookingSlotClaim migration (read-only, no CREATE).
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { verifySlotClaimMigrationReadiness } = await import(
    '../src/lib/booking/claims/slotClaimMigrationReady'
  );
  const readiness = await verifySlotClaimMigrationReadiness();
  console.log(JSON.stringify(readiness, null, 2));
  process.exit(readiness.ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
