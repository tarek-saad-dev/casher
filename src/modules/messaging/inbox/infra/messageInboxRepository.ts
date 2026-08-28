/**
 * Access to dbo.TblMessageInbox.
 * Idempotency is enforced by UQ_TblMessageInbox_ProviderMessage, not SELECT-then-INSERT.
 */
import { getPool, sql } from '@/lib/db';
import {
  isMessageInboxStatus,
  type MessageInboxListItem,
  type MessageInboxRow,
  type MessageInboxStatus,
} from '../domain/types';

export type InboxInsertRecord = {
  provider: string;
  providerMessageId: string;
  phone: string;
  chatTitle: string | null;
  messageType: string;
  text: string | null;
  isGroup: boolean;
  rawPayloadJson: string | null;
  status: MessageInboxStatus;
  receivedAt: Date;
};

export type InboxListFilters = {
  status?: MessageInboxStatus | null;
  fetchLimit: number;
};

type RawInboxRow = {
  ID: number | string;
  Provider: string;
  ProviderMessageID: string;
  Phone: string;
  ChatTitle: string | null;
  MessageType: string;
  Text: string | null;
  IsGroup: boolean | number;
  RawPayload: string | null;
  Status: string;
  RetryCount: number;
  LastError: string | null;
  ReceivedAt: Date | string;
  ProcessingStartedAt: Date | string | null;
  ProcessedAt: Date | string | null;
  CreatedAt: Date | string;
  UpdatedAt: Date | string | null;
};

const INBOX_ROW_COLUMNS = `
  [ID],
  [Provider],
  [ProviderMessageID],
  [Phone],
  [ChatTitle],
  [MessageType],
  [Text],
  [IsGroup],
  [RawPayload],
  [Status],
  [RetryCount],
  [LastError],
  [ReceivedAt],
  [ProcessingStartedAt],
  [ProcessedAt],
  [CreatedAt],
  [UpdatedAt]
`;

const INBOX_OUTPUT_COLUMNS = INBOX_ROW_COLUMNS.replace(/\[/g, 'INSERTED.[');

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
  return /UQ_TblMessageInbox_ProviderMessage|UNIQUE KEY|duplicate key/i.test(
    String(e?.message ?? e?.originalError?.message ?? ''),
  );
}

export function mapInboxRow(row: RawInboxRow): MessageInboxRow {
  const status = isMessageInboxStatus(row.Status) ? row.Status : 'pending';
  return {
    id: Number(row.ID),
    provider: String(row.Provider),
    providerMessageId: String(row.ProviderMessageID),
    phone: String(row.Phone),
    chatTitle:
      row.ChatTitle != null && String(row.ChatTitle).trim() !== ''
        ? String(row.ChatTitle)
        : null,
    messageType: String(row.MessageType),
    text: row.Text != null ? String(row.Text) : null,
    isGroup: Boolean(row.IsGroup),
    rawPayload: row.RawPayload != null ? String(row.RawPayload) : null,
    status,
    retryCount: Number(row.RetryCount ?? 0),
    lastError: row.LastError != null ? String(row.LastError) : null,
    receivedAt: toIso(row.ReceivedAt) ?? new Date(0).toISOString(),
    processingStartedAt: toIso(row.ProcessingStartedAt),
    processedAt: toIso(row.ProcessedAt),
    createdAt: toIso(row.CreatedAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.UpdatedAt),
  };
}

export function mapInboxListItem(row: RawInboxRow): MessageInboxListItem {
  const mapped = mapInboxRow(row);
  return {
    id: mapped.id,
    provider: mapped.provider,
    providerMessageId: mapped.providerMessageId,
    phone: mapped.phone,
    chatTitle: mapped.chatTitle,
    messageType: mapped.messageType,
    text: mapped.text,
    isGroup: mapped.isGroup,
    status: mapped.status,
    retryCount: mapped.retryCount,
    receivedAt: mapped.receivedAt,
    createdAt: mapped.createdAt,
  };
}

export async function getByProviderMessage(
  provider: string,
  providerMessageId: string,
): Promise<MessageInboxRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('provider', sql.NVarChar(50), provider)
    .input('providerMessageId', sql.NVarChar(250), providerMessageId)
    .query(`
      SELECT ${INBOX_ROW_COLUMNS}
      FROM [dbo].[TblMessageInbox]
      WHERE [Provider] = @provider
        AND [ProviderMessageID] = @providerMessageId
    `);
  const row = result.recordset[0] as RawInboxRow | undefined;
  return row ? mapInboxRow(row) : null;
}

export async function insert(record: InboxInsertRecord): Promise<{
  row: MessageInboxRow;
  duplicate: boolean;
}> {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('provider', sql.NVarChar(50), record.provider)
      .input('providerMessageId', sql.NVarChar(250), record.providerMessageId)
      .input('phone', sql.NVarChar(50), record.phone)
      .input('chatTitle', sql.NVarChar(200), record.chatTitle)
      .input('messageType', sql.NVarChar(50), record.messageType)
      .input('text', sql.NVarChar(sql.MAX), record.text)
      .input('isGroup', sql.Bit, record.isGroup ? 1 : 0)
      .input('rawPayload', sql.NVarChar(sql.MAX), record.rawPayloadJson)
      .input('status', sql.NVarChar(20), record.status)
      .input('receivedAt', sql.DateTime2, record.receivedAt)
      .query(`
        INSERT INTO [dbo].[TblMessageInbox] (
          [Provider],
          [ProviderMessageID],
          [Phone],
          [ChatTitle],
          [MessageType],
          [Text],
          [IsGroup],
          [RawPayload],
          [Status],
          [RetryCount],
          [ReceivedAt],
          [CreatedAt]
        )
        OUTPUT ${INBOX_OUTPUT_COLUMNS}
        VALUES (
          @provider,
          @providerMessageId,
          @phone,
          @chatTitle,
          @messageType,
          @text,
          @isGroup,
          @rawPayload,
          @status,
          0,
          @receivedAt,
          SYSUTCDATETIME()
        )
      `);
    const row = result.recordset[0] as RawInboxRow | undefined;
    if (!row) {
      throw new Error('Inbox insert did not return a row');
    }
    return { row: mapInboxRow(row), duplicate: false };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const existing = await getByProviderMessage(record.provider, record.providerMessageId);
    if (!existing) throw err;
    return { row: existing, duplicate: true };
  }
}

export async function list(filters: InboxListFilters): Promise<MessageInboxListItem[]> {
  const fetchLimit = Math.max(1, Math.min(200, Math.floor(filters.fetchLimit)));
  const pool = await getPool();
  const result = await pool
    .request()
    .input('status', sql.NVarChar(20), filters.status ?? null)
    .input('fetchLimit', sql.Int, fetchLimit)
    .query(`
      SELECT TOP (@fetchLimit)
        ${INBOX_ROW_COLUMNS}
      FROM [dbo].[TblMessageInbox]
      WHERE (@status IS NULL OR [Status] = @status)
      ORDER BY [ReceivedAt] DESC, [ID] DESC
    `);
  return (result.recordset as RawInboxRow[]).map(mapInboxListItem);
}

export async function countByProviderMessage(
  provider: string,
  providerMessageId: string,
): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('provider', sql.NVarChar(50), provider)
    .input('providerMessageId', sql.NVarChar(250), providerMessageId)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM [dbo].[TblMessageInbox]
      WHERE [Provider] = @provider
        AND [ProviderMessageID] = @providerMessageId
    `);
  return Number(result.recordset[0]?.cnt ?? 0);
}

export async function claimPendingBatch(input: {
  batchSize: number;
}): Promise<MessageInboxRow[]> {
  const batchSize = Math.max(1, Math.min(50, Math.floor(input.batchSize)));
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('batchSize', sql.Int, batchSize)
      .query(`
        ;WITH claim AS (
          SELECT TOP (@batchSize)
            [ID]
          FROM [dbo].[TblMessageInbox] WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE [Status] = N'pending'
            AND [IsGroup] = 0
          ORDER BY [ReceivedAt] ASC, [ID] ASC
        )
        UPDATE i
        SET
          i.[Status] = N'processing',
          i.[ProcessingStartedAt] = SYSUTCDATETIME(),
          i.[UpdatedAt] = SYSUTCDATETIME()
        OUTPUT ${INBOX_OUTPUT_COLUMNS}
        FROM [dbo].[TblMessageInbox] AS i
        INNER JOIN claim AS c ON c.[ID] = i.[ID]
      `);
    await transaction.commit();
    return (result.recordset as RawInboxRow[]).map(mapInboxRow);
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already aborted */
    }
    throw err;
  }
}

export async function markCompleted(
  input: { id: number },
  transaction?: sql.Transaction,
): Promise<MessageInboxRow | null> {
  const exec = async (req: sql.Request) => {
    const result = await req.input('id', sql.BigInt, input.id).query(`
      UPDATE [dbo].[TblMessageInbox]
      SET
        [Status] = N'completed',
        [ProcessedAt] = SYSUTCDATETIME(),
        [UpdatedAt] = SYSUTCDATETIME(),
        [LastError] = NULL
      OUTPUT ${INBOX_OUTPUT_COLUMNS}
      WHERE [ID] = @id
        AND [Status] IN (N'processing', N'pending')
    `);
    const row = result.recordset[0] as RawInboxRow | undefined;
    return row ? mapInboxRow(row) : null;
  };
  if (transaction) return exec(new sql.Request(transaction));
  const pool = await getPool();
  return exec(pool.request());
}

export async function markFailed(input: {
  id: number;
  lastError: string;
}): Promise<MessageInboxRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, input.id)
    .input('lastError', sql.NVarChar(sql.MAX), String(input.lastError ?? '').slice(0, 4000))
    .query(`
      UPDATE [dbo].[TblMessageInbox]
      SET
        [Status] = N'failed',
        [UpdatedAt] = SYSUTCDATETIME(),
        [LastError] = @lastError
      OUTPUT ${INBOX_OUTPUT_COLUMNS}
      WHERE [ID] = @id
        AND [Status] = N'processing'
    `);
  const row = result.recordset[0] as RawInboxRow | undefined;
  return row ? mapInboxRow(row) : null;
}

export async function recoverStaleProcessing(input: {
  staleMs: number;
}): Promise<{ completed: number; requeued: number }> {
  const staleMs = Math.max(1000, Math.floor(input.staleMs));
  const pool = await getPool();

  const completed = await pool.request().input('staleMs', sql.Int, staleMs).query(`
    UPDATE i
    SET
      i.[Status] = N'completed',
      i.[ProcessedAt] = SYSUTCDATETIME(),
      i.[UpdatedAt] = SYSUTCDATETIME(),
      i.[LastError] = NULL
    OUTPUT INSERTED.[ID]
    FROM [dbo].[TblMessageInbox] AS i
    INNER JOIN [dbo].[TblBotMessage] AS m ON m.[InboxID] = i.[ID]
    WHERE i.[Status] = N'processing'
      AND i.[ProcessingStartedAt] IS NOT NULL
      AND i.[ProcessingStartedAt] < DATEADD(MILLISECOND, -@staleMs, SYSUTCDATETIME())
  `);

  const requeued = await pool.request().input('staleMs', sql.Int, staleMs).query(`
    UPDATE i
    SET
      i.[Status] = N'pending',
      i.[ProcessingStartedAt] = NULL,
      i.[UpdatedAt] = SYSUTCDATETIME(),
      i.[RetryCount] = i.[RetryCount] + 1,
      i.[LastError] = N'stale_processing_recovered'
    OUTPUT INSERTED.[ID]
    FROM [dbo].[TblMessageInbox] AS i
    WHERE i.[Status] = N'processing'
      AND i.[ProcessingStartedAt] IS NOT NULL
      AND i.[ProcessingStartedAt] < DATEADD(MILLISECOND, -@staleMs, SYSUTCDATETIME())
      AND NOT EXISTS (
        SELECT 1
        FROM [dbo].[TblBotMessage] AS m
        WHERE m.[InboxID] = i.[ID]
      )
  `);

  return {
    completed: (completed.recordset as Array<{ ID: number }>).length,
    requeued: (requeued.recordset as Array<{ ID: number }>).length,
  };
}

export async function getById(id: number): Promise<MessageInboxRow | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`
      SELECT ${INBOX_ROW_COLUMNS}
      FROM [dbo].[TblMessageInbox]
      WHERE [ID] = @id
    `);
  const row = result.recordset[0] as RawInboxRow | undefined;
  return row ? mapInboxRow(row) : null;
}
