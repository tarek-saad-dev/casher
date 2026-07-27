/**
 * Booking Phase 6 — durable create idempotency (TblPublicBookingCreateRequest).
 */
import 'server-only';
import type { Transaction } from 'mssql';
import crypto from 'crypto';
import { getPool, sql } from '@/lib/db';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';

let ensured = false;

export async function ensurePublicBookingCreateIdempotencyTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblPublicBookingCreateRequest'
    )
    BEGIN
      CREATE TABLE dbo.TblPublicBookingCreateRequest (
        RequestID           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TblPublicBookingCreateRequest PRIMARY KEY,
        IdempotencyKey      NVARCHAR(128) NOT NULL,
        RequestFingerprint  CHAR(64) NOT NULL,
        Status              NVARCHAR(24) NOT NULL,
        BookingID           INT NULL,
        BookingCode         NVARCHAR(32) NULL,
        ResponseJson        NVARCHAR(MAX) NULL,
        LastErrorCode       NVARCHAR(64) NULL,
        NotificationSent    BIT NOT NULL CONSTRAINT DF_PBCReq_NotificationSent DEFAULT (0),
        CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_PBCReq_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CompletedAt         DATETIME2(0) NULL,
        CONSTRAINT UQ_TblPublicBookingCreateRequest_Key UNIQUE (IdempotencyKey)
      );
    END
  `);
  ensured = true;
}

export type CreateRequestFingerprintInput = {
  contractVersion: string;
  branchCode: string;
  workDate: string;
  time: string;
  dayOffset: 0 | 1;
  serviceIds: number[];
  mode: 'specific_barber' | 'any_barber';
  empId: number | null;
  customerPhone: string;
};

export function buildCreateRequestFingerprint(input: CreateRequestFingerprintInput): string {
  const canonical = JSON.stringify({
    v: input.contractVersion,
    branchCode: input.branchCode,
    workDate: input.workDate,
    time: input.time,
    dayOffset: input.dayOffset,
    serviceIds: [...input.serviceIds],
    mode: input.mode,
    empId: input.empId,
    phone: input.customerPhone,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export type IdempotencyRow = {
  RequestID: number;
  IdempotencyKey: string;
  RequestFingerprint: string;
  Status: string;
  BookingID: number | null;
  BookingCode: string | null;
  ResponseJson: string | null;
  LastErrorCode: string | null;
  NotificationSent: boolean;
};

export class IdempotencyConflictError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'IdempotencyConflictError';
    this.code = code;
  }
}

type ClaimIdempotencyResult =
  | { kind: 'replay'; row: IdempotencyRow }
  | { kind: 'claimed'; requestId: number };

async function claimIdempotencyKeyWithFactory(
  makeRequest: () => sql.Request,
  args: {
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<ClaimIdempotencyResult> {
  const existing = await makeRequest()
    .input('key', sql.NVarChar(128), args.idempotencyKey)
    .query(`
      SELECT TOP 1
        RequestID, IdempotencyKey, RequestFingerprint, Status,
        BookingID, BookingCode, ResponseJson, LastErrorCode,
        CAST(NotificationSent AS BIT) AS NotificationSent
      FROM dbo.TblPublicBookingCreateRequest WITH (UPDLOCK, HOLDLOCK)
      WHERE IdempotencyKey = @key
    `);

  const row = existing.recordset[0] as IdempotencyRow | undefined;
  if (row) {
    if (row.RequestFingerprint !== args.requestFingerprint) {
      throw new IdempotencyConflictError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
    }
    if (row.Status === 'COMPLETED' && row.ResponseJson) {
      return { kind: 'replay', row };
    }
    if (row.Status === 'PENDING') {
      throw new IdempotencyConflictError('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    }
    // FAILED → reclaim
    await makeRequest()
      .input('id', sql.BigInt, row.RequestID)
      .query(`
        UPDATE dbo.TblPublicBookingCreateRequest
        SET Status = N'PENDING', LastErrorCode = NULL, CompletedAt = NULL
        WHERE RequestID = @id
      `);
    return { kind: 'claimed', requestId: Number(row.RequestID) };
  }

  const ins = await makeRequest()
    .input('key', sql.NVarChar(128), args.idempotencyKey)
    .input('fp', sql.Char(64), args.requestFingerprint)
    .query(`
      INSERT INTO dbo.TblPublicBookingCreateRequest
        (IdempotencyKey, RequestFingerprint, Status)
      OUTPUT INSERTED.RequestID
      VALUES (@key, @fp, N'PENDING')
    `);
  return { kind: 'claimed', requestId: Number(ins.recordset[0].RequestID) };
}

/**
 * Claim idempotency key inside an open transaction.
 * Prefer {@link claimIdempotencyKeyAutonomous} so PENDING survives booking TX rollback.
 */
export async function claimIdempotencyKey(
  transaction: Transaction,
  args: {
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<ClaimIdempotencyResult> {
  return claimIdempotencyKeyWithFactory(() => new sql.Request(transaction), args);
}

/**
 * Claim (or reclaim FAILED) outside the booking write transaction.
 * PENDING is committed before booking work so rollback + markFailed can persist FAILED.
 */
export async function claimIdempotencyKeyAutonomous(args: {
  idempotencyKey: string;
  requestFingerprint: string;
}): Promise<ClaimIdempotencyResult> {
  await ensurePublicBookingCreateIdempotencyTable();
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const result = await claimIdempotencyKeyWithFactory(
      () => new sql.Request(transaction),
      args,
    );
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function completeIdempotencySuccess(
  transaction: Transaction,
  args: {
    requestId: number;
    bookingId: number;
    bookingCode: string;
    responseJson: string;
  },
): Promise<void> {
  await new sql.Request(transaction)
    .input('id', sql.BigInt, args.requestId)
    .input('bookingId', sql.Int, args.bookingId)
    .input('code', sql.NVarChar(32), args.bookingCode)
    .input('json', sql.NVarChar(sql.MAX), args.responseJson)
    .query(`
      UPDATE dbo.TblPublicBookingCreateRequest
      SET Status = N'COMPLETED',
          BookingID = @bookingId,
          BookingCode = @code,
          ResponseJson = @json,
          CompletedAt = SYSUTCDATETIME(),
          LastErrorCode = NULL
      WHERE RequestID = @id
    `);
}

export async function markIdempotencyFailed(
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
        UPDATE dbo.TblPublicBookingCreateRequest
        SET Status = N'FAILED', LastErrorCode = @err, CompletedAt = SYSUTCDATETIME()
        WHERE RequestID = @id AND Status = N'PENDING'
      `);
  } catch {
    /* best-effort */
  }
}

export async function markIdempotencyNotificationSent(requestId: number): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('id', sql.BigInt, requestId)
    .query(`
      UPDATE dbo.TblPublicBookingCreateRequest
      SET NotificationSent = 1
      WHERE RequestID = @id
    `);
}
