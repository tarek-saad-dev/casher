/**
 * Access to dbo.TblMessageOutbox.
 * Idempotency is enforced by UQ_TblMessageOutbox_IdempotencyKey, not SELECT-then-INSERT.
 */
import { getPool, sql } from '@/lib/db';
import {
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  isOutboxMessageStatus,
  type OutboxMessageRow,
  type OutboxMessageStatus,
} from '../domain/outboxTypes';

export type OutboxEnqueueRecord = {
  channel: 'whatsapp';
  recipient: string;
  content: string;
  templateKey: string | null;
  metadataJson: string | null;
  idempotencyKey: string;
  branchId: number | null;
  createdByUserId: number | null;
};

export type OutboxListFilters = {
  branchId?: number | null;
  status?: OutboxMessageStatus | null;
  channel?: string | null;
  cursorCreatedAt?: Date | null;
  cursorId?: number | null;
  fetchLimit: number;
};

type RawOutboxRow = {
  ID: number | string;
  Channel: string;
  Recipient: string;
  TemplateKey: string | null;
  Content: string;
  MetadataJson: string | null;
  IdempotencyKey: string;
  Status: string;
  AttemptCount: number;
  MaxAttempts: number;
  NextAttemptAt: Date | string | null;
  LockedAt: Date | string | null;
  LockedBy: string | null;
  ProviderMessageID: string | null;
  LastError: string | null;
  BranchID: number | null;
  CreatedByUserID: number | null;
  CreatedAt: Date | string;
  UpdatedAt: Date | string | null;
  SentAt: Date | string | null;
  FailedAt: Date | string | null;
};

const OUTBOX_ROW_COLUMNS = `
  [ID],
  [Channel],
  [Recipient],
  [TemplateKey],
  [Content],
  [MetadataJson],
  [IdempotencyKey],
  [Status],
  [AttemptCount],
  [MaxAttempts],
  [NextAttemptAt],
  [LockedAt],
  [LockedBy],
  [ProviderMessageID],
  [LastError],
  [BranchID],
  [CreatedByUserID],
  [CreatedAt],
  [UpdatedAt],
  [SentAt],
  [FailedAt]
`;

const OUTBOX_OUTPUT_COLUMNS = OUTBOX_ROW_COLUMNS.replace(/\[/g, 'INSERTED.[');

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isUniqueConstraintError(err: unknown): boolean {
  const e = err as {
    number?: number;
    message?: string;
    originalError?: { info?: { number?: number }; message?: string };
  };
  const number = e?.number ?? e?.originalError?.info?.number;
  if (number === 2627 || number === 2601) return true;
  return /UQ_TblMessageOutbox_IdempotencyKey|UNIQUE KEY|duplicate key/i.test(
    String(e?.message ?? e?.originalError?.message ?? ''),
  );
}

export function mapOutboxRow(row: RawOutboxRow): OutboxMessageRow {
  const status = isOutboxMessageStatus(row.Status) ? row.Status : 'pending';
  return {
    id: Number(row.ID),
    channel: String(row.Channel),
    recipient: String(row.Recipient),
    templateKey: row.TemplateKey != null && String(row.TemplateKey) !== '' ? String(row.TemplateKey) : null,
    content: String(row.Content),
    metadataJson: row.MetadataJson != null ? String(row.MetadataJson) : null,
    idempotencyKey: String(row.IdempotencyKey),
    status,
    attemptCount: Number(row.AttemptCount ?? 0),
    maxAttempts: Number(row.MaxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS),
    nextAttemptAt: toIso(row.NextAttemptAt),
    lockedAt: toIso(row.LockedAt),
    lockedBy: row.LockedBy != null ? String(row.LockedBy) : null,
    providerMessageId: row.ProviderMessageID != null ? String(row.ProviderMessageID) : null,
    lastError: row.LastError != null ? String(row.LastError) : null,
    branchId: row.BranchID == null ? null : Number(row.BranchID),
    createdByUserId: row.CreatedByUserID == null ? null : Number(row.CreatedByUserID),
    createdAt: toIso(row.CreatedAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.UpdatedAt),
    sentAt: toIso(row.SentAt),
    failedAt: toIso(row.FailedAt),
  };
}

export async function getById(id: number): Promise<OutboxMessageRow | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`
      SELECT ${OUTBOX_ROW_COLUMNS}
      FROM [dbo].[TblMessageOutbox]
      WHERE [ID] = @id
    `);
  const row = result.recordset[0] as RawOutboxRow | undefined;
  return row ? mapOutboxRow(row) : null;
}

export async function getByIdempotencyKey(idempotencyKey: string): Promise<OutboxMessageRow | null> {
  const key = String(idempotencyKey ?? '').trim();
  if (!key) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('idempotencyKey', sql.NVarChar(200), key)
    .query(`
      SELECT ${OUTBOX_ROW_COLUMNS}
      FROM [dbo].[TblMessageOutbox]
      WHERE [IdempotencyKey] = @idempotencyKey
    `);
  const row = result.recordset[0] as RawOutboxRow | undefined;
  return row ? mapOutboxRow(row) : null;
}

export async function enqueue(record: OutboxEnqueueRecord): Promise<{
  row: OutboxMessageRow;
  duplicate: boolean;
}> {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('channel', sql.NVarChar(30), record.channel)
      .input('recipient', sql.NVarChar(100), record.recipient)
      .input('templateKey', sql.NVarChar(150), record.templateKey)
      .input('content', sql.NVarChar(sql.MAX), record.content)
      .input('metadataJson', sql.NVarChar(sql.MAX), record.metadataJson)
      .input('idempotencyKey', sql.NVarChar(200), record.idempotencyKey)
      .input('maxAttempts', sql.Int, DEFAULT_OUTBOX_MAX_ATTEMPTS)
      .input('branchId', sql.Int, record.branchId)
      .input('createdByUserId', sql.Int, record.createdByUserId)
      .query(`
        INSERT INTO [dbo].[TblMessageOutbox] (
          [Channel],
          [Recipient],
          [TemplateKey],
          [Content],
          [MetadataJson],
          [IdempotencyKey],
          [Status],
          [AttemptCount],
          [MaxAttempts],
          [NextAttemptAt],
          [BranchID],
          [CreatedByUserID],
          [CreatedAt]
        )
        OUTPUT ${OUTBOX_OUTPUT_COLUMNS}
        VALUES (
          @channel,
          @recipient,
          @templateKey,
          @content,
          @metadataJson,
          @idempotencyKey,
          N'pending',
          0,
          @maxAttempts,
          SYSUTCDATETIME(),
          @branchId,
          @createdByUserId,
          SYSUTCDATETIME()
        )
      `);
    const row = result.recordset[0] as RawOutboxRow | undefined;
    if (!row) {
      throw new Error('Outbox insert did not return a row');
    }
    return { row: mapOutboxRow(row), duplicate: false };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const existing = await getByIdempotencyKey(record.idempotencyKey);
    if (!existing) throw err;
    return { row: existing, duplicate: true };
  }
}

export async function claimPendingBatch(input: {
  batchSize: number;
  lockedBy: string;
}): Promise<OutboxMessageRow[]> {
  const batchSize = Math.max(1, Math.min(100, Math.floor(input.batchSize)));
  const lockedBy = String(input.lockedBy ?? '').trim().slice(0, 100);
  if (!lockedBy) {
    throw new Error('lockedBy is required to claim outbox rows');
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('batchSize', sql.Int, batchSize)
      .input('lockedBy', sql.NVarChar(100), lockedBy)
      .query(`
        ;WITH claim AS (
          SELECT TOP (@batchSize)
            [ID]
          FROM [dbo].[TblMessageOutbox] WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE [Status] = N'pending'
            AND ([NextAttemptAt] IS NULL OR [NextAttemptAt] <= SYSUTCDATETIME())
            AND [AttemptCount] < [MaxAttempts]
          ORDER BY [CreatedAt] ASC, [ID] ASC
        )
        UPDATE o
        SET
          o.[Status] = N'sending',
          o.[LockedAt] = SYSUTCDATETIME(),
          o.[LockedBy] = @lockedBy,
          o.[AttemptCount] = o.[AttemptCount] + 1,
          o.[UpdatedAt] = SYSUTCDATETIME(),
          o.[NextAttemptAt] = NULL
        OUTPUT ${OUTBOX_OUTPUT_COLUMNS}
        FROM [dbo].[TblMessageOutbox] AS o
        INNER JOIN claim AS c ON c.[ID] = o.[ID]
      `);
    await transaction.commit();
    return (result.recordset as RawOutboxRow[]).map(mapOutboxRow);
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already aborted */
    }
    throw err;
  }
}

export async function markSent(input: {
  id: number;
  providerMessageId: string;
}): Promise<OutboxMessageRow | null> {
  const providerMessageId = String(input.providerMessageId ?? '').trim();
  if (!Number.isFinite(input.id) || input.id <= 0 || !providerMessageId) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, input.id)
    .input('providerMessageId', sql.NVarChar(250), providerMessageId)
    .query(`
      UPDATE [dbo].[TblMessageOutbox]
      SET
        [Status] = N'sent',
        [ProviderMessageID] = @providerMessageId,
        [SentAt] = SYSUTCDATETIME(),
        [UpdatedAt] = SYSUTCDATETIME(),
        [LockedAt] = NULL,
        [LockedBy] = NULL,
        [LastError] = NULL,
        [NextAttemptAt] = NULL
      OUTPUT ${OUTBOX_OUTPUT_COLUMNS}
      WHERE [ID] = @id
        AND [Status] = N'sending'
    `);
  const row = result.recordset[0] as RawOutboxRow | undefined;
  return row ? mapOutboxRow(row) : null;
}

export async function scheduleRetry(input: {
  id: number;
  nextAttemptAt: Date;
  lastError: string;
}): Promise<OutboxMessageRow | null> {
  if (!Number.isFinite(input.id) || input.id <= 0) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, input.id)
    .input('nextAttemptAt', sql.DateTime2, input.nextAttemptAt)
    .input('lastError', sql.NVarChar(sql.MAX), String(input.lastError ?? '').slice(0, 4000))
    .query(`
      UPDATE [dbo].[TblMessageOutbox]
      SET
        [Status] = N'pending',
        [NextAttemptAt] = @nextAttemptAt,
        [UpdatedAt] = SYSUTCDATETIME(),
        [LockedAt] = NULL,
        [LockedBy] = NULL,
        [LastError] = @lastError
      OUTPUT ${OUTBOX_OUTPUT_COLUMNS}
      WHERE [ID] = @id
        AND [Status] = N'sending'
    `);
  const row = result.recordset[0] as RawOutboxRow | undefined;
  return row ? mapOutboxRow(row) : null;
}

export async function markFailed(input: {
  id: number;
  lastError: string;
}): Promise<OutboxMessageRow | null> {
  if (!Number.isFinite(input.id) || input.id <= 0) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, input.id)
    .input('lastError', sql.NVarChar(sql.MAX), String(input.lastError ?? '').slice(0, 4000))
    .query(`
      UPDATE [dbo].[TblMessageOutbox]
      SET
        [Status] = N'failed',
        [FailedAt] = SYSUTCDATETIME(),
        [UpdatedAt] = SYSUTCDATETIME(),
        [LockedAt] = NULL,
        [LockedBy] = NULL,
        [LastError] = @lastError,
        [NextAttemptAt] = NULL
      OUTPUT ${OUTBOX_OUTPUT_COLUMNS}
      WHERE [ID] = @id
        AND [Status] IN (N'sending', N'pending')
    `);
  const row = result.recordset[0] as RawOutboxRow | undefined;
  return row ? mapOutboxRow(row) : null;
}

export async function recoverStaleSending(input: {
  lockTtlMs: number;
}): Promise<OutboxMessageRow[]> {
  const lockTtlMs = Math.max(1000, Math.floor(input.lockTtlMs));
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lockTtlMs', sql.Int, lockTtlMs)
    .query(`
      UPDATE [dbo].[TblMessageOutbox]
      SET
        [Status] = N'pending',
        [LockedAt] = NULL,
        [LockedBy] = NULL,
        [UpdatedAt] = SYSUTCDATETIME(),
        [NextAttemptAt] = SYSUTCDATETIME(),
        [LastError] = N'stale_lock_recovered'
      OUTPUT ${OUTBOX_OUTPUT_COLUMNS}
      WHERE [Status] = N'sending'
        AND [LockedAt] IS NOT NULL
        AND [LockedAt] < DATEADD(MILLISECOND, -@lockTtlMs, SYSUTCDATETIME())
    `);
  return (result.recordset as RawOutboxRow[]).map(mapOutboxRow);
}

export async function list(filters: OutboxListFilters): Promise<OutboxMessageRow[]> {
  const fetchLimit = Math.max(1, Math.floor(filters.fetchLimit));
  const pool = await getPool();
  const result = await pool
    .request()
    .input('branchId', sql.Int, filters.branchId ?? null)
    .input('status', sql.NVarChar(20), filters.status ?? null)
    .input('channel', sql.NVarChar(30), filters.channel ?? null)
    .input('cursorCreatedAt', sql.DateTime2, filters.cursorCreatedAt ?? null)
    .input('cursorId', sql.BigInt, filters.cursorId ?? null)
    .input('fetchLimit', sql.Int, fetchLimit)
    .query(`
      SELECT TOP (@fetchLimit)
        ${OUTBOX_ROW_COLUMNS}
      FROM [dbo].[TblMessageOutbox]
      WHERE (@branchId IS NULL OR [BranchID] = @branchId)
        AND (@status IS NULL OR [Status] = @status)
        AND (@channel IS NULL OR [Channel] = @channel)
        AND (
          @cursorCreatedAt IS NULL
          OR [CreatedAt] < @cursorCreatedAt
          OR ([CreatedAt] = @cursorCreatedAt AND [ID] < @cursorId)
        )
      ORDER BY [CreatedAt] DESC, [ID] DESC
    `);
  return (result.recordset as RawOutboxRow[]).map(mapOutboxRow);
}
