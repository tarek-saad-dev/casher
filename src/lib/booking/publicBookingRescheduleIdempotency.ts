/**
 * Public booking reschedule idempotency (TblPublicBookingRescheduleRequest).
 * Mirrors cancel/create durable claim semantics.
 */
import 'server-only';
import crypto from 'crypto';
import { getPool, sql } from '@/lib/db';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';

let ensured = false;

export async function ensurePublicBookingRescheduleIdempotencyTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblPublicBookingRescheduleRequest'
    )
    BEGIN
      CREATE TABLE dbo.TblPublicBookingRescheduleRequest (
        RescheduleRequestID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TblPublicBookingRescheduleRequest PRIMARY KEY,
        IdempotencyKey      NVARCHAR(128) NOT NULL,
        RequestFingerprint  CHAR(64) NOT NULL,
        BookingCode         NVARCHAR(32) NOT NULL,
        Status              NVARCHAR(24) NOT NULL,
        ResponseJson        NVARCHAR(MAX) NULL,
        LastErrorCode       NVARCHAR(64) NULL,
        NotificationSent    BIT NOT NULL CONSTRAINT DF_PBCResched_NotificationSent DEFAULT (0),
        CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_PBCResched_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CompletedAt         DATETIME2(0) NULL,
        CONSTRAINT UQ_TblPublicBookingRescheduleRequest_Key UNIQUE (IdempotencyKey)
      );
      CREATE INDEX IX_PBCResched_Code ON dbo.TblPublicBookingRescheduleRequest (BookingCode, Status);
    END
  `);
  ensured = true;
}

export const BOOKING_RESCHEDULE_CONTRACT_VERSION = 'booking-reschedule-v1';

export function buildRescheduleRequestFingerprint(input: {
  contractVersion: string;
  bookingCode: string;
  ownershipDigest: string;
  workDate: string;
  time: string;
  empId: number;
  branchCode: string;
  serviceIds: number[];
}): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        v: input.contractVersion,
        code: input.bookingCode,
        own: input.ownershipDigest,
        workDate: input.workDate,
        time: input.time,
        empId: input.empId,
        branchCode: input.branchCode,
        serviceIds: [...input.serviceIds].sort((a, b) => a - b),
      }),
    )
    .digest('hex');
}

export type RescheduleIdempotencyRow = {
  RescheduleRequestID: number;
  IdempotencyKey: string;
  RequestFingerprint: string;
  BookingCode: string;
  Status: string;
  ResponseJson: string | null;
  LastErrorCode: string | null;
  NotificationSent: boolean;
};

export class RescheduleIdempotencyConflictError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'RescheduleIdempotencyConflictError';
    this.code = code;
  }
}

type ClaimResult =
  | { kind: 'replay'; row: RescheduleIdempotencyRow }
  | { kind: 'claimed'; requestId: number };

async function claimWithFactory(
  makeRequest: () => sql.Request,
  args: { idempotencyKey: string; requestFingerprint: string; bookingCode: string },
): Promise<ClaimResult> {
  const existing = await makeRequest()
    .input('key', sql.NVarChar(128), args.idempotencyKey)
    .query(`
      SELECT TOP 1
        RescheduleRequestID, IdempotencyKey, RequestFingerprint, BookingCode, Status,
        ResponseJson, LastErrorCode, CAST(NotificationSent AS BIT) AS NotificationSent
      FROM dbo.TblPublicBookingRescheduleRequest WITH (UPDLOCK, HOLDLOCK)
      WHERE IdempotencyKey = @key
    `);
  const row = existing.recordset[0] as RescheduleIdempotencyRow | undefined;
  if (row) {
    if (row.RequestFingerprint !== args.requestFingerprint) {
      throw new RescheduleIdempotencyConflictError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
    }
    if (row.Status === 'COMPLETED' && row.ResponseJson) {
      return { kind: 'replay', row };
    }
    if (row.Status === 'PENDING') {
      throw new RescheduleIdempotencyConflictError('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    }
    await makeRequest()
      .input('id', sql.BigInt, row.RescheduleRequestID)
      .query(`
        UPDATE dbo.TblPublicBookingRescheduleRequest
        SET Status = N'PENDING', LastErrorCode = NULL, CompletedAt = NULL
        WHERE RescheduleRequestID = @id
      `);
    return { kind: 'claimed', requestId: Number(row.RescheduleRequestID) };
  }

  const ins = await makeRequest()
    .input('key', sql.NVarChar(128), args.idempotencyKey)
    .input('fp', sql.Char(64), args.requestFingerprint)
    .input('code', sql.NVarChar(32), args.bookingCode)
    .query(`
      INSERT INTO dbo.TblPublicBookingRescheduleRequest
        (IdempotencyKey, RequestFingerprint, BookingCode, Status)
      OUTPUT INSERTED.RescheduleRequestID
      VALUES (@key, @fp, @code, N'PENDING')
    `);
  return { kind: 'claimed', requestId: Number(ins.recordset[0].RescheduleRequestID) };
}

export async function claimRescheduleIdempotencyAutonomous(args: {
  idempotencyKey: string;
  requestFingerprint: string;
  bookingCode: string;
}): Promise<ClaimResult> {
  await ensurePublicBookingRescheduleIdempotencyTable();
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const result = await claimWithFactory(() => new sql.Request(tx), args);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function completeRescheduleIdempotencySuccess(
  requestId: number,
  responseJson: string,
): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('id', sql.BigInt, requestId)
    .input('json', sql.NVarChar(sql.MAX), responseJson)
    .query(`
      UPDATE dbo.TblPublicBookingRescheduleRequest
      SET Status = N'COMPLETED',
          ResponseJson = @json,
          CompletedAt = SYSUTCDATETIME(),
          LastErrorCode = NULL
      WHERE RescheduleRequestID = @id
    `);
}

export async function markRescheduleIdempotencyFailed(
  requestId: number | null,
  errorCode: string,
): Promise<void> {
  if (requestId == null) return;
  try {
    const db = await getPool();
    await db
      .request()
      .input('id', sql.BigInt, requestId)
      .input('err', sql.NVarChar(64), errorCode)
      .query(`
        UPDATE dbo.TblPublicBookingRescheduleRequest
        SET Status = N'FAILED', LastErrorCode = @err, CompletedAt = SYSUTCDATETIME()
        WHERE RescheduleRequestID = @id AND Status = N'PENDING'
      `);
  } catch {
    /* best-effort */
  }
}
