/**
 * Booking Phase 7B — durable cancel idempotency (TblPublicBookingCancelRequest).
 */
import 'server-only';
import type { Transaction } from 'mssql';
import crypto from 'crypto';
import { getPool, sql } from '@/lib/db';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';

let ensured = false;

export async function ensurePublicBookingCancelIdempotencyTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblPublicBookingCancelRequest'
    )
    BEGIN
      CREATE TABLE dbo.TblPublicBookingCancelRequest (
        CancelRequestID     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TblPublicBookingCancelRequest PRIMARY KEY,
        IdempotencyKey      NVARCHAR(128) NOT NULL,
        RequestFingerprint  CHAR(64) NOT NULL,
        BookingCode         NVARCHAR(32) NOT NULL,
        Status              NVARCHAR(24) NOT NULL,
        ResponseJson        NVARCHAR(MAX) NULL,
        LastErrorCode       NVARCHAR(64) NULL,
        NotificationSent    BIT NOT NULL CONSTRAINT DF_PBCCancel_NotificationSent DEFAULT (0),
        CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_PBCCancel_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CompletedAt         DATETIME2(0) NULL,
        CONSTRAINT UQ_TblPublicBookingCancelRequest_Key UNIQUE (IdempotencyKey)
      );
      CREATE INDEX IX_PBCCancel_Code ON dbo.TblPublicBookingCancelRequest (BookingCode, Status);
    END
  `);
  ensured = true;
}

export async function ensurePublicBookingCancelColumns(): Promise<void> {
  const db = await getPool();
  await db.request().query(`
    IF COL_LENGTH(N'dbo.Bookings', N'PublicCancelledAtUtc') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicCancelledAtUtc DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'PublicCancellationReasonCode') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicCancellationReasonCode NVARCHAR(64) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'PublicCancellationReasonText') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicCancellationReasonText NVARCHAR(250) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'PublicCancellationSource') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicCancellationSource NVARCHAR(40) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'PublicCancellationRequestID') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicCancellationRequestID BIGINT NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'UpdatedAt') IS NULL
      ALTER TABLE dbo.Bookings ADD UpdatedAt DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'CancelReason') IS NULL
      ALTER TABLE dbo.Bookings ADD CancelReason NVARCHAR(500) NULL;
  `);
}

export const BOOKING_CANCEL_CONTRACT_VERSION = 'booking-cancel-v1';

export function buildCancelRequestFingerprint(input: {
  contractVersion: string;
  bookingCode: string;
  ownershipDigest: string;
  reasonCode: string | null;
  reasonText: string | null;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        v: input.contractVersion,
        code: input.bookingCode,
        own: input.ownershipDigest,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText ?? '',
      }),
    )
    .digest('hex');
}

export type CancelIdempotencyRow = {
  CancelRequestID: number;
  IdempotencyKey: string;
  RequestFingerprint: string;
  BookingCode: string;
  Status: string;
  ResponseJson: string | null;
  LastErrorCode: string | null;
  NotificationSent: boolean;
};

export class CancelIdempotencyConflictError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'CancelIdempotencyConflictError';
    this.code = code;
  }
}

type ClaimResult =
  | { kind: 'replay'; row: CancelIdempotencyRow }
  | { kind: 'claimed'; requestId: number };

async function claimWithFactory(
  makeRequest: () => sql.Request,
  args: { idempotencyKey: string; requestFingerprint: string; bookingCode: string },
): Promise<ClaimResult> {
  const existing = await makeRequest()
    .input('key', sql.NVarChar(128), args.idempotencyKey)
    .query(`
      SELECT TOP 1
        CancelRequestID, IdempotencyKey, RequestFingerprint, BookingCode, Status,
        ResponseJson, LastErrorCode, CAST(NotificationSent AS BIT) AS NotificationSent
      FROM dbo.TblPublicBookingCancelRequest WITH (UPDLOCK, HOLDLOCK)
      WHERE IdempotencyKey = @key
    `);
  const row = existing.recordset[0] as CancelIdempotencyRow | undefined;
  if (row) {
    if (row.RequestFingerprint !== args.requestFingerprint) {
      throw new CancelIdempotencyConflictError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
    }
    if (row.Status === 'COMPLETED' && row.ResponseJson) {
      return { kind: 'replay', row };
    }
    if (row.Status === 'PENDING') {
      throw new CancelIdempotencyConflictError('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    }
    await makeRequest()
      .input('id', sql.BigInt, row.CancelRequestID)
      .query(`
        UPDATE dbo.TblPublicBookingCancelRequest
        SET Status = N'PENDING', LastErrorCode = NULL, CompletedAt = NULL
        WHERE CancelRequestID = @id
      `);
    return { kind: 'claimed', requestId: Number(row.CancelRequestID) };
  }

  const ins = await makeRequest()
    .input('key', sql.NVarChar(128), args.idempotencyKey)
    .input('fp', sql.Char(64), args.requestFingerprint)
    .input('code', sql.NVarChar(32), args.bookingCode)
    .query(`
      INSERT INTO dbo.TblPublicBookingCancelRequest
        (IdempotencyKey, RequestFingerprint, BookingCode, Status)
      OUTPUT INSERTED.CancelRequestID
      VALUES (@key, @fp, @code, N'PENDING')
    `);
  return { kind: 'claimed', requestId: Number(ins.recordset[0].CancelRequestID) };
}

export async function claimCancelIdempotencyAutonomous(args: {
  idempotencyKey: string;
  requestFingerprint: string;
  bookingCode: string;
}): Promise<ClaimResult> {
  await ensurePublicBookingCancelIdempotencyTable();
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

export async function completeCancelIdempotencySuccess(
  transaction: Transaction,
  args: { requestId: number; responseJson: string },
): Promise<void> {
  await new sql.Request(transaction)
    .input('id', sql.BigInt, args.requestId)
    .input('json', sql.NVarChar(sql.MAX), args.responseJson)
    .query(`
      UPDATE dbo.TblPublicBookingCancelRequest
      SET Status = N'COMPLETED',
          ResponseJson = @json,
          CompletedAt = SYSUTCDATETIME(),
          LastErrorCode = NULL
      WHERE CancelRequestID = @id
    `);
}

export async function markCancelIdempotencyFailed(
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
        UPDATE dbo.TblPublicBookingCancelRequest
        SET Status = N'FAILED', LastErrorCode = @err, CompletedAt = SYSUTCDATETIME()
        WHERE CancelRequestID = @id AND Status = N'PENDING'
      `);
  } catch {
    /* best-effort */
  }
}
