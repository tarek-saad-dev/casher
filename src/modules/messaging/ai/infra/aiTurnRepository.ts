import { getPool, sql } from '@/lib/db';
import type { AiTurnRow, AiTurnStatus } from '../domain/types';

type RawTurnRow = {
  TurnID: number | string;
  ConversationID: number | string;
  AnchorInboundMessageID: number | string;
  LatestInboundMessageID: number | string;
  Status: string;
  ControlModeSnapshot: string;
  DebounceUntil: Date | string;
  OutboundMessageID: number | string | null;
  OutboxID: number | string | null;
  Intent: string | null;
  Confidence: number | string | null;
  NeedsBusinessTool: boolean | number | null;
  ResultJson: string | null;
  LastError: string | null;
  ErrorCode: string | null;
  RetryCount: number | string;
  MaxRetries: number | string;
  NextAttemptAt: Date | string | null;
  ProcessingStartedAt: Date | string | null;
  CompletedAt: Date | string | null;
  CreatedAt: Date | string;
  UpdatedAt: Date | string | null;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapTurnRow(row: RawTurnRow): AiTurnRow {
  return {
    turnId: Number(row.TurnID),
    conversationId: Number(row.ConversationID),
    anchorInboundMessageId: Number(row.AnchorInboundMessageID),
    latestInboundMessageId: Number(row.LatestInboundMessageID),
    status: row.Status as AiTurnStatus,
    controlModeSnapshot: row.ControlModeSnapshot as AiTurnRow['controlModeSnapshot'],
    debounceUntil: toIso(row.DebounceUntil) ?? new Date().toISOString(),
    outboundMessageId: row.OutboundMessageID != null ? Number(row.OutboundMessageID) : null,
    outboxId: row.OutboxID != null ? Number(row.OutboxID) : null,
    intent: row.Intent,
    confidence: row.Confidence != null ? Number(row.Confidence) : null,
    needsBusinessTool:
      row.NeedsBusinessTool == null ? null : Boolean(row.NeedsBusinessTool),
    resultJson: row.ResultJson,
    lastError: row.LastError,
    errorCode: row.ErrorCode,
    retryCount: Number(row.RetryCount),
    maxRetries: Number(row.MaxRetries),
    nextAttemptAt: toIso(row.NextAttemptAt),
    processingStartedAt: toIso(row.ProcessingStartedAt),
    completedAt: toIso(row.CompletedAt),
    createdAt: toIso(row.CreatedAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.UpdatedAt),
  };
}

const TURN_COLUMNS = `
  t.[TurnID],
  t.[ConversationID],
  t.[AnchorInboundMessageID],
  t.[LatestInboundMessageID],
  t.[Status],
  t.[ControlModeSnapshot],
  t.[DebounceUntil],
  t.[OutboundMessageID],
  t.[OutboxID],
  t.[Intent],
  t.[Confidence],
  t.[NeedsBusinessTool],
  t.[ResultJson],
  t.[LastError],
  t.[ErrorCode],
  t.[RetryCount],
  t.[MaxRetries],
  t.[NextAttemptAt],
  t.[ProcessingStartedAt],
  t.[CompletedAt],
  t.[CreatedAt],
  t.[UpdatedAt]
`;

export async function scheduleAiTurnAfterInbound(input: {
  conversationId: number;
  inboundMessageId: number;
  debounceMs: number;
  maxRetries: number;
}): Promise<{ scheduled: boolean; turnId: number | null; skipped: boolean }> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('inboundMessageId', sql.BigInt, input.inboundMessageId)
    .input('debounceMs', sql.Int, input.debounceMs)
    .input('maxRetries', sql.Int, input.maxRetries)
    .query(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;

      DECLARE @ControlMode NVARCHAR(20);
      DECLARE @TurnId BIGINT = NULL;
      DECLARE @Skipped BIT = 0;

      SELECT @ControlMode = c.[ControlMode]
      FROM [dbo].[TblBotConversation] AS c WITH (UPDLOCK, HOLDLOCK)
      WHERE c.[ConversationID] = @conversationId;

      IF @ControlMode IS NULL
        THROW 51000, 'Conversation not found', 1;

      IF @ControlMode <> N'BOT'
      BEGIN
        INSERT INTO [dbo].[TblBotAiTurn] (
          [ConversationID], [AnchorInboundMessageID], [LatestInboundMessageID],
          [Status], [ControlModeSnapshot], [DebounceUntil], [MaxRetries], [CompletedAt]
        )
        VALUES (
          @conversationId, @inboundMessageId, @inboundMessageId,
          N'skipped', @ControlMode, SYSUTCDATETIME(), @maxRetries, SYSUTCDATETIME()
        );
        SET @TurnId = SCOPE_IDENTITY();
        SET @Skipped = 1;
        SELECT @TurnId AS turnId, @Skipped AS skipped;
        RETURN;
      END

      DECLARE @ExistingTurnId BIGINT = NULL;
      SELECT TOP 1 @ExistingTurnId = t.[TurnID]
      FROM [dbo].[TblBotAiTurn] AS t WITH (UPDLOCK, HOLDLOCK)
      WHERE t.[ConversationID] = @conversationId
        AND t.[Status] = N'pending';

      IF @ExistingTurnId IS NOT NULL
      BEGIN
        UPDATE [dbo].[TblBotAiTurn]
        SET
          [LatestInboundMessageID] = @inboundMessageId,
          [DebounceUntil] = DATEADD(MILLISECOND, @debounceMs, SYSUTCDATETIME()),
          [UpdatedAt] = SYSUTCDATETIME()
        WHERE [TurnID] = @ExistingTurnId;
        SET @TurnId = @ExistingTurnId;
      END
      ELSE
      BEGIN
        BEGIN TRY
          INSERT INTO [dbo].[TblBotAiTurn] (
            [ConversationID], [AnchorInboundMessageID], [LatestInboundMessageID],
            [Status], [ControlModeSnapshot], [DebounceUntil], [MaxRetries]
          )
          VALUES (
            @conversationId, @inboundMessageId, @inboundMessageId,
            N'pending', @ControlMode, DATEADD(MILLISECOND, @debounceMs, SYSUTCDATETIME()), @maxRetries
          );
          SET @TurnId = SCOPE_IDENTITY();
        END TRY
        BEGIN CATCH
          IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
          SELECT TOP 1 @ExistingTurnId = t.[TurnID]
          FROM [dbo].[TblBotAiTurn] AS t
          WHERE t.[ConversationID] = @conversationId
            AND t.[Status] = N'pending';
          IF @ExistingTurnId IS NOT NULL
          BEGIN
            UPDATE [dbo].[TblBotAiTurn]
            SET
              [LatestInboundMessageID] = @inboundMessageId,
              [DebounceUntil] = DATEADD(MILLISECOND, @debounceMs, SYSUTCDATETIME()),
              [UpdatedAt] = SYSUTCDATETIME()
            WHERE [TurnID] = @ExistingTurnId;
            SET @TurnId = @ExistingTurnId;
          END
          ELSE THROW;
        END CATCH
      END

      SELECT @TurnId AS turnId, @Skipped AS skipped;
    `);

  const row = result.recordset[0] as { turnId: number | string; skipped: boolean | number } | undefined;
  return {
    scheduled: row?.turnId != null,
    turnId: row?.turnId != null ? Number(row.turnId) : null,
    skipped: Boolean(row?.skipped),
  };
}

export async function claimPendingAiTurnBatch(input: {
  batchSize: number;
  workerId: string;
  staleMs: number;
}): Promise<AiTurnRow[]> {
  const batchSize = Math.max(1, Math.min(20, Math.floor(input.batchSize)));
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('batchSize', sql.Int, batchSize)
      .input('workerId', sql.NVarChar(100), input.workerId.slice(0, 100))
      .input('staleMs', sql.Int, input.staleMs)
      .query(`
        ;WITH claim AS (
          SELECT TOP (@batchSize) t.[TurnID]
          FROM [dbo].[TblBotAiTurn] AS t WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE t.[Status] = N'pending'
            AND t.[DebounceUntil] <= SYSUTCDATETIME()
            AND (t.[NextAttemptAt] IS NULL OR t.[NextAttemptAt] <= SYSUTCDATETIME())
          ORDER BY t.[DebounceUntil] ASC, t.[TurnID] ASC
        )
        UPDATE t
        SET
          t.[Status] = N'processing',
          t.[ProcessingStartedAt] = SYSUTCDATETIME(),
          t.[UpdatedAt] = SYSUTCDATETIME()
        OUTPUT ${TURN_COLUMNS.replace(/t\./g, 'inserted.')}
        FROM [dbo].[TblBotAiTurn] AS t
        INNER JOIN claim AS c ON c.[TurnID] = t.[TurnID];
      `);
    await transaction.commit();
    return (result.recordset as RawTurnRow[]).map(mapTurnRow);
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function recoverStaleAiProcessing(input: {
  staleMs: number;
}): Promise<{ requeued: number; failed: number }> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('staleMs', sql.Int, input.staleMs)
    .query(`
      SET NOCOUNT ON;
      DECLARE @Requeued INT = 0;
      DECLARE @Failed INT = 0;

      UPDATE t
      SET
        t.[Status] = N'pending',
        t.[ProcessingStartedAt] = NULL,
        t.[UpdatedAt] = SYSUTCDATETIME(),
        t.[RetryCount] = t.[RetryCount] + 1,
        t.[LastError] = N'stale_processing_recovered',
        t.[NextAttemptAt] = DATEADD(SECOND, 5, SYSUTCDATETIME())
      FROM [dbo].[TblBotAiTurn] AS t
      WHERE t.[Status] = N'processing'
        AND t.[ProcessingStartedAt] IS NOT NULL
        AND t.[ProcessingStartedAt] < DATEADD(MILLISECOND, -@staleMs, SYSUTCDATETIME())
        AND t.[OutboundMessageID] IS NULL
        AND t.[RetryCount] < t.[MaxRetries];
      SET @Requeued = @@ROWCOUNT;

      UPDATE t
      SET
        t.[Status] = N'failed',
        t.[ErrorCode] = N'STALE_PROCESSING',
        t.[LastError] = N'AI turn stale processing recovery exceeded retries',
        t.[CompletedAt] = SYSUTCDATETIME(),
        t.[UpdatedAt] = SYSUTCDATETIME()
      FROM [dbo].[TblBotAiTurn] AS t
      WHERE t.[Status] = N'processing'
        AND t.[ProcessingStartedAt] IS NOT NULL
        AND t.[ProcessingStartedAt] < DATEADD(MILLISECOND, -@staleMs, SYSUTCDATETIME())
        AND t.[OutboundMessageID] IS NULL
        AND t.[RetryCount] >= t.[MaxRetries];
      SET @Failed = @@ROWCOUNT;

      SELECT @Requeued AS requeued, @Failed AS failed;
    `);
  const row = result.recordset[0] as { requeued: number; failed: number } | undefined;
  return { requeued: Number(row?.requeued ?? 0), failed: Number(row?.failed ?? 0) };
}

export async function getAiTurnById(turnId: number): Promise<AiTurnRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('turnId', sql.BigInt, turnId)
    .query(`
      SELECT ${TURN_COLUMNS}
      FROM [dbo].[TblBotAiTurn] AS t
      WHERE t.[TurnID] = @turnId
    `);
  const row = result.recordset[0] as RawTurnRow | undefined;
  return row ? mapTurnRow(row) : null;
}

export async function markAiTurnCompleted(input: {
  turnId: number;
  outboundMessageId: number | null;
  outboxId: number | null;
  intent: string;
  confidence: number;
  needsBusinessTool: boolean;
  resultJson: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('turnId', sql.BigInt, input.turnId)
    .input('outboundMessageId', sql.BigInt, input.outboundMessageId)
    .input('outboxId', sql.BigInt, input.outboxId)
    .input('intent', sql.NVarChar(50), input.intent)
    .input('confidence', sql.Decimal(5, 4), input.confidence)
    .input('needsBusinessTool', sql.Bit, input.needsBusinessTool)
    .input('resultJson', sql.NVarChar(sql.MAX), input.resultJson)
    .query(`
      UPDATE [dbo].[TblBotAiTurn]
      SET
        [Status] = N'completed',
        [OutboundMessageID] = @outboundMessageId,
        [OutboxID] = @outboxId,
        [Intent] = @intent,
        [Confidence] = @confidence,
        [NeedsBusinessTool] = @needsBusinessTool,
        [ResultJson] = @resultJson,
        [CompletedAt] = SYSUTCDATETIME(),
        [UpdatedAt] = SYSUTCDATETIME(),
        [LastError] = NULL,
        [ErrorCode] = NULL
      WHERE [TurnID] = @turnId
    `);
}

export async function markAiTurnFailed(input: {
  turnId: number;
  errorCode: string;
  lastError: string;
  retryable: boolean;
  retryDelayMs?: number;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('turnId', sql.BigInt, input.turnId)
    .input('errorCode', sql.NVarChar(50), input.errorCode.slice(0, 50))
    .input('lastError', sql.NVarChar(500), input.lastError.slice(0, 500))
    .input('retryDelayMs', sql.Int, input.retryDelayMs ?? 5000)
    .query(`
      IF EXISTS (
        SELECT 1 FROM [dbo].[TblBotAiTurn]
        WHERE [TurnID] = @turnId AND [RetryCount] + 1 < [MaxRetries] AND @retryable = 1
      )
      BEGIN
        UPDATE [dbo].[TblBotAiTurn]
        SET
          [Status] = N'pending',
          [RetryCount] = [RetryCount] + 1,
          [ProcessingStartedAt] = NULL,
          [NextAttemptAt] = DATEADD(MILLISECOND, @retryDelayMs, SYSUTCDATETIME()),
          [ErrorCode] = @errorCode,
          [LastError] = @lastError,
          [UpdatedAt] = SYSUTCDATETIME()
        WHERE [TurnID] = @turnId;
      END
      ELSE
      BEGIN
        UPDATE [dbo].[TblBotAiTurn]
        SET
          [Status] = N'failed',
          [RetryCount] = [RetryCount] + 1,
          [ErrorCode] = @errorCode,
          [LastError] = @lastError,
          [CompletedAt] = SYSUTCDATETIME(),
          [UpdatedAt] = SYSUTCDATETIME()
        WHERE [TurnID] = @turnId;
      END
    `);
}

export async function markAiTurnSkipped(input: {
  turnId: number;
  errorCode: string;
  lastError: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('turnId', sql.BigInt, input.turnId)
    .input('errorCode', sql.NVarChar(50), input.errorCode.slice(0, 50))
    .input('lastError', sql.NVarChar(500), input.lastError.slice(0, 500))
    .query(`
      UPDATE [dbo].[TblBotAiTurn]
      SET
        [Status] = N'skipped',
        [ErrorCode] = @errorCode,
        [LastError] = @lastError,
        [CompletedAt] = SYSUTCDATETIME(),
        [UpdatedAt] = SYSUTCDATETIME()
      WHERE [TurnID] = @turnId
    `);
}
