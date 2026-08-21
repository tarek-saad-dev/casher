/**
 * Booking V2 B7B — staged read cutover control (flags, deterministic canary, metrics).
 *
 * Kill switch: BOOKING_V2_READ_MODE=legacy (no deploy).
 * Write path is untouched.
 */

export type BookingV2ReadMode = 'legacy' | 'shadow' | 'canary' | 'v2';

export type BookingV2ReadDecision = {
  mode: BookingV2ReadMode;
  /** Serve V2 FreeMask as the user-facing response. */
  serveV2: boolean;
  /** Run forward shadow (Legacy authoritative, compare V2 async). */
  forwardShadow: boolean;
  /** Run reverse shadow (V2 authoritative, sample-compare Legacy async). */
  reverseShadow: boolean;
  canaryPercent: number;
  canaryBucket: number | null;
  canaryKey: string | null;
  reason: string;
};

/**
 * Default: shadow (legacy response + B7A.5 sampling) — matches post-B7A.5 staging.
 * Production kill: set BOOKING_V2_READ_MODE=legacy.
 */
export function resolveBookingV2ReadMode(
  env: NodeJS.ProcessEnv = process.env,
): BookingV2ReadMode {
  const raw = String(env.BOOKING_V2_READ_MODE ?? 'shadow').toLowerCase().trim();
  if (raw === 'legacy' || raw === 'shadow' || raw === 'canary' || raw === 'v2') {
    return raw;
  }
  return 'shadow';
}

export function resolveBookingV2ReadCanaryPercent(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.BOOKING_V2_READ_CANARY_PERCENT ?? '10');
  if (!Number.isFinite(n)) return 10;
  return Math.min(100, Math.max(0, Math.floor(n)));
}

/**
 * Stable 0..99 bucket from an opaque canary key (FNV-1a 32-bit).
 * Same key → same bucket → sticky Legacy/V2 assignment.
 */
export function bookingV2CanaryBucket(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * Build a stable canary key from request-ish inputs.
 * Prefer explicit client/session id; never use Math.random.
 */
export function buildBookingV2CanaryKey(parts: {
  clientId?: string | null;
  sessionId?: string | null;
  branchCode?: string | null;
  empId?: number | null;
  userAgent?: string | null;
  ip?: string | null;
}): string {
  const explicit =
    (parts.clientId && String(parts.clientId).trim()) ||
    (parts.sessionId && String(parts.sessionId).trim()) ||
    '';
  if (explicit) return `id:${explicit}`;
  return [
    'fb',
    parts.branchCode ?? '',
    parts.empId != null ? String(parts.empId) : 'ANY',
    parts.userAgent ?? '',
    parts.ip ?? '',
  ].join('|');
}

export function resolveBookingV2ReadDecision(opts?: {
  env?: NodeJS.ProcessEnv;
  canaryKey?: string | null;
  /** Force V2 for internal probes (admin readiness step). Does not change ops engine envelope. */
  forceV2?: boolean;
}): BookingV2ReadDecision {
  const env = opts?.env ?? process.env;
  const mode = resolveBookingV2ReadMode(env);
  const canaryPercent = resolveBookingV2ReadCanaryPercent(env);
  const canaryKey = opts?.canaryKey ? String(opts.canaryKey) : null;

  if (opts?.forceV2) {
    return {
      mode,
      serveV2: true,
      forwardShadow: false,
      reverseShadow: true,
      canaryPercent,
      canaryBucket: null,
      canaryKey,
      reason: 'force_v2',
    };
  }

  if (mode === 'legacy') {
    return {
      mode,
      serveV2: false,
      forwardShadow: false,
      reverseShadow: false,
      canaryPercent,
      canaryBucket: null,
      canaryKey,
      reason: 'mode_legacy_kill_switch',
    };
  }

  if (mode === 'shadow') {
    return {
      mode,
      serveV2: false,
      forwardShadow: true,
      reverseShadow: false,
      canaryPercent,
      canaryBucket: null,
      canaryKey,
      reason: 'mode_shadow_legacy_authoritative',
    };
  }

  if (mode === 'v2') {
    return {
      mode,
      serveV2: true,
      forwardShadow: false,
      reverseShadow: true,
      canaryPercent,
      canaryBucket: null,
      canaryKey,
      reason: 'mode_v2_full',
    };
  }

  // canary
  const key = canaryKey || 'anonymous';
  const bucket = bookingV2CanaryBucket(key);
  const serveV2 = bucket < canaryPercent;
  return {
    mode: 'canary',
    serveV2,
    forwardShadow: !serveV2,
    reverseShadow: serveV2,
    canaryPercent,
    canaryBucket: bucket,
    canaryKey: key,
    reason: serveV2
      ? `canary_v2_bucket_${bucket}_lt_${canaryPercent}`
      : `canary_legacy_bucket_${bucket}_ge_${canaryPercent}`,
  };
}

/** In-process cutover metrics (not SoT — ops/diagnostics). */
const cutoverMetrics = {
  legacy: {
    requests: 0,
    errors: 0,
    totalMs: [] as number[],
    dbMs: [] as number[],
    queryCounts: [] as number[],
    slotCounts: [] as number[],
  },
  v2: {
    requests: 0,
    errors: 0,
    fallbacks: 0,
    totalMs: [] as number[],
    dbMs: [] as number[],
    queryCounts: [] as number[],
    slotCounts: [] as number[],
    composeMs: [] as number[],
  },
};

function pushCapped(arr: number[], v: number, max = 500) {
  arr.push(v);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function engineSummary(e: {
  requests: number;
  errors: number;
  fallbacks?: number;
  totalMs: number[];
  dbMs: number[];
  queryCounts: number[];
  slotCounts: number[];
  composeMs?: number[];
}) {
  const totalSorted = [...e.totalMs].sort((a, b) => a - b);
  const dbSorted = [...e.dbMs].sort((a, b) => a - b);
  const qSorted = [...e.queryCounts].sort((a, b) => a - b);
  const composeSorted = e.composeMs
    ? [...e.composeMs].sort((a, b) => a - b)
    : [];
  return {
    requestCount: e.requests,
    errorCount: e.errors,
    errorRate: e.requests === 0 ? 0 : e.errors / e.requests,
    fallbackCount: e.fallbacks ?? 0,
    p50: percentile(totalSorted, 50),
    p95: percentile(totalSorted, 95),
    dbMsP50: percentile(dbSorted, 50),
    dbMsP95: percentile(dbSorted, 95),
    queryCountP50: percentile(qSorted, 50),
    queryCountP95: percentile(qSorted, 95),
    composeMsP50: composeSorted.length ? percentile(composeSorted, 50) : null,
    slotCountAvg:
      e.slotCounts.length === 0
        ? null
        : e.slotCounts.reduce((a, b) => a + b, 0) / e.slotCounts.length,
  };
}

export function recordBookingV2ReadMetric(args: {
  engine: 'legacy' | 'v2';
  ok: boolean;
  totalMs?: number;
  dbMs?: number;
  queryCount?: number;
  slotCount?: number;
  composeMs?: number;
  fallback?: boolean;
}): void {
  const e = cutoverMetrics[args.engine];
  e.requests += 1;
  if (!args.ok) e.errors += 1;
  if (args.engine === 'v2' && args.fallback) {
    cutoverMetrics.v2.fallbacks += 1;
  }
  if (args.totalMs != null) pushCapped(e.totalMs, args.totalMs);
  if (args.dbMs != null) pushCapped(e.dbMs, args.dbMs);
  if (args.queryCount != null) pushCapped(e.queryCounts, args.queryCount);
  if (args.slotCount != null) pushCapped(e.slotCounts, args.slotCount);
  if (args.engine === 'v2' && args.composeMs != null) {
    pushCapped(cutoverMetrics.v2.composeMs, args.composeMs);
  }
}

export function getBookingV2ReadCutoverMetrics() {
  return {
    mode: resolveBookingV2ReadMode(),
    canaryPercent: resolveBookingV2ReadCanaryPercent(),
    legacy: engineSummary(cutoverMetrics.legacy),
    v2: engineSummary(cutoverMetrics.v2),
  };
}

export function __resetBookingV2ReadCutoverMetricsForTests(): void {
  for (const eng of [cutoverMetrics.legacy, cutoverMetrics.v2] as const) {
    eng.requests = 0;
    eng.errors = 0;
    eng.totalMs = [];
    eng.dbMs = [];
    eng.queryCounts = [];
    eng.slotCounts = [];
  }
  cutoverMetrics.v2.fallbacks = 0;
  cutoverMetrics.v2.composeMs = [];
}

export function logBookingV2ReadFallback(args: {
  surface: 'available-slots' | 'available-days';
  error: string;
  branchId?: number;
  businessDate?: string;
  canaryKey?: string | null;
}): void {
  console.warn(
    '[booking-v2-read]',
    JSON.stringify({
      event: 'V2_READ_FALLBACK',
      ...args,
    }),
  );
}

/** Technical resolver failures may fall back; semantic public errors must not. */
export function isBookingV2TechnicalFailure(err: unknown): boolean {
  if (err == null) return true;
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code?: unknown }).code ?? '');
    // PublicBookingAvailabilityError codes — rethrow, do not hide.
    if (
      code &&
      /^[A-Z_]+$/.test(code) &&
      (err as { name?: string }).name === 'PublicBookingAvailabilityError'
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Extract sticky canary identity for B7B read cutover.
 * Prefer explicit client/session; never Math.random.
 */
export function extractBookingV2CanaryKeyFromRequest(req: {
  headers: { get(name: string): string | null };
  url?: string;
}): string {
  const sp = req.url ? new URL(req.url).searchParams : null;
  const clientId =
    req.headers.get('x-booking-canary-key') ||
    req.headers.get('x-client-id') ||
    sp?.get('canaryKey') ||
    null;
  const cookie = req.headers.get('cookie') || '';
  const sessionMatch = cookie.match(
    /(?:^|;\s*)(?:booking_canary|booking_session)=([^;]+)/i,
  );
  const sessionId = sessionMatch?.[1]
    ? decodeURIComponent(sessionMatch[1])
    : null;
  return buildBookingV2CanaryKey({
    clientId,
    sessionId,
    branchCode: sp?.get('branchCode') ?? sp?.get('branch') ?? null,
    empId: sp?.get('empId') ? Number(sp.get('empId')) : null,
    userAgent: req.headers.get('user-agent'),
    ip:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null,
  });
}
