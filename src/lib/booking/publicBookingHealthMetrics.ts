/**
 * Booking Phase 8D — lightweight public-booking health samples (no PII / tokens).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';

export type PublicBookingHealthTimingFamily =
  | 'availability'
  | 'plan'
  | 'create'
  | 'cancel'
  | 'other';

export type PublicBookingHealthOutcome =
  | 'success'
  | 'failure'
  | 'idempotent_replay'
  | 'rate_limited'
  | 'mutation_outcome_unknown';

export type PublicBookingHealthSampleInput = {
  routeKey: string;
  outcome: PublicBookingHealthOutcome;
  errorCode?: string | null;
  durationMs: number;
  httpStatus: number;
};

const PLAN_TOKEN_ERROR_PREFIX = 'PLAN_TOKEN_';
const STUCK_PENDING_MINUTES = 5;
const SAMPLE_RETENTION_HOURS = 36;
const WINDOW_HOURS = 24;

let ensured = false;

/** Map route gate keys → timing families used in the 24h report. */
export function mapRouteKeyToTimingFamily(
  routeKey: string,
): PublicBookingHealthTimingFamily {
  switch (routeKey) {
    case 'available-days':
    case 'available-slots':
    case 'barber-available-slots':
    case 'cross-branch-availability':
    case 'barber-availability-days':
    case 'barber-availability-slots':
    case 'check-slot':
    case 'calendar':
      return 'availability';
    case 'plan':
      return 'plan';
    case 'create':
      return 'create';
    case 'cancel':
    case 'cancel-by-code':
      return 'cancel';
    default:
      return 'other';
  }
}

export function sanitizePublicBookingErrorCode(
  code: unknown,
): string | null {
  if (code == null) return null;
  const s = String(code).trim().toUpperCase();
  if (!s || s.length > 64) return null;
  if (!/^[A-Z][A-Z0-9_]*$/.test(s)) return null;
  return s;
}

export function percentileNearestRank(
  values: number[],
  p: number,
): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export async function ensurePublicBookingHealthSampleTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblPublicBookingHealthSample'
    )
    BEGIN
      CREATE TABLE dbo.TblPublicBookingHealthSample (
        SampleID        BIGINT IDENTITY(1,1) NOT NULL
          CONSTRAINT PK_TblPublicBookingHealthSample PRIMARY KEY,
        CreatedAtUtc    DATETIME2(0) NOT NULL
          CONSTRAINT DF_PBHealth_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
        RouteFamily     NVARCHAR(32) NOT NULL,
        RouteKey        NVARCHAR(48) NOT NULL,
        Outcome         NVARCHAR(32) NOT NULL,
        ErrorCode       NVARCHAR(64) NULL,
        DurationMs      INT NOT NULL,
        HttpStatus      SMALLINT NOT NULL
      );
      CREATE INDEX IX_PBHealth_CreatedAt
        ON dbo.TblPublicBookingHealthSample (CreatedAtUtc)
        INCLUDE (RouteFamily, Outcome, ErrorCode, DurationMs, HttpStatus);
    END
  `);
  ensured = true;
}

/** Reset ensure flag in tests. */
export function resetPublicBookingHealthEnsureForTests(): void {
  ensured = false;
}

/**
 * Persist one anonymized sample. Failures are swallowed so request path stays healthy.
 * Skipped under Vitest / NODE_ENV=test so unit tests never touch production DB.
 */
export async function recordPublicBookingHealthSample(
  input: PublicBookingHealthSampleInput,
): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
  // Sample ~10% — full-rate inserts contend with booking reads under pool pressure.
  if (Math.random() > 0.1) return;
  try {
    await ensurePublicBookingHealthSampleTable();
    const routeKey = String(input.routeKey || 'unknown').slice(0, 48);
    const family = mapRouteKeyToTimingFamily(routeKey);
    const outcome = input.outcome;
    const errorCode = sanitizePublicBookingErrorCode(input.errorCode);
    const durationMs = Math.max(
      0,
      Math.min(600_000, Math.round(Number(input.durationMs) || 0)),
    );
    const httpStatus = Math.max(
      100,
      Math.min(599, Math.round(Number(input.httpStatus) || 500)),
    );

    const db = await getPool();
    await db
      .request()
      .input('family', sql.NVarChar(32), family)
      .input('routeKey', sql.NVarChar(48), routeKey)
      .input('outcome', sql.NVarChar(32), outcome)
      .input('errorCode', sql.NVarChar(64), errorCode)
      .input('durationMs', sql.Int, durationMs)
      .input('httpStatus', sql.SmallInt, httpStatus)
      .query(`
        INSERT INTO dbo.TblPublicBookingHealthSample
          (RouteFamily, RouteKey, Outcome, ErrorCode, DurationMs, HttpStatus)
        VALUES (@family, @routeKey, @outcome, @errorCode, @durationMs, @httpStatus)
      `);

    // Best-effort prune (cheap; skips most writes)
    if (Math.random() < 0.02) {
      await db
        .request()
        .input('hours', sql.Int, SAMPLE_RETENTION_HOURS)
        .query(`
          DELETE FROM dbo.TblPublicBookingHealthSample
          WHERE CreatedAtUtc < DATEADD(hour, -@hours, SYSUTCDATETIME())
        `);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'public_booking.health_sample_failed',
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

export type PublicBookingHealthSummary = {
  windowHours: number;
  generatedAt: string;
  contractMode: string | null;
  create: {
    success: number;
    failure: number;
    idempotentReplay: number;
    byErrorCode: Record<string, number>;
    planTokenErrors: number;
    mutationOutcomeUnknown: number;
  };
  cancel: {
    success: number;
    failure: number;
    idempotentReplay: number;
    byErrorCode: Record<string, number>;
    mutationOutcomeUnknown: number;
  };
  rateLimitEvents: number;
  timingsMs: Record<
    PublicBookingHealthTimingFamily,
    { count: number; p50: number | null; p95: number | null }
  >;
  notes: string[];
};

function emptyTimings(): PublicBookingHealthSummary['timingsMs'] {
  return {
    availability: { count: 0, p50: null, p95: null },
    plan: { count: 0, p50: null, p95: null },
    create: { count: 0, p50: null, p95: null },
    cancel: { count: 0, p50: null, p95: null },
    other: { count: 0, p50: null, p95: null },
  };
}

function bump(map: Record<string, number>, key: string, n = 1) {
  map[key] = (map[key] || 0) + n;
}

/**
 * Build last-24h health summary from samples + durable create/cancel idempotency rows.
 * Never returns tokens, phones, names, or request bodies.
 */
export async function buildPublicBookingHealthSummary(args?: {
  windowHours?: number;
  contractMode?: string | null;
}): Promise<PublicBookingHealthSummary> {
  const windowHours = args?.windowHours ?? WINDOW_HOURS;
  await ensurePublicBookingHealthSampleTable();
  // Ensure idempotency tables exist (no-op if already present)
  const { ensurePublicBookingCreateIdempotencyTable } = await import(
    '@/lib/booking/publicBookingCreateIdempotency'
  );
  const { ensurePublicBookingCancelIdempotencyTable } = await import(
    '@/lib/booking/publicBookingCancelIdempotency'
  );
  await ensurePublicBookingCreateIdempotencyTable();
  await ensurePublicBookingCancelIdempotencyTable();

  const db = await getPool();
  const sinceParam = sql.Int;

  const createGroupsResult = await db
    .request()
    .input('hours', sinceParam, windowHours)
    .query(`
      SELECT Status, LastErrorCode, COUNT(*) AS Cnt
      FROM dbo.TblPublicBookingCreateRequest
      WHERE CreatedAt >= DATEADD(hour, -@hours, SYSUTCDATETIME())
      GROUP BY Status, LastErrorCode
    `);
  const createStuckResult = await db
    .request()
    .input('hours', sinceParam, windowHours)
    .input('stuckMin', sql.Int, STUCK_PENDING_MINUTES)
    .query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblPublicBookingCreateRequest
      WHERE Status = N'PENDING'
        AND CreatedAt >= DATEADD(hour, -@hours, SYSUTCDATETIME())
        AND CreatedAt < DATEADD(minute, -@stuckMin, SYSUTCDATETIME())
    `);

  const cancelGroupsResult = await db
    .request()
    .input('hours', sinceParam, windowHours)
    .query(`
      SELECT Status, LastErrorCode, COUNT(*) AS Cnt
      FROM dbo.TblPublicBookingCancelRequest
      WHERE CreatedAt >= DATEADD(hour, -@hours, SYSUTCDATETIME())
      GROUP BY Status, LastErrorCode
    `);
  const cancelStuckResult = await db
    .request()
    .input('hours', sinceParam, windowHours)
    .input('stuckMin', sql.Int, STUCK_PENDING_MINUTES)
    .query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblPublicBookingCancelRequest
      WHERE Status = N'PENDING'
        AND CreatedAt >= DATEADD(hour, -@hours, SYSUTCDATETIME())
        AND CreatedAt < DATEADD(minute, -@stuckMin, SYSUTCDATETIME())
    `);

  const samples = await db
    .request()
    .input('hours', sinceParam, windowHours)
    .query(`
      SELECT RouteFamily, RouteKey, Outcome, ErrorCode, DurationMs, HttpStatus
      FROM dbo.TblPublicBookingHealthSample
      WHERE CreatedAtUtc >= DATEADD(hour, -@hours, SYSUTCDATETIME())
    `);

  const create = {
    success: 0,
    failure: 0,
    idempotentReplay: 0,
    byErrorCode: {} as Record<string, number>,
    planTokenErrors: 0,
    mutationOutcomeUnknown: 0,
  };
  const cancel = {
    success: 0,
    failure: 0,
    idempotentReplay: 0,
    byErrorCode: {} as Record<string, number>,
    mutationOutcomeUnknown: 0,
  };

  const createGroups =
    (createGroupsResult.recordset as Array<{
      Status: string;
      LastErrorCode: string | null;
      Cnt: number;
    }>) || [];
  for (const row of createGroups) {
    const n = Number(row.Cnt) || 0;
    const status = String(row.Status || '').toUpperCase();
    const code = sanitizePublicBookingErrorCode(row.LastErrorCode);
    if (status === 'COMPLETED') create.success += n;
    else if (status === 'FAILED') {
      create.failure += n;
      if (code) {
        bump(create.byErrorCode, code, n);
        if (code.startsWith(PLAN_TOKEN_ERROR_PREFIX)) create.planTokenErrors += n;
      } else {
        bump(create.byErrorCode, 'UNKNOWN', n);
      }
    }
  }
  create.mutationOutcomeUnknown = Number(
    (createStuckResult.recordset as Array<{ Cnt: number }>)?.[0]?.Cnt || 0,
  );

  const cancelGroups =
    (cancelGroupsResult.recordset as Array<{
      Status: string;
      LastErrorCode: string | null;
      Cnt: number;
    }>) || [];
  for (const row of cancelGroups) {
    const n = Number(row.Cnt) || 0;
    const status = String(row.Status || '').toUpperCase();
    const code = sanitizePublicBookingErrorCode(row.LastErrorCode);
    if (status === 'COMPLETED') cancel.success += n;
    else if (status === 'FAILED') {
      cancel.failure += n;
      if (code) bump(cancel.byErrorCode, code, n);
      else bump(cancel.byErrorCode, 'UNKNOWN', n);
    }
  }
  cancel.mutationOutcomeUnknown = Number(
    (cancelStuckResult.recordset as Array<{ Cnt: number }>)?.[0]?.Cnt || 0,
  );

  let rateLimitEvents = 0;
  const durationBuckets: Record<PublicBookingHealthTimingFamily, number[]> = {
    availability: [],
    plan: [],
    create: [],
    cancel: [],
    other: [],
  };

  const sampleRows =
    (samples.recordset as Array<{
      RouteFamily: string;
      RouteKey: string;
      Outcome: string;
      ErrorCode: string | null;
      DurationMs: number;
      HttpStatus: number;
    }>) || [];

  const PRE_CLAIM_CREATE_CODES = new Set([
    'PLAN_TOKEN_REQUIRED',
    'PLAN_TOKEN_INVALID',
    'PLAN_TOKEN_EXPIRED',
    'PLAN_TOKEN_REQUEST_MISMATCH',
    'IDEMPOTENCY_KEY_REQUIRED',
    'INVALID_CUSTOMER',
    'INVALID_CUSTOMER_PHONE',
    'BRANCH_NOT_PUBLIC',
    'BRANCH_BOOKING_DISABLED',
    'BRANCH_REQUIRED',
    'INVALID_REQUEST',
    'RATE_LIMIT_EXCEEDED',
  ]);
  const PRE_CLAIM_CANCEL_CODES = new Set([
    'IDEMPOTENCY_KEY_REQUIRED',
    'INVALID_BOOKING_CODE',
    'RATE_LIMIT_EXCEEDED',
  ]);

  for (const row of sampleRows) {
    const family = (row.RouteFamily || 'other') as PublicBookingHealthTimingFamily;
    const bucket = durationBuckets[family] ?? durationBuckets.other;
    bucket.push(Number(row.DurationMs) || 0);

    const outcome = String(row.Outcome || '') as PublicBookingHealthOutcome;
    const code = sanitizePublicBookingErrorCode(row.ErrorCode);

    if (outcome === 'rate_limited') rateLimitEvents += 1;

    if (family === 'create') {
      if (outcome === 'idempotent_replay') create.idempotentReplay += 1;
      if (outcome === 'mutation_outcome_unknown') create.mutationOutcomeUnknown += 1;
      if (outcome === 'failure' && code && PRE_CLAIM_CREATE_CODES.has(code)) {
        create.failure += 1;
        bump(create.byErrorCode, code, 1);
        if (code.startsWith(PLAN_TOKEN_ERROR_PREFIX)) create.planTokenErrors += 1;
      }
    }
    if (family === 'cancel') {
      if (outcome === 'idempotent_replay') cancel.idempotentReplay += 1;
      if (outcome === 'mutation_outcome_unknown') cancel.mutationOutcomeUnknown += 1;
      if (outcome === 'failure' && code && PRE_CLAIM_CANCEL_CODES.has(code)) {
        // INVALID_BOOKING_CODE / IDEMPOTENCY may occur before claim; durable FAILED covers post-claim.
        if (
          code === 'IDEMPOTENCY_KEY_REQUIRED' ||
          code === 'INVALID_BOOKING_CODE' ||
          code === 'RATE_LIMIT_EXCEEDED'
        ) {
          cancel.failure += 1;
          bump(cancel.byErrorCode, code, 1);
        }
      }
    }
  }

  const timingsMs = emptyTimings();
  for (const family of Object.keys(durationBuckets) as PublicBookingHealthTimingFamily[]) {
    const vals = durationBuckets[family];
    timingsMs[family] = {
      count: vals.length,
      p50: percentileNearestRank(vals, 50),
      p95: percentileNearestRank(vals, 95),
    };
  }

  const notes: string[] = [
    'Create/cancel success|failure from TblPublicBooking*Request (idempotency).',
    'Idempotent replays and rate-limit events from TblPublicBookingHealthSample (post-8D wiring).',
    'mutation_outcome_unknown = stuck PENDING idempotency rows older than 5 minutes.',
    'No tokens, phones, names, or booking codes in this report.',
  ];

  return {
    windowHours,
    generatedAt: new Date().toISOString(),
    contractMode: args?.contractMode ?? process.env.PUBLIC_BOOKING_CONTRACT_MODE ?? null,
    create,
    cancel,
    rateLimitEvents,
    timingsMs,
    notes,
  };
}
