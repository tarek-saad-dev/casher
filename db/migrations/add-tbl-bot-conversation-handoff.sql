-- ============================================================
-- Human Handoff V1: conversation ownership, audit, resume, fromMe correlation
-- Additive. Idempotent. No DROP TABLE / TRUNCATE.
-- ============================================================
SET NOCOUNT ON;

-- ControlMode: allow HUMAN_REQUESTED (keep PAUSED)
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblBotConversation_ControlMode'
      AND parent_object_id = OBJECT_ID(N'dbo.TblBotConversation')
)
BEGIN
    ALTER TABLE [dbo].[TblBotConversation] DROP CONSTRAINT [CK_TblBotConversation_ControlMode];
END
GO
IF OBJECT_ID(N'dbo.TblBotConversation', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_TblBotConversation_ControlMode'
          AND parent_object_id = OBJECT_ID(N'dbo.TblBotConversation')
   )
BEGIN
    ALTER TABLE [dbo].[TblBotConversation] WITH NOCHECK
        ADD CONSTRAINT [CK_TblBotConversation_ControlMode]
        CHECK ([ControlMode] IN (N'BOT', N'HUMAN_REQUESTED', N'HUMAN', N'PAUSED'));
END
GO

IF OBJECT_ID(N'dbo.TblBotAiTurn', N'U') IS NOT NULL
   AND EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_TblBotAiTurn_ControlModeSnapshot'
          AND parent_object_id = OBJECT_ID(N'dbo.TblBotAiTurn')
   )
BEGIN
    ALTER TABLE [dbo].[TblBotAiTurn] DROP CONSTRAINT [CK_TblBotAiTurn_ControlModeSnapshot];
END
GO
IF OBJECT_ID(N'dbo.TblBotAiTurn', N'U') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_TblBotAiTurn_ControlModeSnapshot'
          AND parent_object_id = OBJECT_ID(N'dbo.TblBotAiTurn')
   )
BEGIN
    ALTER TABLE [dbo].[TblBotAiTurn] WITH NOCHECK
        ADD CONSTRAINT [CK_TblBotAiTurn_ControlModeSnapshot]
        CHECK ([ControlModeSnapshot] IN (N'BOT', N'HUMAN_REQUESTED', N'HUMAN', N'PAUSED'));
END
GO

IF COL_LENGTH(N'dbo.TblBotConversation', N'ControlVersion') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [ControlVersion] INT NOT NULL
        CONSTRAINT [DF_TblBotConversation_ControlVersion] DEFAULT (1);
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'HumanLeaseUntil') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [HumanLeaseUntil] DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'HumanLastActivityAt') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [HumanLastActivityAt] DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'TakeoverSource') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [TakeoverSource] NVARCHAR(40) NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'TakenOverByUserID') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [TakenOverByUserID] INT NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'HandoffReason') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [HandoffReason] NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'HandoffRequestedAt') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [HandoffRequestedAt] DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'LastHumanMessageID') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [LastHumanMessageID] BIGINT NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'LastBotMessageID') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [LastBotMessageID] BIGINT NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'LastCustomerMessageID') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [LastCustomerMessageID] BIGINT NULL;
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'UnreadCount') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [UnreadCount] INT NOT NULL
        CONSTRAINT [DF_TblBotConversation_UnreadCount] DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.TblBotConversation', N'LastReadAt') IS NULL
    ALTER TABLE [dbo].[TblBotConversation] ADD [LastReadAt] DATETIME2(0) NULL;
GO

IF COL_LENGTH(N'dbo.TblBotMessage', N'Origin') IS NULL
    ALTER TABLE [dbo].[TblBotMessage] ADD [Origin] NVARCHAR(30) NULL;
GO
IF COL_LENGTH(N'dbo.TblBotMessage', N'Origin') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE name = N'CK_TblBotMessage_Origin'
          AND parent_object_id = OBJECT_ID(N'dbo.TblBotMessage')
   )
BEGIN
    ALTER TABLE [dbo].[TblBotMessage] WITH NOCHECK
        ADD CONSTRAINT [CK_TblBotMessage_Origin]
        CHECK ([Origin] IS NULL OR [Origin] IN (N'CUSTOMER', N'BOT', N'HUMAN_ERP', N'HUMAN_WHATSAPP', N'HANDOFF_ACK'));
END
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBotMessage_Provider_ProviderMessageID'
      AND object_id = OBJECT_ID(N'dbo.TblBotMessage')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblBotMessage_Provider_ProviderMessageID]
        ON [dbo].[TblBotMessage] ([Provider], [ProviderMessageID]);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotConversation_ModeLease'
      AND object_id = OBJECT_ID(N'dbo.TblBotConversation')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotConversation_ModeLease]
        ON [dbo].[TblBotConversation] ([ControlMode], [HumanLeaseUntil], [ConversationID]);
END
GO

IF OBJECT_ID(N'dbo.TblBotConversationControlEvent', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotConversationControlEvent] (
        [EventID]             BIGINT         IDENTITY(1,1) NOT NULL,
        [ConversationID]      BIGINT         NOT NULL,
        [PreviousMode]        NVARCHAR(20)   NOT NULL,
        [NewMode]             NVARCHAR(20)   NOT NULL,
        [Source]              NVARCHAR(40)   NOT NULL,
        [Reason]              NVARCHAR(200)  NOT NULL,
        [ActorUserID]         INT            NULL,
        [RelatedMessageID]    BIGINT         NULL,
        [ControlVersion]     INT            NOT NULL,
        [CreatedAt]           DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblBotConversationControlEvent_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblBotConversationControlEvent] PRIMARY KEY CLUSTERED ([EventID]),
        CONSTRAINT [FK_TblBotConversationControlEvent_Conversation]
            FOREIGN KEY ([ConversationID]) REFERENCES [dbo].[TblBotConversation] ([ConversationID])
    );
END
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotConversationControlEvent_Conversation'
      AND object_id = OBJECT_ID(N'dbo.TblBotConversationControlEvent')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotConversationControlEvent_Conversation]
        ON [dbo].[TblBotConversationControlEvent] ([ConversationID], [CreatedAt] DESC, [EventID] DESC);
END
GO

IF OBJECT_ID(N'dbo.TblBotConversationResumeClaim', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotConversationResumeClaim] (
        [ClaimID]                   BIGINT         IDENTITY(1,1) NOT NULL,
        [ConversationID]            BIGINT         NOT NULL,
        [LatestCustomerMessageID]  BIGINT         NOT NULL,
        [ClaimKey]                 NVARCHAR(80)   NOT NULL,
        [CreatedAt]                 DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblBotConversationResumeClaim_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_TblBotConversationResumeClaim] PRIMARY KEY CLUSTERED ([ClaimID]),
        CONSTRAINT [UQ_TblBotConversationResumeClaim_Key] UNIQUE ([ClaimKey]),
        CONSTRAINT [FK_TblBotConversationResumeClaim_Conversation]
            FOREIGN KEY ([ConversationID]) REFERENCES [dbo].[TblBotConversation] ([ConversationID])
    );
END
GO

IF OBJECT_ID(N'dbo.TblWhatsAppOutboundCorrelation', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblWhatsAppOutboundCorrelation] (
        [CorrelationID]      BIGINT         IDENTITY(1,1) NOT NULL,
        [OutboxID]            BIGINT         NOT NULL,
        [ConversationID]      BIGINT         NULL,
        [Phone]               NVARCHAR(50)   NOT NULL,
        [Origin]              NVARCHAR(30)   NOT NULL,
        [ExpectedControlVersion] INT      NULL,
        [ProviderMessageID]   NVARCHAR(250)  NULL,
        [CreatedAt]           DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppOutboundCorrelation_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [StampedAt]           DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblWhatsAppOutboundCorrelation] PRIMARY KEY CLUSTERED ([CorrelationID]),
        CONSTRAINT [UQ_TblWhatsAppOutboundCorrelation_Outbox] UNIQUE ([OutboxID])
    );
END
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblWhatsAppOutboundCorrelation_ProviderMessageID'
      AND object_id = OBJECT_ID(N'dbo.TblWhatsAppOutboundCorrelation')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [IX_TblWhatsAppOutboundCorrelation_ProviderMessageID]
        ON [dbo].[TblWhatsAppOutboundCorrelation] ([ProviderMessageID])
        WHERE [ProviderMessageID] IS NOT NULL;
END
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblWhatsAppOutboundCorrelation_PhoneCreated'
      AND object_id = OBJECT_ID(N'dbo.TblWhatsAppOutboundCorrelation')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblWhatsAppOutboundCorrelation_PhoneCreated]
        ON [dbo].[TblWhatsAppOutboundCorrelation] ([Phone], [CreatedAt] DESC);
END
GO

PRINT N'Human Handoff V1 schema ready';
GO
