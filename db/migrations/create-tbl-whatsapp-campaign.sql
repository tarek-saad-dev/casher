-- ============================================================
-- Migration: TblWhatsAppCampaign + TblWhatsAppCampaignRecipient (Phase 7)
-- Idempotent. Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblWhatsAppCampaign', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblWhatsAppCampaign] (
        [ID]               INT            IDENTITY(1,1) NOT NULL,
        [Name]             NVARCHAR(200)  NOT NULL,
        [Status]           NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaign_Status] DEFAULT (N'draft'),
        [MessageMode]      NVARCHAR(20)   NOT NULL,
        [TemplateKey]      NVARCHAR(100)  NULL,
        [CustomMessage]    NVARCHAR(MAX)  NULL,
        [AudienceJson]     NVARCHAR(MAX)  NOT NULL,
        [BranchID]         INT            NULL,
        [TotalRecipients]  INT            NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaign_TotalRecipients] DEFAULT (0),
        [SentCount]        INT            NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaign_SentCount] DEFAULT (0),
        [FailedCount]      INT            NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaign_FailedCount] DEFAULT (0),
        [PendingCount]     INT            NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaign_PendingCount] DEFAULT (0),
        [CreatedByUserID]  INT            NULL,
        [CreatedAt]        DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaign_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [ScheduledAt]      DATETIME2(0)   NULL,
        [StartedAt]        DATETIME2(0)   NULL,
        [CompletedAt]      DATETIME2(0)   NULL,
        [CancelledAt]      DATETIME2(0)   NULL,
        [LastError]        NVARCHAR(MAX)  NULL,
        CONSTRAINT [PK_TblWhatsAppCampaign] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [CK_TblWhatsAppCampaign_Status]
            CHECK ([Status] IN (N'draft', N'queued', N'running', N'completed', N'cancelled', N'failed')),
        CONSTRAINT [CK_TblWhatsAppCampaign_MessageMode]
            CHECK ([MessageMode] IN (N'template', N'custom')),
        CONSTRAINT [FK_TblWhatsAppCampaign_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID]),
        CONSTRAINT [FK_TblWhatsAppCampaign_CreatedByUserID]
            FOREIGN KEY ([CreatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID])
    );
    PRINT N'Created TblWhatsAppCampaign';
END
ELSE
    PRINT N'TblWhatsAppCampaign already exists — skipped';
GO

IF OBJECT_ID(N'dbo.TblWhatsAppCampaignRecipient', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblWhatsAppCampaignRecipient] (
        [ID]               BIGINT         IDENTITY(1,1) NOT NULL,
        [CampaignID]       INT            NOT NULL,
        [CustomerID]       INT            NULL,
        [CustomerName]     NVARCHAR(200)  NULL,
        [Phone]            NVARCHAR(50)   NOT NULL,
        [MessageContent]   NVARCHAR(MAX)  NOT NULL,
        [IdempotencyKey]   NVARCHAR(200)  NOT NULL,
        [OutboxMessageID]  BIGINT         NULL,
        [Status]           NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaignRecipient_Status] DEFAULT (N'pending'),
        [LastError]        NVARCHAR(MAX)  NULL,
        [CreatedAt]        DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppCampaignRecipient_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [SentAt]           DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblWhatsAppCampaignRecipient] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [UQ_TblWhatsAppCampaignRecipient_IdempotencyKey] UNIQUE ([IdempotencyKey]),
        CONSTRAINT [CK_TblWhatsAppCampaignRecipient_Status]
            CHECK ([Status] IN (N'pending', N'queued', N'sent', N'failed', N'cancelled', N'skipped')),
        CONSTRAINT [FK_TblWhatsAppCampaignRecipient_CampaignID]
            FOREIGN KEY ([CampaignID]) REFERENCES [dbo].[TblWhatsAppCampaign] ([ID]) ON DELETE CASCADE
    );
    PRINT N'Created TblWhatsAppCampaignRecipient';
END
ELSE
    PRINT N'TblWhatsAppCampaignRecipient already exists — skipped';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblWhatsAppCampaignRecipient_CampaignID_Status'
      AND object_id = OBJECT_ID(N'dbo.TblWhatsAppCampaignRecipient')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblWhatsAppCampaignRecipient_CampaignID_Status]
        ON [dbo].[TblWhatsAppCampaignRecipient] ([CampaignID], [Status]);
    PRINT N'Created IX_TblWhatsAppCampaignRecipient_CampaignID_Status';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblWhatsAppCampaignRecipient_CampaignID'
      AND object_id = OBJECT_ID(N'dbo.TblWhatsAppCampaignRecipient')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblWhatsAppCampaignRecipient_CampaignID]
        ON [dbo].[TblWhatsAppCampaignRecipient] ([CampaignID]);
    PRINT N'Created IX_TblWhatsAppCampaignRecipient_CampaignID';
END
GO
