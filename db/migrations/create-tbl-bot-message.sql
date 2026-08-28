-- ============================================================
-- Migration: TblBotMessage (Phase 2 canonical conversation messages)
-- Idempotent. Safe to re-run. InboxID is idempotency boundary for inbound.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblBotMessage', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotMessage] (
        [MessageID]           BIGINT         IDENTITY(1,1) NOT NULL,
        [ConversationID]      BIGINT         NOT NULL,
        [InboxID]             BIGINT         NULL,
        [Direction]           NVARCHAR(20)   NOT NULL,
        [Provider]            NVARCHAR(50)   NOT NULL,
        [ProviderMessageID]   NVARCHAR(250)  NOT NULL,
        [MessageType]         NVARCHAR(50)   NOT NULL,
        [Text]                NVARCHAR(MAX)  NULL,
        [OccurredAt]          DATETIME2(0)   NOT NULL,
        [CreatedAt]           DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblBotMessage_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblBotMessage] PRIMARY KEY CLUSTERED ([MessageID]),
        CONSTRAINT [CK_TblBotMessage_Direction]
            CHECK ([Direction] IN (N'inbound', N'outbound')),
        CONSTRAINT [CK_TblBotMessage_Provider] CHECK (LEN(LTRIM(RTRIM([Provider]))) > 0),
        CONSTRAINT [CK_TblBotMessage_ProviderMessageID]
            CHECK (LEN(LTRIM(RTRIM([ProviderMessageID]))) > 0),
        CONSTRAINT [CK_TblBotMessage_MessageType] CHECK (LEN(LTRIM(RTRIM([MessageType]))) > 0),
        CONSTRAINT [FK_TblBotMessage_ConversationID]
            FOREIGN KEY ([ConversationID]) REFERENCES [dbo].[TblBotConversation] ([ConversationID]),
        CONSTRAINT [FK_TblBotMessage_InboxID]
            FOREIGN KEY ([InboxID]) REFERENCES [dbo].[TblMessageInbox] ([ID])
    );
    PRINT N'Created TblBotMessage';
END
ELSE
    PRINT N'TblBotMessage already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBotMessage_InboxID'
      AND object_id = OBJECT_ID(N'dbo.TblBotMessage')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblBotMessage_InboxID]
        ON [dbo].[TblBotMessage] ([InboxID])
        WHERE [InboxID] IS NOT NULL;
    PRINT N'Created UX_TblBotMessage_InboxID';
END
ELSE
    PRINT N'UX_TblBotMessage_InboxID already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotMessage_ConversationTimeline'
      AND object_id = OBJECT_ID(N'dbo.TblBotMessage')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotMessage_ConversationTimeline]
        ON [dbo].[TblBotMessage] ([ConversationID], [OccurredAt] ASC, [MessageID] ASC)
        INCLUDE ([Direction], [MessageType], [InboxID]);
    PRINT N'Created IX_TblBotMessage_ConversationTimeline';
END
ELSE
    PRINT N'IX_TblBotMessage_ConversationTimeline already exists';
GO
