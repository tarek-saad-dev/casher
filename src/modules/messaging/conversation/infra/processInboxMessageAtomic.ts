/**
 * Single-transaction inbox → conversation/message processor.
 * One SQL round trip for the hot path (existing + new conversation).
 */
import { getPool, sql } from '@/lib/db';
import { TBL_CLIENT_MOBILE_SUFFIX_SQL } from '@/lib/client/publicClientWebsite.helpers';
import { getClientMobileLookupSuffix } from '@/lib/client/publicClientWebsite.helpers';
import type { MessageInboxRow } from '../../inbox/domain/types';
import { DEFAULT_BOT_CHANNEL, type ProcessInboxMessageResult } from '../domain/types';
import { resolveExternalContactKey } from '../domain/externalContactKey';

export type AtomicProcessResult = ProcessInboxMessageResult & {
  clientAmbiguous: boolean;
  sqlRoundTrips: number;
};

type AtomicSqlRow = {
  inboxId: number | string;
  conversationId: number | string;
  messageId: number | string;
  duplicate: boolean | number;
  conversationCreated: boolean | number;
  clientLinked: boolean | number;
  clientAmbiguous: boolean | number;
};

export async function processInboxMessageAtomic(
  inbox: MessageInboxRow,
): Promise<AtomicProcessResult> {
  const channel = DEFAULT_BOT_CHANNEL;
  const provider = inbox.provider;
  const externalContactKey = resolveExternalContactKey({
    phone: inbox.phone,
    rawPayload: inbox.rawPayload,
  });
  const occurredAt = new Date(inbox.receivedAt);
  const occurred =
    Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const clientSuffix = getClientMobileLookupSuffix(inbox.phone);

  const pool = await getPool();
  const result = await pool
    .request()
    .input('inboxId', sql.BigInt, inbox.id)
    .input('channel', sql.NVarChar(30), channel)
    .input('provider', sql.NVarChar(50), provider)
    .input('externalContactKey', sql.NVarChar(100), externalContactKey)
    .input('phone', sql.NVarChar(50), inbox.phone)
    .input('providerMessageId', sql.NVarChar(250), inbox.providerMessageId)
    .input('messageType', sql.NVarChar(50), inbox.messageType)
    .input('text', sql.NVarChar(sql.MAX), inbox.text)
    .input('occurredAt', sql.DateTime2, occurred)
    .input('clientSuffix', sql.NVarChar(10), clientSuffix)
    .query(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;

      BEGIN TRANSACTION;

      DECLARE @ConversationId BIGINT = NULL;
      DECLARE @MessageId BIGINT = NULL;
      DECLARE @ExistingMessageId BIGINT = NULL;
      DECLARE @ExistingConversationId BIGINT = NULL;
      DECLARE @ConversationCreated BIT = 0;
      DECLARE @ClientLinked BIT = 0;
      DECLARE @ClientAmbiguous BIT = 0;
      DECLARE @ClientId INT = NULL;
      DECLARE @Duplicate BIT = 0;
      DECLARE @MatchCount INT = 0;

      SELECT TOP 1
        @ExistingMessageId = m.[MessageID],
        @ExistingConversationId = m.[ConversationID]
      FROM [dbo].[TblBotMessage] AS m WITH (UPDLOCK, HOLDLOCK)
      WHERE m.[InboxID] = @inboxId;

      IF @ExistingMessageId IS NOT NULL
      BEGIN
        UPDATE [dbo].[TblMessageInbox]
        SET
          [Status] = N'completed',
          [ProcessedAt] = SYSUTCDATETIME(),
          [UpdatedAt] = SYSUTCDATETIME(),
          [LastError] = NULL
        WHERE [ID] = @inboxId
          AND [Status] IN (N'processing', N'pending');

        SELECT
          @inboxId AS [inboxId],
          @ExistingConversationId AS [conversationId],
          @ExistingMessageId AS [messageId],
          CAST(1 AS BIT) AS [duplicate],
          CAST(0 AS BIT) AS [conversationCreated],
          CAST(0 AS BIT) AS [clientLinked],
          CAST(0 AS BIT) AS [clientAmbiguous];

        COMMIT TRANSACTION;
        RETURN;
      END

      SELECT
        @ConversationId = c.[ConversationID],
        @ClientLinked = CASE WHEN c.[ClientID] IS NOT NULL THEN 1 ELSE 0 END
      FROM [dbo].[TblBotConversation] AS c WITH (UPDLOCK, HOLDLOCK)
      WHERE c.[Channel] = @channel
        AND c.[Provider] = @provider
        AND c.[ExternalContactKey] = @externalContactKey;

      IF @ConversationId IS NULL
      BEGIN
        IF @clientSuffix IS NOT NULL
        BEGIN
          DECLARE @ClientMatches TABLE ([ClientID] INT NOT NULL PRIMARY KEY);
          INSERT INTO @ClientMatches ([ClientID])
          SELECT TOP 2 c.[ClientID]
          FROM [dbo].[TblClient] AS c
          WHERE ${TBL_CLIENT_MOBILE_SUFFIX_SQL} = @clientSuffix;

          SELECT @MatchCount = COUNT(*) FROM @ClientMatches;
          IF @MatchCount = 1
            SELECT TOP 1 @ClientId = [ClientID] FROM @ClientMatches;
          IF @MatchCount > 1
            SET @ClientAmbiguous = 1;
        END

        BEGIN TRY
          INSERT INTO [dbo].[TblBotConversation] (
            [Channel],
            [Provider],
            [ExternalContactKey],
            [Phone],
            [ClientID],
            [BranchID],
            [ControlMode],
            [ContextJson],
            [LastMessageAt],
            [CreatedAt]
          )
          VALUES (
            @channel,
            @provider,
            @externalContactKey,
            @phone,
            @ClientId,
            NULL,
            N'BOT',
            N'{}',
            @occurredAt,
            SYSUTCDATETIME()
          );
          SET @ConversationId = SCOPE_IDENTITY();
          SET @ConversationCreated = 1;
          SET @ClientLinked = CASE WHEN @ClientId IS NOT NULL THEN 1 ELSE 0 END;
        END TRY
        BEGIN CATCH
          IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
          SELECT
            @ConversationId = c.[ConversationID],
            @ClientLinked = CASE WHEN c.[ClientID] IS NOT NULL THEN 1 ELSE 0 END
          FROM [dbo].[TblBotConversation] AS c
          WHERE c.[Channel] = @channel
            AND c.[Provider] = @provider
            AND c.[ExternalContactKey] = @externalContactKey;
          IF @ConversationId IS NULL THROW;
        END CATCH
      END

      BEGIN TRY
        INSERT INTO [dbo].[TblBotMessage] (
          [ConversationID],
          [InboxID],
          [Direction],
          [Provider],
          [ProviderMessageID],
          [MessageType],
          [Text],
          [OccurredAt],
          [CreatedAt]
        )
        VALUES (
          @ConversationId,
          @inboxId,
          N'inbound',
          @provider,
          @providerMessageId,
          @messageType,
          @text,
          @occurredAt,
          SYSUTCDATETIME()
        );
        SET @MessageId = SCOPE_IDENTITY();
      END TRY
      BEGIN CATCH
        IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
        SELECT TOP 1
          @MessageId = m.[MessageID],
          @ExistingConversationId = m.[ConversationID]
        FROM [dbo].[TblBotMessage] AS m
        WHERE m.[InboxID] = @inboxId;
        IF @MessageId IS NULL THROW;
        SET @Duplicate = 1;
        SET @ConversationId = @ExistingConversationId;
      END CATCH

      IF @Duplicate = 0
      BEGIN
        UPDATE [dbo].[TblBotConversation]
        SET
          [LastMessageAt] = @occurredAt,
          [UpdatedAt] = SYSUTCDATETIME()
        WHERE [ConversationID] = @ConversationId;
      END

      UPDATE [dbo].[TblMessageInbox]
      SET
        [Status] = N'completed',
        [ProcessedAt] = SYSUTCDATETIME(),
        [UpdatedAt] = SYSUTCDATETIME(),
        [LastError] = NULL
      WHERE [ID] = @inboxId
        AND [Status] IN (N'processing', N'pending');

      SELECT
        @inboxId AS [inboxId],
        @ConversationId AS [conversationId],
        @MessageId AS [messageId],
        @Duplicate AS [duplicate],
        @ConversationCreated AS [conversationCreated],
        @ClientLinked AS [clientLinked],
        @ClientAmbiguous AS [clientAmbiguous];

      COMMIT TRANSACTION;
    `);

  const row = result.recordset[0] as AtomicSqlRow | undefined;
  if (!row) {
    throw new Error('Atomic inbox processor returned no result row');
  }

  return {
    inboxId: Number(row.inboxId),
    conversationId: Number(row.conversationId),
    messageId: Number(row.messageId),
    duplicate: Boolean(row.duplicate),
    conversationCreated: Boolean(row.conversationCreated),
    clientLinked: Boolean(row.clientLinked),
    clientAmbiguous: Boolean(row.clientAmbiguous),
    sqlRoundTrips: 1,
  };
}
