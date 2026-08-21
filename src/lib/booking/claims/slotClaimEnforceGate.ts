/**
 * B6.5 — enforce readiness gate (dual-guard preserved even when GO).
 */

import {
  resolveBookingSlotClaimsMode,
  type BookingSlotClaimsMode,
} from '@/lib/booking/claims/BookingSlotClaimFlags';
import { getSlotClaimShadowStats } from '@/lib/booking/claims/slotClaimShadowTelemetry';
import type { SlotClaimBackfillReport } from '@/lib/booking/claims/slotClaimBackfill';
import type { SlotClaimMigrationReadiness } from '@/lib/booking/claims/slotClaimMigrationReady';

export type HoldPolicyModeLite = 'off' | 'shadow' | 'enforce';

function resolveHoldPolicyModeLite(
  env: NodeJS.ProcessEnv = process.env,
): HoldPolicyModeLite {
  const raw = String(env.BOOKING_V2_HOLD_POLICY_MODE ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'shadow') return 'shadow';
  if (raw === 'enforce' || raw === 'on' || raw === '1' || raw === 'true') {
    return 'enforce';
  }
  const claims = String(env.BOOKING_V2_SLOT_CLAIMS_MODE ?? 'off')
    .trim()
    .toLowerCase();
  if (claims === 'shadow' || claims === 'enforce' || claims === 'on' || claims === '1') {
    return 'enforce';
  }
  return 'off';
}

export type EnforceReadinessInput = {
  migration: SlotClaimMigrationReadiness;
  backfill: SlotClaimBackfillReport;
  /** Manual override: operator reviewed remaining legacy overlaps. */
  legacyOverlapsReviewed?: boolean;
  shadowStats?: ReturnType<typeof getSlotClaimShadowStats>;
  holdPolicyMode?: HoldPolicyModeLite;
  claimsMode?: BookingSlotClaimsMode;
};

export type EnforceReadinessResult = {
  go: boolean;
  mode: BookingSlotClaimsMode;
  holdPolicyMode: string;
  blockers: string[];
  warnings: string[];
  checklist: Record<string, boolean>;
};

export function evaluateEnforceReadiness(
  input: EnforceReadinessInput,
): EnforceReadinessResult {
  const mode = input.claimsMode ?? resolveBookingSlotClaimsMode();
  const holdPolicyMode = input.holdPolicyMode ?? resolveHoldPolicyModeLite();
  const shadow = input.shadowStats ?? getSlotClaimShadowStats();
  const blockers: string[] = [];
  const warnings: string[] = [];

  const migrationOk = input.migration.ready;
  const overlaps = input.backfill.legacyOverlaps.length;
  const overlapsOk =
    overlaps === 0 || input.legacyOverlapsReviewed === true;
  const parityPct = input.backfill.parity?.parityPct;
  const parityOk =
    parityPct == null
      ? false
      : parityPct >= 100 && (input.backfill.parity?.mismatchBookingIds.length ?? 1) === 0;
  const claimInsertOk = input.backfill.claimInsertErrors === 0;
  const malformedOk = input.backfill.skippedMalformedAbsolute === 0;
  const holdPolicyOk = holdPolicyMode === 'enforce' || holdPolicyMode === 'shadow';
  const shadowMismatchOk =
    shadow.claimConflictLegacyAllowed === 0 &&
    shadow.legacyConflictClaimAllowed === 0 &&
    shadow.holdPolicyMismatch === 0;
  const dualGuardPreserved = true; // architectural — never remove in this phase

  if (!migrationOk) blockers.push('MIGRATION_NOT_READY');
  if (!overlapsOk) blockers.push('LEGACY_OVERLAPS_UNREVIEWED');
  if (!parityOk) blockers.push('BACKFILL_PARITY_NOT_100');
  if (!claimInsertOk) blockers.push('CLAIM_INSERT_ERRORS');
  if (!malformedOk) warnings.push('MALFORMED_ABSOLUTE_INTERVALS');
  if (!holdPolicyOk) blockers.push('HOLD_POLICY_NOT_ACTIVE');
  const shadowMismatchVerified =
    shadow.totalShadowAttempts > 0 && shadowMismatchOk;
  if (shadow.totalShadowAttempts === 0) {
    warnings.push('NO_SHADOW_SAMPLES_YET');
    blockers.push('SHADOW_SAMPLES_REQUIRED');
  } else if (!shadowMismatchOk) {
    blockers.push('SHADOW_MISMATCH_NONZERO');
  }

  const checklist = {
    migrationVerified: migrationOk,
    backfillParity100: parityOk,
    legacyOverlapsReviewed: overlapsOk,
    holdPolicyActive: holdPolicyOk,
    shadowMismatchZero: shadowMismatchVerified,
    dualGuardPreserved,
    absoluteSoTOnReschedule: true,
  };

  return {
    go: blockers.length === 0,
    mode,
    holdPolicyMode,
    blockers,
    warnings,
    checklist,
  };
}
