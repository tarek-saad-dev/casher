-- ============================================================
-- Migration: TblBotConversation (Phase 2 WhatsApp conversation engine)
-- Idempotent. Safe to re-run. No AI/reply behavior.
-- Identity: (Channel, Provider, ExternalContactKey)
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblBotConversation', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotConversation] (
        [ConversationID]      BIGINT         IDENTITY(1,1) NOT NULL,
        [Channel]             NVARCHAR(30)   NOT NULL
            CONSTRAINT [DF_TblBotConversation_Channel] DEFAULT (N'whatsapp'),
        [Provider]            NVARCHAR(50)   NOT NULL,
        [ExternalContactKey]  NVARCHAR(100)  NOT NULL,
        [Phone]               NVARCHAR(50)   NOT NULL,
        [ClientID]            INT            NULL,
        [BranchID]            INT            NULL,
        [ControlMode]         NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblBotConversation_ControlMode] DEFAULT (N'BOT'),
        [ContextJson]         NVARCHAR(MAX)  NOT NULL
            CONSTRAINT [DF_TblBotConversation_ContextJson] DEFAULT (N'{}'),
        [Summary]             NVARCHAR(MAX)  NULL,
        [LastMessageAt]       DATETIME2(0)   NOT NULL,
        [CreatedAt]           DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblBotConversation_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]           DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblBotConversation] PRIMARY KEY CLUSTERED ([ConversationID]),
        CONSTRAINT [UQ_TblBotConversation_Identity]
            UNIQUE ([Channel], [Provider], [ExternalContactKey]),
        CONSTRAINT [CK_TblBotConversation_Channel] CHECK (LEN(LTRIM(RTRIM([Channel]))) > 0),
        CONSTRAINT [CK_TblBotConversation_Provider] CHECK (LEN(LTRIM(RTRIM([Provider]))) > 0),
        CONSTRAINT [CK_TblBotConversation_ExternalContactKey]
            CHECK (LEN(LTRIM(RTRIM([ExternalContactKey]))) > 0),
        CONSTRAINT [CK_TblBotConversation_Phone] CHECK (LEN(LTRIM(RTRIM([Phone]))) > 0),
        CONSTRAINT [CK_TblBotConversation_ControlMode]
            CHECK ([ControlMode] IN (N'BOT', N'HUMAN', N'PAUSED')),
        CONSTRAINT [FK_TblBotConversation_ClientID]
            FOREIGN KEY ([ClientID]) REFERENCES [dbo].[TblClient] ([ClientID]),
        CONSTRAINT [FK_TblBotConversation_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID])
    );
    PRINT N'Created TblBotConversation';
END
ELSE
    PRINT N'TblBotConversation already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotConversation_LastMessageAt'
      AND object_id = OBJECT_ID(N'dbo.TblBotConversation')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotConversation_LastMessageAt]
        ON [dbo].[TblBotConversation] ([LastMessageAt] DESC, [ConversationID] DESC)
        INCLUDE ([Channel], [Provider], [Phone], [ClientID], [ControlMode]);
    PRINT N'Created IX_TblBotConversation_LastMessageAt';
END
ELSE
    PRINT N'IX_TblBotConversation_LastMessageAt already exists';
GO
