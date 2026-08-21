/**
 * Booking V2 B7A.5 — shadow parity (Legacy engine vs V2 FreeMask path).
 *
 * Legacy response is always served. Shadow runs async / sampled and never
 * blocks the client response when fire-and-forget is used.
 */

export type ShadowSlotKey = string; // `${dayOffset}|${time}` or with emp: `${empId}|${dayOffset}|${time}`

export type AvailabilityShadowMismatchReason =
  | 'EFFECTIVE_DAY_MISMATCH'
  | 'BOOKING_OCCUPANCY_MISMATCH'
  | 'HOLD_OCCUPANCY_MISMATCH'
  | 'QUEUE_OCCUPANCY_MISMATCH'
  | 'MIN_NOTICE_MISMATCH'
  | 'AVAILABLE_DAY_MISMATCH'
  | 'DURATION_MISMATCH'
  | 'OVERNIGHT_MAPPING_MISMATCH'
  | 'UNKNOWN';

export type AvailabilityShadowCompareInput = {
  requestId?: string | null;
  employeeId: number | null;
  branchId: number;
  businessDate: string;
  durationMinutes: number;
  legacySlots: Array<{ time: string; dayOffset: 0 | 1; empId?: number | null }>;
  v2Slots: Array<{ time: string; dayOffset: 0 | 1; employeeId?: number }>;
  availabilityRevision?: string | null;
  changeMask?: string[];
  kind?: 'slots' | 'available-days';
  nowMs?: number;
  minNoticeMinutes?: number;
  /** Optional diagnostic hints from V2 compose. */
  hints?: {
    effectiveEmpty?: boolean;
    bookingOccupiedStarts?: string[];
    holdOccupiedStarts?: string[];
    queueOccupiedStarts?: string[];
    legacyIsAvailable?: boolean;
    v2IsAvailable?: boolean;
  };
  /** Timing for this sample (ms). */
  timing?: {
    legacyMs?: number;
    v2TotalMs?: number;
    v2DbMs?: number;
    v2ComposeMs?: number;
    v2QueryCount?: number;
  };
};

export type AvailabilityShadowMismatchReport = {
  requestId: string | null;
  employeeId: number | null;
  branchId: number;
  businessDate: string;
  durationMinutes: number;
  kind: 'slots' | 'available-days';
  legacySlots: string[];
  v2Slots: string[];
  missingInV2: string[];
  extraInV2: string[];
  availabilityRevision: string | null;
  changeMask: string[];
  reason: AvailabilityShadowMismatchReason;
  matched: boolean;
  timing: {
    legacyMs: number | null;
    v2TotalMs: number | null;
    v2DbMs: number | null;
    v2ComposeMs: number | null;
    v2QueryCount: number | null;
  };
};

export function slotKey(slot: {
  time: string;
  dayOffset: 0 | 1;
  empId?: number | null;
  employeeId?: number;
}): ShadowSlotKey {
  const emp = slot.empId ?? slot.employeeId;
  const base = `${slot.dayOffset}|${slot.time}`;
  return emp != null ? `${emp}|${base}` : base;
}

function looksOvernightKey(k: string): boolean {
  // emp|1|HH:MM or 1|HH:MM
  return /(?:^|\|)\|1\|/.test(`|${k}`) || k.includes('|1|') || k.startsWith('1|');
}

export function compareAvailabilityShadow(
  input: AvailabilityShadowCompareInput,
): AvailabilityShadowMismatchReport {
  const kind = input.kind ?? 'slots';
  const legacyKeys = input.legacySlots.map(slotKey).sort();
  const v2Keys = input.v2Slots.map(slotKey).sort();
  const legacySet = new Set(legacyKeys);
  const v2Set = new Set(v2Keys);
  const missingInV2 = legacyKeys.filter((k) => !v2Set.has(k));
  const extraInV2 = v2Keys.filter((k) => !legacySet.has(k));

  let matched = missingInV2.length === 0 && extraInV2.length === 0;

  if (kind === 'available-days' && input.hints) {
    const la = !!input.hints.legacyIsAvailable;
    const va = !!input.hints.v2IsAvailable;
    matched = la === va;
  }

  let reason: AvailabilityShadowMismatchReason = 'UNKNOWN';
  if (!matched) {
    if (kind === 'available-days') {
      reason = 'AVAILABLE_DAY_MISMATCH';
    } else if (input.hints?.effectiveEmpty && legacyKeys.length > 0) {
      reason = 'EFFECTIVE_DAY_MISMATCH';
    } else if (
      missingInV2.some((k) => input.hints?.queueOccupiedStarts?.includes(k)) ||
      (extraInV2.length === 0 && (input.hints?.queueOccupiedStarts?.length ?? 0) > 0)
    ) {
      reason = 'QUEUE_OCCUPANCY_MISMATCH';
    } else if (missingInV2.some((k) => input.hints?.holdOccupiedStarts?.includes(k))) {
      reason = 'HOLD_OCCUPANCY_MISMATCH';
    } else if (missingInV2.some((k) => input.hints?.bookingOccupiedStarts?.includes(k))) {
      reason = 'BOOKING_OCCUPANCY_MISMATCH';
    } else if (
      missingInV2.some(looksOvernightKey) ||
      extraInV2.some(looksOvernightKey)
    ) {
      reason = 'OVERNIGHT_MAPPING_MISMATCH';
    } else if (
      // Extras in V2 that legacy filtered as past/min-notice → V2 missed the filter
      extraInV2.length > 0 &&
      missingInV2.length === 0 &&
      input.nowMs != null
    ) {
      reason = 'MIN_NOTICE_MISMATCH';
    } else if ((input.changeMask?.length ?? 0) > 0) {
      reason = 'EFFECTIVE_DAY_MISMATCH';
    }
  }

  return {
    requestId: input.requestId ?? null,
    employeeId: input.employeeId,
    branchId: input.branchId,
    businessDate: input.businessDate,
    durationMinutes: input.durationMinutes,
    kind,
    legacySlots: legacyKeys,
    v2Slots: v2Keys,
    missingInV2,
    extraInV2,
    availabilityRevision: input.availabilityRevision ?? null,
    changeMask: input.changeMask ?? [],
    reason: matched ? 'UNKNOWN' : reason,
    matched,
    timing: {
      legacyMs: input.timing?.legacyMs ?? null,
      v2TotalMs: input.timing?.v2TotalMs ?? null,
      v2DbMs: input.timing?.v2DbMs ?? null,
      v2ComposeMs: input.timing?.v2ComposeMs ?? null,
      v2QueryCount: input.timing?.v2QueryCount ?? null,
    },
  };
}

export type BookingV2ShadowMode = 'off' | 'sample' | 'always';

/**
 * B7A.5: default to sample@0.1 unless explicitly off.
 * Low-traffic staging can set BOOKING_V2_SHADOW_MODE=always.
 */
export function resolveBookingV2ShadowMode(
  env: NodeJS.ProcessEnv = process.env,
): { mode: BookingV2ShadowMode; sampleRate: number } {
  const raw = String(env.BOOKING_V2_SHADOW_MODE ?? 'sample').toLowerCase();
  const mode: BookingV2ShadowMode =
    raw === 'always' || raw === 'sample' || raw === 'off' ? raw : 'sample';
  const sampleRate = Math.min(
    1,
    Math.max(0, Number(env.BOOKING_V2_SHADOW_SAMPLE_RATE ?? '0.1') || 0),
  );
  return { mode, sampleRate };
}

export function shouldRunBookingV2Shadow(opts?: {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
}): boolean {
  const { mode, sampleRate } = resolveBookingV2ShadowMode(opts?.env);
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  const rnd = opts?.random ?? Math.random;
  return rnd() < sampleRate;
}

export function logAvailabilityShadowMismatch(
  report: AvailabilityShadowMismatchReport,
): void {
  console.info(
    '[booking-v2-shadow]',
    JSON.stringify({
      event: report.matched ? 'parity_ok' : 'parity_mismatch',
      ...report,
    }),
  );
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/** In-process counters for acceptance / diagnostics (not a SoT). */
const shadowStats = {
  samples: 0,
  mismatches: 0,
  byReason: {} as Record<string, number>,
  byKind: { slots: 0, 'available-days': 0 } as Record<string, number>,
  legacyMs: [] as number[],
  v2TotalMs: [] as number[],
  v2DbMs: [] as number[],
  v2ComposeMs: [] as number[],
  v2QueryCounts: [] as number[],
};

export function recordShadowSample(report: AvailabilityShadowMismatchReport): void {
  shadowStats.samples += 1;
  shadowStats.byKind[report.kind] = (shadowStats.byKind[report.kind] ?? 0) + 1;
  if (!report.matched) {
    shadowStats.mismatches += 1;
    shadowStats.byReason[report.reason] =
      (shadowStats.byReason[report.reason] ?? 0) + 1;
  }
  if (report.timing.legacyMs != null) shadowStats.legacyMs.push(report.timing.legacyMs);
  if (report.timing.v2TotalMs != null) shadowStats.v2TotalMs.push(report.timing.v2TotalMs);
  if (report.timing.v2DbMs != null) shadowStats.v2DbMs.push(report.timing.v2DbMs);
  if (report.timing.v2ComposeMs != null) shadowStats.v2ComposeMs.push(report.timing.v2ComposeMs);
  if (report.timing.v2QueryCount != null) {
    shadowStats.v2QueryCounts.push(report.timing.v2QueryCount);
  }
}

function timingSummary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export function getShadowParityStats(): {
  samples: number;
  mismatches: number;
  mismatchPct: number;
  exactMatches: number;
  byReason: Record<string, number>;
  byKind: Record<string, number>;
  legacy: ReturnType<typeof timingSummary>;
  v2: ReturnType<typeof timingSummary> & {
    db: ReturnType<typeof timingSummary>;
    compose: ReturnType<typeof timingSummary>;
    queryCount: { n: number; avg: number | null; p95: number | null };
  };
} {
  const qSorted = [...shadowStats.v2QueryCounts].sort((a, b) => a - b);
  const qAvg =
    qSorted.length === 0
      ? null
      : qSorted.reduce((a, b) => a + b, 0) / qSorted.length;
  return {
    samples: shadowStats.samples,
    mismatches: shadowStats.mismatches,
    exactMatches: shadowStats.samples - shadowStats.mismatches,
    mismatchPct:
      shadowStats.samples === 0
        ? 0
        : (100 * shadowStats.mismatches) / shadowStats.samples,
    byReason: { ...shadowStats.byReason },
    byKind: { ...shadowStats.byKind },
    legacy: timingSummary(shadowStats.legacyMs),
    v2: {
      ...timingSummary(shadowStats.v2TotalMs),
      db: timingSummary(shadowStats.v2DbMs),
      compose: timingSummary(shadowStats.v2ComposeMs),
      queryCount: {
        n: qSorted.length,
        avg: qAvg,
        p95: percentile(qSorted, 95),
      },
    },
  };
}

export type CutoverReadiness = {
  ready: boolean;
  decision: 'GO' | 'NO-GO';
  reasons: string[];
  stats: ReturnType<typeof getShadowParityStats>;
};

/**
 * B7B gate — unexplained mismatches must be 0 on a meaningful live sample.
 */
export function evaluateReadCutoverReadiness(opts?: {
  minSamples?: number;
}): CutoverReadiness {
  const stats = getShadowParityStats();
  const minSamples = opts?.minSamples ?? 50;
  const reasons: string[] = [];

  if (stats.samples < minSamples) {
    reasons.push(
      `insufficient_samples:${stats.samples}<${minSamples}`,
    );
  }
  if (stats.mismatches > 0) {
    reasons.push(`unexplained_or_open_mismatches:${stats.mismatches}`);
    for (const [cat, n] of Object.entries(stats.byReason)) {
      if (n > 0) reasons.push(`category:${cat}=${n}`);
    }
  }
  if (stats.v2.p95 != null && stats.legacy.p95 != null && stats.v2.p95 > stats.legacy.p95 * 1.25) {
    reasons.push(
      `v2_p95_worse_than_legacy:${stats.v2.p95.toFixed(1)}>${(stats.legacy.p95 * 1.25).toFixed(1)}`,
    );
  }

  const ready = reasons.length === 0;
  return {
    ready,
    decision: ready ? 'GO' : 'NO-GO',
    reasons: ready ? ['all_gates_passed'] : reasons,
    stats,
  };
}

export function __resetShadowParityStatsForTests(): void {
  shadowStats.samples = 0;
  shadowStats.mismatches = 0;
  shadowStats.byReason = {};
  shadowStats.byKind = { slots: 0, 'available-days': 0 };
  shadowStats.legacyMs = [];
  shadowStats.v2TotalMs = [];
  shadowStats.v2DbMs = [];
  shadowStats.v2ComposeMs = [];
  shadowStats.v2QueryCounts = [];
}
