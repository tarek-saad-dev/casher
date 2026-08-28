-- ============================================================
-- Migration: TblBotAiTurn (Phase 3 durable AI processing)
-- Idempotent. Safe to re-run.
-- One active turn per conversation (pending/processing) via filtered unique index.
-- AnchorInboundMessageID is idempotency boundary per inbound message burst anchor.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblBotAiTurn', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotAiTurn] (
        [TurnID]                    BIGINT         IDENTITY(1,1) NOT NULL,
        [ConversationID]            BIGINT         NOT NULL,
        [AnchorInboundMessageID]    BIGINT         NOT NULL,
        [LatestInboundMessageID]    BIGINT         NOT NULL,
        [Status]                    NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblBotAiTurn_Status] DEFAULT (N'pending'),
        [ControlModeSnapshot]       NVARCHAR(20)   NOT NULL,
        [DebounceUntil]             DATETIME2(3)   NOT NULL,
        [OutboundMessageID]         BIGINT         NULL,
        [OutboxID]                  BIGINT         NULL,
        [Intent]                    NVARCHAR(50)   NULL,
        [Confidence]                DECIMAL(5,4)   NULL,
        [NeedsBusinessTool]         BIT            NULL,
        [ResultJson]                NVARCHAR(MAX)  NULL,
        [LastError]                 NVARCHAR(500)  NULL,
        [ErrorCode]                 NVARCHAR(50)   NULL,
        [RetryCount]                INT            NOT NULL
            CONSTRAINT [DF_TblBotAiTurn_RetryCount] DEFAULT (0),
        [MaxRetries]                INT            NOT NULL
            CONSTRAINT [DF_TblBotAiTurn_MaxRetries] DEFAULT (3),
        [NextAttemptAt]             DATETIME2(3)   NULL,
        [ProcessingStartedAt]         DATETIME2(3)   NULL,
        [CompletedAt]               DATETIME2(3)   NULL,
        [CreatedAt]                 DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblBotAiTurn_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]                 DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblBotAiTurn] PRIMARY KEY CLUSTERED ([TurnID]),
        CONSTRAINT [CK_TblBotAiTurn_Status]
            CHECK ([Status] IN (N'pending', N'processing', N'completed', N'failed', N'skipped')),
        CONSTRAINT [CK_TblBotAiTurn_ControlModeSnapshot]
            CHECK ([ControlModeSnapshot] IN (N'BOT', N'HUMAN', N'PAUSED')),
        CONSTRAINT [FK_TblBotAiTurn_ConversationID]
            FOREIGN KEY ([ConversationID]) REFERENCES [dbo].[TblBotConversation] ([ConversationID]),
        CONSTRAINT [FK_TblBotAiTurn_AnchorInboundMessageID]
            FOREIGN KEY ([AnchorInboundMessageID]) REFERENCES [dbo].[TblBotMessage] ([MessageID]),
        CONSTRAINT [FK_TblBotAiTurn_LatestInboundMessageID]
            FOREIGN KEY ([LatestInboundMessageID]) REFERENCES [dbo].[TblBotMessage] ([MessageID]),
        CONSTRAINT [FK_TblBotAiTurn_OutboundMessageID]
            FOREIGN KEY ([OutboundMessageID]) REFERENCES [dbo].[TblBotMessage] ([MessageID])
    );
    PRINT N'Created TblBotAiTurn';
END
ELSE
    PRINT N'TblBotAiTurn already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBotAiTurn_AnchorInboundMessageID'
      AND object_id = OBJECT_ID(N'dbo.TblBotAiTurn')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblBotAiTurn_AnchorInboundMessageID]
        ON [dbo].[TblBotAiTurn] ([AnchorInboundMessageID]);
    PRINT N'Created UX_TblBotAiTurn_AnchorInboundMessageID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBotAiTurn_ConversationActive'
      AND object_id = OBJECT_ID(N'dbo.TblBotAiTurn')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblBotAiTurn_ConversationActive]
        ON [dbo].[TblBotAiTurn] ([ConversationID])
        WHERE [Status] IN (N'pending', N'processing');
    PRINT N'Created UX_TblBotAiTurn_ConversationActive';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotAiTurn_Claim'
      AND object_id = OBJECT_ID(N'dbo.TblBotAiTurn')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotAiTurn_Claim]
        ON [dbo].[TblBotAiTurn] ([Status], [DebounceUntil], [NextAttemptAt], [TurnID])
        INCLUDE ([ConversationID], [AnchorInboundMessageID], [LatestInboundMessageID], [RetryCount], [MaxRetries]);
    PRINT N'Created IX_TblBotAiTurn_Claim';
END
GO
