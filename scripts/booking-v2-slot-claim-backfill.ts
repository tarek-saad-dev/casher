/**
 * CLI: dry-run or apply Booking V2 B6.5 slot-claim backfill + parity.
 *
 * Usage:
 *   npx tsx scripts/booking-v2-slot-claim-backfill.ts --dry-run
 *   npx tsx scripts/booking-v2-slot-claim-backfill.ts --apply
 *   npx tsx scripts/booking-v2-slot-claim-backfill.ts --apply --verify
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const verify = process.argv.includes('--verify') || apply;

  const { verifySlotClaimMigrationReadiness } = await import(
    '../src/lib/booking/claims/slotClaimMigrationReady'
  );
  const { backfillBookingSlotClaims } = await import(
    '../src/lib/booking/claims/slotClaimBackfill'
  );
  const { evaluateEnforceReadiness } = await import(
    '../src/lib/booking/claims/slotClaimEnforceGate'
  );
  const { resolveBookingSlotClaimsMode } = await import(
    '../src/lib/booking/claims/BookingSlotClaimFlags'
  );
  const { getSlotClaimShadowStats } = await import(
    '../src/lib/booking/claims/slotClaimShadowTelemetry'
  );

  const migration = await verifySlotClaimMigrationReadiness();
  console.log(
    JSON.stringify(
      {
        phase: 'B6_5_SLOT_CLAIM_ACTIVATION',
        mode: dryRun ? 'dry-run' : 'apply',
        featureFlag: resolveBookingSlotClaimsMode(),
        migration,
      },
      null,
      2,
    ),
  );

  if (!migration.tableExists) {
    console.error('[B6.5] TblBookingSlotClaim missing — apply db/migrations/create-booking-slot-claims.sql first');
    process.exit(1);
  }

  const report = await backfillBookingSlotClaims({
    dryRun,
    verifyParity: verify && !dryRun,
  });
  console.log(JSON.stringify({ backfill: report }, null, 2));

  if (report.legacyOverlaps.length) {
    console.error(
      `[B6.5] LEGACY OVERLAPS: ${report.legacyOverlaps.length} (cross-branch: ${report.crossBranchConflicts.length}) — bookings NOT auto-fixed`,
    );
  }

  const gate = evaluateEnforceReadiness({
    migration,
    backfill: report,
    legacyOverlapsReviewed: process.argv.includes('--overlaps-reviewed'),
    shadowStats: getSlotClaimShadowStats(),
  });
  console.log(JSON.stringify({ enforceGate: gate }, null, 2));

  process.exit(
    report.claimInsertErrors > 0 || !migration.ready ? 2 : 0,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
