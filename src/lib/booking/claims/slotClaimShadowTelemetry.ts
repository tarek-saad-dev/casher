/**
 * B6.5 — structured shadow telemetry + in-process monitoring stats.
 */

export type SlotClaimShadowOperation =
  | 'hold'
  | 'create'
  | 'cancel'
  | 'reschedule'
  | 'convert'
  | 'hold_policy'
  | 'backfill'
  | 'verify';

export type SlotClaimMismatchCategory =
  | 'exact_agreement'
  | 'claim_conflict_legacy_allowed'
  | 'legacy_conflict_claim_allowed'
  | 'hold_policy_mismatch'
  | 'cross_branch_conflict'
  | 'expired_hold_reuse'
  | 'claim_error'
  | 'none';

export type SlotClaimShadowEvent = {
  operation: SlotClaimShadowOperation;
  requestId?: string | null;
  empId?: number | null;
  branchId?: number | null;
  businessDate?: string | null;
  startAtMs?: number | null;
  endAtMs?: number | null;
  legacyDecision?: 'allow' | 'deny' | 'n/a' | string | null;
  claimDecision?: 'allow' | 'deny' | 'n/a' | 'conflict' | string | null;
  conflictOwner?: string | null;
  reasonCode?: string | null;
  mismatchCategory?: SlotClaimMismatchCategory | null;
  latencyMs?: number | null;
  bookingId?: number | null;
  holdToken?: string | null;
  extra?: Record<string, string | number | boolean | null>;
};

type ShadowStats = {
  totalAttempts: number;
  exactAgreement: number;
  claimConflictLegacyAllowed: number;
  legacyConflictClaimAllowed: number;
  holdPolicyMismatch: number;
  crossBranchConflict: number;
  expiredHoldReuse: number;
  claimErrors: number;
  latenciesMs: number[];
};

const stats: ShadowStats = {
  totalAttempts: 0,
  exactAgreement: 0,
  claimConflictLegacyAllowed: 0,
  legacyConflictClaimAllowed: 0,
  holdPolicyMismatch: 0,
  crossBranchConflict: 0,
  expiredHoldReuse: 0,
  claimErrors: 0,
  latenciesMs: [],
};

const MAX_LATENCY_SAMPLES = 5_000;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

export function resetSlotClaimShadowStatsForTests(): void {
  stats.totalAttempts = 0;
  stats.exactAgreement = 0;
  stats.claimConflictLegacyAllowed = 0;
  stats.legacyConflictClaimAllowed = 0;
  stats.holdPolicyMismatch = 0;
  stats.crossBranchConflict = 0;
  stats.expiredHoldReuse = 0;
  stats.claimErrors = 0;
  stats.latenciesMs.length = 0;
}

export function recordSlotClaimShadowSample(args: {
  mismatchCategory?: SlotClaimMismatchCategory | null;
  latencyMs?: number | null;
}): void {
  stats.totalAttempts++;
  const cat = args.mismatchCategory ?? 'none';
  switch (cat) {
    case 'exact_agreement':
      stats.exactAgreement++;
      break;
    case 'claim_conflict_legacy_allowed':
      stats.claimConflictLegacyAllowed++;
      break;
    case 'legacy_conflict_claim_allowed':
      stats.legacyConflictClaimAllowed++;
      break;
    case 'hold_policy_mismatch':
      stats.holdPolicyMismatch++;
      break;
    case 'cross_branch_conflict':
      stats.crossBranchConflict++;
      break;
    case 'expired_hold_reuse':
      stats.expiredHoldReuse++;
      break;
    case 'claim_error':
      stats.claimErrors++;
      break;
    default:
      break;
  }
  if (typeof args.latencyMs === 'number' && Number.isFinite(args.latencyMs)) {
    stats.latenciesMs.push(args.latencyMs);
    if (stats.latenciesMs.length > MAX_LATENCY_SAMPLES) {
      stats.latenciesMs.splice(0, stats.latenciesMs.length - MAX_LATENCY_SAMPLES);
    }
  }
}

export function getSlotClaimShadowStats(): {
  totalShadowAttempts: number;
  exactAgreement: number;
  claimConflictLegacyAllowed: number;
  legacyConflictClaimAllowed: number;
  holdPolicyMismatch: number;
  crossBranchConflict: number;
  expiredHoldReuse: number;
  claimErrors: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  sampleCount: number;
} {
  const sorted = [...stats.latenciesMs].sort((a, b) => a - b);
  return {
    totalShadowAttempts: stats.totalAttempts,
    exactAgreement: stats.exactAgreement,
    claimConflictLegacyAllowed: stats.claimConflictLegacyAllowed,
    legacyConflictClaimAllowed: stats.legacyConflictClaimAllowed,
    holdPolicyMismatch: stats.holdPolicyMismatch,
    crossBranchConflict: stats.crossBranchConflict,
    expiredHoldReuse: stats.expiredHoldReuse,
    claimErrors: stats.claimErrors,
    latencyP50Ms: percentile(sorted, 50),
    latencyP95Ms: percentile(sorted, 95),
    sampleCount: stats.latenciesMs.length,
  };
}

/** Structured single-line log for aggregators — no customer PII. */
export function logSlotClaimShadowEvent(event: SlotClaimShadowEvent): void {
  recordSlotClaimShadowSample({
    mismatchCategory: event.mismatchCategory,
    latencyMs: event.latencyMs,
  });
  console.info(
    '[booking-slot-claim-shadow]',
    JSON.stringify({
      ...event,
      absoluteStartUtc:
        event.startAtMs != null ? new Date(event.startAtMs).toISOString() : null,
      absoluteEndUtc:
        event.endAtMs != null ? new Date(event.endAtMs).toISOString() : null,
      at: new Date().toISOString(),
    }),
  );
}
