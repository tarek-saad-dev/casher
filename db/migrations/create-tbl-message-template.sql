-- ============================================================
-- Migration: TblMessageTemplate (Phase 4A database-backed templates)
-- Idempotent. Safe to re-run. Seeds global sale.customer_receipt once.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageTemplate', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblMessageTemplate] (
        [ID]               INT            IDENTITY(1,1) NOT NULL,
        [TemplateKey]      NVARCHAR(100)  NOT NULL,
        [Channel]          NVARCHAR(40)   NOT NULL,
        [BranchID]         INT            NULL,
        [Language]         NVARCHAR(10)   NOT NULL
            CONSTRAINT [DF_TblMessageTemplate_Language] DEFAULT (N'ar'),
        [Content]          NVARCHAR(MAX)  NOT NULL,
        [IsActive]         BIT            NOT NULL
            CONSTRAINT [DF_TblMessageTemplate_IsActive] DEFAULT (1),
        [Version]          INT            NOT NULL
            CONSTRAINT [DF_TblMessageTemplate_Version] DEFAULT (1),
        [CreatedByUserID]  INT            NULL,
        [UpdatedByUserID]  INT            NULL,
        [CreatedAt]        DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblMessageTemplate_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]        DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblMessageTemplate] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [CK_TblMessageTemplate_Version] CHECK ([Version] >= 1),
        CONSTRAINT [CK_TblMessageTemplate_Channel] CHECK ([Channel] IN (N'whatsapp')),
        CONSTRAINT [FK_TblMessageTemplate_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID]),
        CONSTRAINT [FK_TblMessageTemplate_CreatedByUserID]
            FOREIGN KEY ([CreatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [FK_TblMessageTemplate_UpdatedByUserID]
            FOREIGN KEY ([UpdatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID])
    );
    PRINT N'Created TblMessageTemplate';
END
ELSE
    PRINT N'TblMessageTemplate already exists';
GO

-- One active branch-scoped row per channel + key + branch + language
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblMessageTemplate_ActiveBranch'
      AND object_id = OBJECT_ID(N'dbo.TblMessageTemplate')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblMessageTemplate_ActiveBranch]
        ON [dbo].[TblMessageTemplate] ([Channel], [TemplateKey], [BranchID], [Language])
        WHERE [IsActive] = 1 AND [BranchID] IS NOT NULL;
    PRINT N'Created UX_TblMessageTemplate_ActiveBranch';
END
ELSE
    PRINT N'UX_TblMessageTemplate_ActiveBranch already exists';
GO

-- One active global row per channel + key + language (BranchID IS NULL)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblMessageTemplate_ActiveGlobal'
      AND object_id = OBJECT_ID(N'dbo.TblMessageTemplate')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblMessageTemplate_ActiveGlobal]
        ON [dbo].[TblMessageTemplate] ([Channel], [TemplateKey], [Language])
        WHERE [IsActive] = 1 AND [BranchID] IS NULL;
    PRINT N'Created UX_TblMessageTemplate_ActiveGlobal';
END
ELSE
    PRINT N'UX_TblMessageTemplate_ActiveGlobal already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblMessageTemplate_Lookup'
      AND object_id = OBJECT_ID(N'dbo.TblMessageTemplate')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblMessageTemplate_Lookup]
        ON [dbo].[TblMessageTemplate] ([Channel], [TemplateKey], [Language], [IsActive])
        INCLUDE ([Content], [BranchID], [Version]);
    PRINT N'Created IX_TblMessageTemplate_Lookup';
END
ELSE
    PRINT N'IX_TblMessageTemplate_Lookup already exists';
GO

-- Idempotent seed: global WhatsApp sale receipt (exact current code default)
IF OBJECT_ID(N'dbo.TblMessageTemplate', N'U') IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp'
      AND [TemplateKey] = N'sale.customer_receipt'
      AND [Language] = N'ar'
      AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey],
        [Channel],
        [BranchID],
        [Language],
        [Content],
        [IsActive],
        [Version]
    )
    VALUES (
        N'sale.customer_receipt',
        N'whatsapp',
        NULL,
        N'ar',
        N'أستاذ {{customerName}}' + NCHAR(10) + N'نورت Cut Salon ودايمًا منورنا 🙏✨',
        1,
        1
    );
    PRINT N'Seeded global sale.customer_receipt template';
END
ELSE
    PRINT N'Global sale.customer_receipt template already present — seed skipped';
GO
