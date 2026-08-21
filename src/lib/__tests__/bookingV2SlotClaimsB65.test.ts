/**
 * Booking V2 Phase B6.5 — production activation helpers (no live DB required).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  resolveBookingSlotClaimsMode,
  isBookingSlotClaimsEnforced,
} from '@/lib/booking/claims/BookingSlotClaimFlags';
import { resolveHoldPolicyMode } from '@/lib/booking/claims/holdPolicyValidation';
import {
  logSlotClaimShadowEvent,
  getSlotClaimShadowStats,
  resetSlotClaimShadowStatsForTests,
} from '@/lib/booking/claims/slotClaimShadowTelemetry';
import { evaluateEnforceReadiness } from '@/lib/booking/claims/slotClaimEnforceGate';
import { createBookingInterval } from '@/lib/booking/domain/BookingInterval';
import { BOOKING_TZ } from '@/lib/booking/domain/BusinessDate';
import { scanLegacyBookingOverlaps } from '@/lib/booking/claims/slotClaimBackfill';
import type { LegacyBookingInterval } from '@/lib/booking/claims/slotClaimBackfill';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('B6.5 flags', () => {
  it('shadow mode does not enforce', () => {
    expect(
      resolveBookingSlotClaimsMode({ BOOKING_V2_SLOT_CLAIMS_MODE: 'shadow' }),
    ).toBe('shadow');
    expect(
      isBookingSlotClaimsEnforced({ BOOKING_V2_SLOT_CLAIMS_MODE: 'shadow' }),
    ).toBe(false);
  });

  it('hold policy defaults to enforce when claims shadow/enforce', () => {
    expect(
      resolveHoldPolicyMode({
        BOOKING_V2_SLOT_CLAIMS_MODE: 'shadow',
        BOOKING_V2_HOLD_POLICY_MODE: '',
      }),
    ).toBe('enforce');
    expect(
      resolveHoldPolicyMode({
        BOOKING_V2_SLOT_CLAIMS_MODE: 'off',
        BOOKING_V2_HOLD_POLICY_MODE: '',
      }),
    ).toBe('off');
    expect(
      resolveHoldPolicyMode({
        BOOKING_V2_SLOT_CLAIMS_MODE: 'shadow',
        BOOKING_V2_HOLD_POLICY_MODE: 'shadow',
      }),
    ).toBe('shadow');
  });
});

describe('B6.5 shadow telemetry', () => {
  beforeEach(() => {
    resetSlotClaimShadowStatsForTests();
  });

  it('records agreement + latency percentiles', () => {
    logSlotClaimShadowEvent({
      operation: 'hold',
      legacyDecision: 'allow',
      claimDecision: 'allow',
      mismatchCategory: 'exact_agreement',
      latencyMs: 10,
    });
    logSlotClaimShadowEvent({
      operation: 'create',
      legacyDecision: 'allow',
      claimDecision: 'conflict',
      mismatchCategory: 'claim_conflict_legacy_allowed',
      latencyMs: 40,
    });
    logSlotClaimShadowEvent({
      operation: 'hold_policy',
      mismatchCategory: 'none',
      latencyMs: 20,
    });
    const s = getSlotClaimShadowStats();
    expect(s.totalShadowAttempts).toBe(3);
    expect(s.exactAgreement).toBe(1);
    expect(s.claimConflictLegacyAllowed).toBe(1);
    expect(s.holdPolicyMismatch).toBe(0);
    expect(s.latencyP50Ms).toBe(20);
    expect(s.latencyP95Ms).toBe(40);
  });
});

describe('B6.5 absolute SoT interval', () => {
  it('derives overnight dayOffset from BusinessDate model', () => {
    // 2026-08-16 business day, start just after midnight calendar = next day
    const startAtMs = Date.parse('2026-08-17T00:15:00+03:00');
    const endAtMs = Date.parse('2026-08-17T00:45:00+03:00');
    const interval = createBookingInterval({
      businessDate: '2026-08-16',
      startAtMs,
      endAtMs,
      timeZone: BOOKING_TZ,
    });
    expect(interval.legacyDayOffset).toBe(1);
    expect(interval.legacyStartTimeHhmm).toMatch(/^00:/);
  });
});

describe('B6.5 cross-branch legacy conflict detection', () => {
  it('flags cross-branch EmpID overlaps', () => {
    const bookings: LegacyBookingInterval[] = [
      {
        id: 1,
        empId: 9,
        branchId: 1,
        startMs: 1_000,
        endMs: 2_000,
        status: 'confirmed',
        hasAbsolute: true,
        malformedAbsolute: false,
      },
      {
        id: 2,
        empId: 9,
        branchId: 2,
        startMs: 1_500,
        endMs: 2_500,
        status: 'confirmed',
        hasAbsolute: true,
        malformedAbsolute: false,
      },
    ];
    const overlaps = scanLegacyBookingOverlaps(bookings);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.crossBranch).toBe(true);
  });
});

describe('B6.5 enforce gate', () => {
  it('NO-GO when parity incomplete or overlaps unreviewed', () => {
    const gate = evaluateEnforceReadiness({
      migration: {
        ready: true,
        tableExists: true,
        uniqueEmpSlot: true,
        indexHoldToken: true,
        indexBookingId: true,
        indexEmpTypeExpires: true,
        indexExpiresHold: true,
        indexes: [],
        missing: [],
      },
      backfill: {
        scanned: 10,
        claimsRequiredSlots: 60,
        claimed: 8,
        skippedConflict: 2,
        skippedAlreadyClaimed: 0,
        skippedInvalidInterval: 0,
        skippedMalformedAbsolute: 0,
        claimInsertErrors: 0,
        legacyOverlaps: [
          {
            empId: 1,
            bookingIdA: 1,
            bookingIdB: 2,
            branchIdA: 1,
            branchIdB: 1,
            crossBranch: false,
            startA: '',
            endA: '',
            startB: '',
            endB: '',
          },
        ],
        crossBranchConflicts: [],
        conflictedBookingIds: [1, 2],
        malformedBookingIds: [],
        parity: {
          bookingsChecked: 8,
          exactMatch: 7,
          missingClaims: 1,
          extraClaims: 0,
          mismatchBookingIds: [3],
          parityPct: 87.5,
        },
      },
      claimsMode: 'shadow',
      holdPolicyMode: 'enforce',
      shadowStats: {
        totalShadowAttempts: 5,
        exactAgreement: 5,
        claimConflictLegacyAllowed: 0,
        legacyConflictClaimAllowed: 0,
        holdPolicyMismatch: 0,
        crossBranchConflict: 0,
        expiredHoldReuse: 0,
        claimErrors: 0,
        latencyP50Ms: 12,
        latencyP95Ms: 30,
        sampleCount: 5,
      },
    });
    expect(gate.go).toBe(false);
    expect(gate.blockers).toContain('LEGACY_OVERLAPS_UNREVIEWED');
    expect(gate.blockers).toContain('BACKFILL_PARITY_NOT_100');
  });

  it('GO when migration+parity+reviewed+shadow clean', () => {
    resetSlotClaimShadowStatsForTests();
    logSlotClaimShadowEvent({
      operation: 'create',
      mismatchCategory: 'exact_agreement',
      latencyMs: 5,
    });
    const gate = evaluateEnforceReadiness({
      migration: {
        ready: true,
        tableExists: true,
        uniqueEmpSlot: true,
        indexHoldToken: true,
        indexBookingId: true,
        indexEmpTypeExpires: true,
        indexExpiresHold: true,
        indexes: [],
        missing: [],
      },
      backfill: {
        scanned: 3,
        claimsRequiredSlots: 18,
        claimed: 3,
        skippedConflict: 0,
        skippedAlreadyClaimed: 0,
        skippedInvalidInterval: 0,
        skippedMalformedAbsolute: 0,
        claimInsertErrors: 0,
        legacyOverlaps: [],
        crossBranchConflicts: [],
        conflictedBookingIds: [],
        malformedBookingIds: [],
        parity: {
          bookingsChecked: 3,
          exactMatch: 3,
          missingClaims: 0,
          extraClaims: 0,
          mismatchBookingIds: [],
          parityPct: 100,
        },
      },
      claimsMode: 'shadow',
      holdPolicyMode: 'enforce',
      shadowStats: getSlotClaimShadowStats(),
    });
    expect(gate.go).toBe(true);
    expect(gate.blockers).toEqual([]);
    expect(gate.checklist.dualGuardPreserved).toBe(true);
  });

  it('NO-GO without shadow samples', () => {
    resetSlotClaimShadowStatsForTests();
    const gate = evaluateEnforceReadiness({
      migration: {
        ready: true,
        tableExists: true,
        uniqueEmpSlot: true,
        indexHoldToken: true,
        indexBookingId: true,
        indexEmpTypeExpires: true,
        indexExpiresHold: true,
        indexes: [],
        missing: [],
      },
      backfill: {
        scanned: 1,
        claimsRequiredSlots: 6,
        claimed: 1,
        skippedConflict: 0,
        skippedAlreadyClaimed: 0,
        skippedInvalidInterval: 0,
        skippedMalformedAbsolute: 0,
        claimInsertErrors: 0,
        legacyOverlaps: [],
        crossBranchConflicts: [],
        conflictedBookingIds: [],
        malformedBookingIds: [],
        parity: {
          bookingsChecked: 1,
          exactMatch: 1,
          missingClaims: 0,
          extraClaims: 0,
          mismatchBookingIds: [],
          parityPct: 100,
        },
      },
      claimsMode: 'shadow',
      holdPolicyMode: 'enforce',
      shadowStats: getSlotClaimShadowStats(),
    });
    expect(gate.go).toBe(false);
    expect(gate.blockers).toContain('SHADOW_SAMPLES_REQUIRED');
  });
});

describe('B6.5 migration SQL is deploy-time only', () => {
  it('hot path modules do not CREATE TblBookingSlotClaim', () => {
    const files = [
      'src/lib/booking/claims/BookingSlotClaimSqlStore.ts',
      'src/lib/booking/claims/slotClaimIntegration.ts',
      'src/lib/booking/bookingHold.ts',
      'src/lib/booking/publicBookingCreate.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src).not.toMatch(/CREATE TABLE\s+dbo\.TblBookingSlotClaim/i);
      expect(src).not.toMatch(/ensureBookingSlotClaim/i);
    }
  });

  it('reschedule updates AbsoluteStartUtc/AbsoluteEndUtc', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/bookingRescheduleCore.ts'),
      'utf8',
    );
    expect(src).toContain('AbsoluteStartUtc = @absStart');
    expect(src).toContain('AbsoluteEndUtc = @absEnd');
    expect(src).toContain('PublicWorkDate = @workDate');
  });
});
