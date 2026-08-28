-- ============================================================
-- Migration: TblMessageInbox (Phase 1 inbound WhatsApp persistence)
-- Idempotent. Safe to re-run. Does not process or reply to messages.
-- Idempotency boundary: (Provider, ProviderMessageID).
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageInbox', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblMessageInbox] (
        [ID]                    BIGINT         IDENTITY(1,1) NOT NULL,
        [Provider]              NVARCHAR(50)   NOT NULL,
        [ProviderMessageID]     NVARCHAR(250)  NOT NULL,
        [Phone]                 NVARCHAR(50)   NOT NULL,
        [ChatTitle]             NVARCHAR(200)  NULL,
        [MessageType]           NVARCHAR(50)   NOT NULL,
        [Text]                  NVARCHAR(MAX)  NULL,
        [IsGroup]               BIT            NOT NULL
            CONSTRAINT [DF_TblMessageInbox_IsGroup] DEFAULT (0),
        [RawPayload]            NVARCHAR(MAX)  NULL,
        [Status]                NVARCHAR(20)   NOT NULL
            CONSTRAINT [DF_TblMessageInbox_Status] DEFAULT (N'pending'),
        [RetryCount]            INT            NOT NULL
            CONSTRAINT [DF_TblMessageInbox_RetryCount] DEFAULT (0),
        [LastError]             NVARCHAR(MAX)  NULL,
        [ReceivedAt]            DATETIME2(0)   NOT NULL,
        [ProcessingStartedAt]   DATETIME2(0)   NULL,
        [ProcessedAt]           DATETIME2(0)   NULL,
        [CreatedAt]             DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblMessageInbox_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]             DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblMessageInbox] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [UQ_TblMessageInbox_ProviderMessage] UNIQUE ([Provider], [ProviderMessageID]),
        CONSTRAINT [CK_TblMessageInbox_Status] CHECK (
            [Status] IN (N'pending', N'processing', N'completed', N'failed', N'ignored')
        ),
        CONSTRAINT [CK_TblMessageInbox_Provider] CHECK (LEN(LTRIM(RTRIM([Provider]))) > 0),
        CONSTRAINT [CK_TblMessageInbox_ProviderMessageID] CHECK (LEN(LTRIM(RTRIM([ProviderMessageID]))) > 0),
        CONSTRAINT [CK_TblMessageInbox_Phone] CHECK (LEN(LTRIM(RTRIM([Phone]))) > 0),
        CONSTRAINT [CK_TblMessageInbox_MessageType] CHECK (LEN(LTRIM(RTRIM([MessageType]))) > 0),
        CONSTRAINT [CK_TblMessageInbox_RetryCount] CHECK ([RetryCount] >= 0)
    );
    PRINT N'Created TblMessageInbox';
END
ELSE
    PRINT N'TblMessageInbox already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblMessageInbox_StatusReceived'
      AND object_id = OBJECT_ID(N'dbo.TblMessageInbox')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblMessageInbox_StatusReceived]
        ON [dbo].[TblMessageInbox] ([Status], [ReceivedAt] DESC, [ID] DESC)
        INCLUDE ([Provider], [Phone], [MessageType], [IsGroup]);
    PRINT N'Created IX_TblMessageInbox_StatusReceived';
END
ELSE
    PRINT N'IX_TblMessageInbox_StatusReceived already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblMessageInbox_Received'
      AND object_id = OBJECT_ID(N'dbo.TblMessageInbox')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblMessageInbox_Received]
        ON [dbo].[TblMessageInbox] ([ReceivedAt] DESC, [ID] DESC);
    PRINT N'Created IX_TblMessageInbox_Received';
END
ELSE
    PRINT N'IX_TblMessageInbox_Received already exists';
GO
