/**
 * Booking slot holds — Phase G.
 * TTL default 5 minutes. Expiry is evaluated by ExpiresAt (no cron required for correctness).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';

export const BOOKING_HOLD_TTL_MS = 5 * 60_000;
export const HOLD_CONFLICT = 'HOLD_CONFLICT' as const;

export type BookingHoldRecord = {
  holdId: number;
  branchId: number;
  empId: number;
  businessDate: string;
  startAt: Date;
  endAt: Date;
  expiresAt: Date;
  status: 'active' | 'consumed' | 'released' | 'expired';
  holdKey: string;
  sessionKey: string | null;
};

let ensured = false;

export async function ensureBookingHoldTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblBookingHold', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBookingHold (
        HoldID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BranchID INT NOT NULL,
        EmpID INT NOT NULL,
        BusinessDate DATE NOT NULL,
        StartAt DATETIME2 NOT NULL,
        EndAt DATETIME2 NOT NULL,
        ExpiresAt DATETIME2 NOT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_TblBookingHold_Status DEFAULT (N'active'),
        HoldKey NVARCHAR(80) NOT NULL,
        SessionKey NVARCHAR(120) NULL,
        ClientRequestId NVARCHAR(80) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TblBookingHold_Created DEFAULT (SYSUTCDATETIME()),
        ConsumedAt DATETIME2 NULL,
        ReleasedAt DATETIME2 NULL,
        CONSTRAINT UQ_TblBookingHold_HoldKey UNIQUE (HoldKey)
      );
      CREATE INDEX IX_TblBookingHold_Emp_Start_Active
        ON dbo.TblBookingHold (EmpID, StartAt, EndAt, Status, ExpiresAt);
      CREATE INDEX IX_TblBookingHold_Branch_Date
        ON dbo.TblBookingHold (BranchID, BusinessDate, Status);
    END
  `);
  ensured = true;
}

function rowToHold(r: Record<string, unknown>): BookingHoldRecord {
  return {
    holdId: Number(r.HoldID),
    branchId: Number(r.BranchID),
    empId: Number(r.EmpID),
    businessDate: String(r.BusinessDate).slice(0, 10),
    startAt: new Date(String(r.StartAt)),
    endAt: new Date(String(r.EndAt)),
    expiresAt: new Date(String(r.ExpiresAt)),
    status: String(r.Status) as BookingHoldRecord['status'],
    holdKey: String(r.HoldKey),
    sessionKey: r.SessionKey != null ? String(r.SessionKey) : null,
  };
}

/** Mark expired active holds as expired (best-effort; correctness uses ExpiresAt filter). */
export async function expireStaleBookingHolds(): Promise<number> {
  await ensureBookingHoldTable();
  const db = await getPool();
  const r = await db.request().query(`
    UPDATE dbo.TblBookingHold
    SET Status = N'expired'
    WHERE Status = N'active' AND ExpiresAt <= SYSUTCDATETIME()
  `);
  const n = Number(r.rowsAffected?.[0] ?? 0);
  if (n > 0) {
    logBookingAvailabilityMetric({
      event: 'hold_expired',
      affectedCount: n,
    });
  }
  return n;
}

export async function createBookingHold(input: {
  branchId: number;
  empId: number;
  businessDate: string;
  startAt: Date;
  endAt: Date;
  holdKey: string;
  sessionKey?: string | null;
  clientRequestId?: string | null;
  ttlMs?: number;
}): Promise<BookingHoldRecord> {
  await ensureBookingHoldTable();
  await expireStaleBookingHolds();

  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error('HOLD_INVALID_INTERVAL');
  }

  const db = await getPool();
  const ttl = input.ttlMs ?? BOOKING_HOLD_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  // Conflict with another active unexpired hold (different key)
  const conflict = await db
    .request()
    .input('empId', sql.Int, input.empId)
    .input('startAt', sql.DateTime2, input.startAt)
    .input('endAt', sql.DateTime2, input.endAt)
    .input('holdKey', sql.NVarChar(80), input.holdKey)
    .query(`
      SELECT TOP 1 HoldID
      FROM dbo.TblBookingHold
      WHERE EmpID = @empId
        AND Status = N'active'
        AND ExpiresAt > SYSUTCDATETIME()
        AND HoldKey <> @holdKey
        AND StartAt < @endAt
        AND EndAt > @startAt
    `);
  if (conflict.recordset[0]) {
    logBookingAvailabilityMetric({
      event: 'hold_conflict',
      reasonCode: HOLD_CONFLICT,
      branchId: input.branchId,
      empId: input.empId,
      businessDate: input.businessDate,
    });
    throw Object.assign(new Error(HOLD_CONFLICT), { code: HOLD_CONFLICT });
  }

  try {
    const ins = await db
      .request()
      .input('branchId', sql.Int, input.branchId)
      .input('empId', sql.Int, input.empId)
      .input('businessDate', sql.Date, input.businessDate)
      .input('startAt', sql.DateTime2, input.startAt)
      .input('endAt', sql.DateTime2, input.endAt)
      .input('expiresAt', sql.DateTime2, expiresAt)
      .input('holdKey', sql.NVarChar(80), input.holdKey)
      .input('sessionKey', sql.NVarChar(120), input.sessionKey ?? null)
      .input('clientRequestId', sql.NVarChar(80), input.clientRequestId ?? null)
      .query(`
        INSERT INTO dbo.TblBookingHold (
          BranchID, EmpID, BusinessDate, StartAt, EndAt, ExpiresAt,
          Status, HoldKey, SessionKey, ClientRequestId
        )
        OUTPUT INSERTED.*
        VALUES (
          @branchId, @empId, @businessDate, @startAt, @endAt, @expiresAt,
          N'active', @holdKey, @sessionKey, @clientRequestId
        )
      `);
    const hold = rowToHold(ins.recordset[0] as Record<string, unknown>);
    logBookingAvailabilityMetric({
      event: 'hold_created',
      holdId: hold.holdId,
      branchId: hold.branchId,
      empId: hold.empId,
      businessDate: hold.businessDate,
    });
    return hold;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UQ_TblBookingHold_HoldKey|duplicate/i.test(msg)) {
      const existing = await db
        .request()
        .input('holdKey', sql.NVarChar(80), input.holdKey)
        .query(`
          SELECT TOP 1 * FROM dbo.TblBookingHold
          WHERE HoldKey = @holdKey AND Status = N'active' AND ExpiresAt > SYSUTCDATETIME()
        `);
      if (existing.recordset[0]) {
        return rowToHold(existing.recordset[0] as Record<string, unknown>);
      }
    }
    throw err;
  }
}

export async function consumeBookingHold(holdKey: string): Promise<boolean> {
  await ensureBookingHoldTable();
  const db = await getPool();
  const r = await db
    .request()
    .input('holdKey', sql.NVarChar(80), holdKey)
    .query(`
      UPDATE dbo.TblBookingHold
      SET Status = N'consumed', ConsumedAt = SYSUTCDATETIME()
      WHERE HoldKey = @holdKey AND Status = N'active'
    `);
  const ok = Number(r.rowsAffected?.[0] ?? 0) > 0;
  if (ok) {
    logBookingAvailabilityMetric({ event: 'hold_consumed', extra: { holdKey } });
  }
  return ok;
}

export async function releaseBookingHold(holdKey: string): Promise<boolean> {
  await ensureBookingHoldTable();
  const db = await getPool();
  const r = await db
    .request()
    .input('holdKey', sql.NVarChar(80), holdKey)
    .query(`
      UPDATE dbo.TblBookingHold
      SET Status = N'released', ReleasedAt = SYSUTCDATETIME()
      WHERE HoldKey = @holdKey AND Status = N'active'
    `);
  const ok = Number(r.rowsAffected?.[0] ?? 0) > 0;
  if (ok) {
    logBookingAvailabilityMetric({ event: 'hold_released', extra: { holdKey } });
  }
  return ok;
}

/** Active unexpired holds overlapping [startMs, endMs) for employee (global). */
export async function listActiveBookingHoldsForEmployee(args: {
  empId: number;
  rangeStart: Date;
  rangeEnd: Date;
  excludeHoldKey?: string | null;
}): Promise<Array<{ startAt: Date; endAt: Date; holdId: number; branchId: number }>> {
  await ensureBookingHoldTable();
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('rangeStart', sql.DateTime2, args.rangeStart)
    .input('rangeEnd', sql.DateTime2, args.rangeEnd)
    .input('excludeHoldKey', sql.NVarChar(80), args.excludeHoldKey ?? null)
    .query(`
      SELECT HoldID, BranchID, StartAt, EndAt
      FROM dbo.TblBookingHold
      WHERE EmpID = @empId
        AND Status = N'active'
        AND ExpiresAt > SYSUTCDATETIME()
        AND StartAt < @rangeEnd
        AND EndAt > @rangeStart
        AND (@excludeHoldKey IS NULL OR HoldKey <> @excludeHoldKey)
    `);
  return r.recordset.map((row: Record<string, unknown>) => ({
    holdId: Number(row.HoldID),
    branchId: Number(row.BranchID),
    startAt: new Date(String(row.StartAt)),
    endAt: new Date(String(row.EndAt)),
  }));
}

export async function assertNoHoldConflict(args: {
  empId: number;
  startAt: Date;
  endAt: Date;
  excludeHoldKey?: string | null;
}): Promise<void> {
  const holds = await listActiveBookingHoldsForEmployee({
    empId: args.empId,
    rangeStart: args.startAt,
    rangeEnd: args.endAt,
    excludeHoldKey: args.excludeHoldKey,
  });
  if (holds.length > 0) {
    logBookingAvailabilityMetric({
      event: 'hold_conflict',
      reasonCode: HOLD_CONFLICT,
      empId: args.empId,
      holdId: holds[0]?.holdId ?? null,
    });
    throw Object.assign(new Error(HOLD_CONFLICT), { code: HOLD_CONFLICT });
  }
}
