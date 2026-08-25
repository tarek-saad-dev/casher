-- ============================================================
-- Migration: TblMessageOutbox (Phase 5A durable messaging outbox)
-- Idempotent. Safe to re-run. Does not send messages.
-- Content is a rendered snapshot; TemplateKey is analytics/history only.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageOutbox', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblMessageOutbox] (
        [ID]                 BIGINT         IDENTITY(1,1) NOT NULL,
        [Channel]            NVARCHAR(30)   NOT NULL,
        [Recipient]          NVARCHAR(100)  NOT NULL,
        [TemplateKey]        NVARCHAR(150)  NULL,
        [Content]            NVARCHAR(MAX)  NOT NULL,
        [MetadataJson]       NVARCHAR(MAX)  NULL,
        [IdempotencyKey]     NVARCHAR(200)  NOT NULL,
        [Status]             NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblMessageOutbox_Status] DEFAULT (N'pending'),
        [AttemptCount]       INT            NOT NULL
            CONSTRAINT [DF_TblMessageOutbox_AttemptCount] DEFAULT (0),
        [MaxAttempts]        INT            NOT NULL
            CONSTRAINT [DF_TblMessageOutbox_MaxAttempts] DEFAULT (5),
        [NextAttemptAt]      DATETIME2(0)   NULL,
        [LockedAt]           DATETIME2(0)   NULL,
        [LockedBy]           NVARCHAR(100)  NULL,
        [ProviderMessageID]  NVARCHAR(250)  NULL,
        [LastError]          NVARCHAR(MAX)  NULL,
        [BranchID]           INT            NULL,
        [CreatedByUserID]    INT            NULL,
        [CreatedAt]          DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblMessageOutbox_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]          DATETIME2(0)   NULL,
        [SentAt]             DATETIME2(0)   NULL,
        [FailedAt]           DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblMessageOutbox] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [UQ_TblMessageOutbox_IdempotencyKey] UNIQUE ([IdempotencyKey]),
        CONSTRAINT [CK_TblMessageOutbox_Channel] CHECK ([Channel] IN (N'whatsapp')),
        CONSTRAINT [CK_TblMessageOutbox_Status] CHECK ([Status] IN (N'pending', N'sending', N'sent', N'failed')),
        CONSTRAINT [CK_TblMessageOutbox_IdempotencyKey] CHECK (LEN(LTRIM(RTRIM([IdempotencyKey]))) > 0),
        CONSTRAINT [CK_TblMessageOutbox_Recipient] CHECK (LEN(LTRIM(RTRIM([Recipient]))) > 0),
        CONSTRAINT [CK_TblMessageOutbox_Content] CHECK (LEN(LTRIM(RTRIM([Content]))) > 0),
        CONSTRAINT [CK_TblMessageOutbox_AttemptCount] CHECK ([AttemptCount] >= 0),
        CONSTRAINT [CK_TblMessageOutbox_MaxAttempts] CHECK ([MaxAttempts] >= 1),
        CONSTRAINT [FK_TblMessageOutbox_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID]),
        CONSTRAINT [FK_TblMessageOutbox_CreatedByUserID]
            FOREIGN KEY ([CreatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID])
    );
    PRINT N'Created TblMessageOutbox';
END
ELSE
    PRINT N'TblMessageOutbox already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblMessageOutbox_History'
      AND object_id = OBJECT_ID(N'dbo.TblMessageOutbox')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblMessageOutbox_History]
        ON [dbo].[TblMessageOutbox] ([CreatedAt] DESC, [ID] DESC)
        INCLUDE ([BranchID], [Status], [Channel]);
    PRINT N'Created IX_TblMessageOutbox_History';
END
ELSE
    PRINT N'IX_TblMessageOutbox_History already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblMessageOutbox_BranchHistory'
      AND object_id = OBJECT_ID(N'dbo.TblMessageOutbox')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblMessageOutbox_BranchHistory]
        ON [dbo].[TblMessageOutbox] ([BranchID], [CreatedAt] DESC, [ID] DESC)
        WHERE [BranchID] IS NOT NULL;
    PRINT N'Created IX_TblMessageOutbox_BranchHistory';
END
ELSE
    PRINT N'IX_TblMessageOutbox_BranchHistory already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblMessageOutbox_Status'
      AND object_id = OBJECT_ID(N'dbo.TblMessageOutbox')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblMessageOutbox_Status]
        ON [dbo].[TblMessageOutbox] ([Status], [NextAttemptAt])
        INCLUDE ([Channel], [AttemptCount], [MaxAttempts]);
    PRINT N'Created IX_TblMessageOutbox_Status';
END
ELSE
    PRINT N'IX_TblMessageOutbox_Status already exists';
GO
